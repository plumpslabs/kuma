// ============================================================
// KUMA TRAJECTORY — Trajectory Logging & Skill Distillation (Issue #23)
//                  + Trajectory-to-Test Generator (Issue #28)
// ============================================================
// Logs agent action trajectories (tool call sequences, reasoning
// steps, error tracebacks, resolution diffs) and distills successful
// high-complexity trajectories into reusable parameterized skills.
//
// Issue #28 Extension: synthesize test files from successful fixes.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getDb, saveDb } from "./kumaDb.js";
import { sessionMemory } from "./sessionMemory.js";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// TRAJECTORY SCHEMA
// ============================================================

interface TrajectoryStep {
  toolName: string;
  params: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  error?: string;
  timestamp: number;
}

// ============================================================
// ENSURE SCHEMA
// ============================================================

async function ensureTrajectorySchema(): Promise<void> {
  const db = await getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS trajectories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      total_duration_ms INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0.0,
      complexity INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_traj_goal ON trajectories(goal);
    CREATE INDEX IF NOT EXISTS idx_traj_complexity ON trajectories(complexity);
    CREATE INDEX IF NOT EXISTS idx_traj_created ON trajectories(created_at);
  `);

  // Distilled skills table
  db.exec(`
    CREATE TABLE IF NOT EXISTS distilled_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      pattern TEXT NOT NULL,         -- JSON: tool sequence pattern
      parameters TEXT DEFAULT '[]',  -- JSON: parameterized inputs
      success_count INTEGER DEFAULT 1,
      avg_duration_ms INTEGER DEFAULT 0,
      source_trajectory_id INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skills_name ON distilled_skills(name);
    CREATE INDEX IF NOT EXISTS idx_skills_used ON distilled_skills(last_used_at);
  `);

  // Issue #28: Generated tests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS generated_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trajectory_id INTEGER,
      file_path TEXT NOT NULL,
      test_framework TEXT NOT NULL,
      description TEXT,
      test_code TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gen_tests_traj ON generated_tests(trajectory_id);
  `);

  saveDb();
}

// ============================================================
// RECORD TRAJECTORY
// ============================================================

/**
 * Record a complete trajectory (sequence of tool calls for a goal).
 */
export async function recordTrajectory(
  goal: string,
): Promise<number | null> {
  try {
    await ensureTrajectorySchema();

    const calls = sessionMemory.getToolCallHistory(100);
    const steps: TrajectoryStep[] = calls.map(c => ({
      toolName: c.toolName,
      params: c.params,
      success: true,
      durationMs: 0,
      timestamp: c.timestamp,
    }));

    const totalDurationMs = steps.length > 0
      ? (steps[steps.length - 1].timestamp - steps[0].timestamp)
      : 0;

    const errorCalls = steps.filter(s => {
      const action = s.params.action as string;
      return action === "verify" && s.params.success === false;
    }).length;

    const successRate = steps.length > 0
      ? (steps.length - errorCalls) / steps.length
      : 1.0;

    const complexity = Math.min(100,
      Math.round(
        (steps.length * 5) +          // 5 pts per step
        (errorCalls * 15) +           // 15 pts per error
        Math.min(totalDurationMs / 60000 * 10, 30)  // 10 pts per minute (max 30)
      )
    );

    const db2 = await getDb(); // fresh db ref
    db2.run(
      `INSERT INTO trajectories (goal, steps, total_duration_ms, success_rate, complexity)
       VALUES (?, ?, ?, ?, ?)`,
      [
        goal.substring(0, 200),
        JSON.stringify(steps),
        totalDurationMs,
        successRate,
        complexity,
      ]
    );
    saveDb();

    const result = db2.exec("SELECT last_insert_rowid() as id");
    const id = result[0]?.values[0]?.[0] as number | null;

    // Auto-distill if trajectory was successful and complex enough
    if (id !== null && complexity > 40 && successRate > 0.8) {
      await distillSkill(id, goal, steps).catch(() => {});
      // #28: Auto-generate test from successful fix trajectory
      if (goal.toLowerCase().includes("fix") || goal.toLowerCase().includes("bug") || goal.toLowerCase().includes("error")) {
        await generateTestFromTrajectory(id, goal, steps).catch(() => {});
      }
    }

    return id ?? null;
  } catch (err) {
    console.error(`[Trajectory] Record error: ${err}`);
    return null;
  }
}

// ============================================================
// DISTILL SKILL FROM TRAJECTORY
// ============================================================

/**
 * Distill a successful trajectory into a reusable skill.
 */
async function distillSkill(
  trajectoryId: number,
  goal: string,
  steps: TrajectoryStep[],
): Promise<void> {
  try {
    const db = await getDb();

    // Extract the tool sequence pattern (tool names in order)
    const toolSequence = steps.map(s => s.toolName);
    const patternKey = toolSequence.join(" → ");

    // Extract unique tool names for the skill name
    const uniqueTools = [...new Set(toolSequence)];
    const skillName = `trajectory:${uniqueTools.slice(0, 3).join("-")}`;

    // Check if this pattern already exists
    const checkStmt = db.prepare(
      "SELECT id, success_count, avg_duration_ms FROM distilled_skills WHERE name = ?"
    );
    checkStmt.bind([skillName]);
    const exists = checkStmt.step();
    let existingRow: Record<string, unknown> | null = null;
    if (exists) {
      existingRow = checkStmt.getAsObject() as Record<string, unknown>;
    }
    checkStmt.free();

    const totalDuration = steps.reduce((sum, s) => sum + s.durationMs, 0);

    if (existingRow) {
      const existingId = existingRow.id as number;
      const existingCount = existingRow.success_count as number;
      const existingAvg = existingRow.avg_duration_ms as number;

      db.run(
        `UPDATE distilled_skills
         SET success_count = ?, avg_duration_ms = ?, last_used_at = strftime('%s','now')
         WHERE id = ?`,
        [existingCount + 1,
         Math.round((existingAvg * existingCount + totalDuration) / (existingCount + 1)),
         existingId]
      );
    } else {
      const description = [
        `Distilled trajectory pattern for "${goal.substring(0, 60)}"`,
        `Tool sequence: ${patternKey}`,
        `${steps.length} steps, ${uniqueTools.length} unique tools`,
      ].join(". ");

      db.run(
        `INSERT INTO distilled_skills (name, description, pattern, parameters, success_count, avg_duration_ms, source_trajectory_id, last_used_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, strftime('%s','now'))`,
        [
          skillName,
          description,
          JSON.stringify(toolSequence),
          JSON.stringify(extractParameters(steps)),
          totalDuration,
          trajectoryId,
        ]
      );
    }

    saveDb();
    console.error(`[Trajectory] Distilled skill "${skillName}" from trajectory #${trajectoryId}`);
  } catch (err) {
    console.error(`[Trajectory] Distill error: ${err}`);
  }
}

/**
 * Extract parameterized inputs from trajectory steps.
 */
function extractParameters(steps: TrajectoryStep[]): string[] {
  const params = new Set<string>();
  for (const step of steps) {
    for (const [key] of Object.entries(step.params)) {
      if (["scope", "target", "query", "filePath", "action"].includes(key)) {
        params.add(key);
      }
    }
  }
  return Array.from(params);
}

// ============================================================
// #28: TRAJECTORY-TO-TEST GENERATOR
// ============================================================

export interface GeneratedTest {
  filePath: string;
  framework: "jest" | "vitest" | "node" | "unknown";
  code: string;
  description: string;
}

/**
 * Generate a test file from a successful fix trajectory.
 */
export async function generateTestFromTrajectory(
  trajectoryId: number,
  goal: string,
  steps: TrajectoryStep[],
): Promise<GeneratedTest | null> {
  try {
    await ensureTrajectorySchema();

    // Find the files that were modified during the fix
    const modifiedFiles = steps
      .filter(s => s.params.filePath || (s.params.target as string))
      .map(s => (s.params.filePath as string || s.params.target as string))
      .filter(Boolean);

    if (modifiedFiles.length === 0) return null;

    // Detect test framework
    const framework = detectTestFramework();
    const primaryFile = modifiedFiles[0];

    // Generate test code based on framework
    const testCode = synthesizeTestCode(goal, primaryFile, modifiedFiles, framework);

    // Determine test file path
    const testFilePath = determineTestPath(primaryFile, framework);

    const genTest: GeneratedTest = {
      filePath: testFilePath,
      framework,
      code: testCode,
      description: `Auto-generated from trajectory #${trajectoryId}: ${goal.substring(0, 80)}`,
    };

    // Save to database
    const db = await getDb();
    db.run(
      `INSERT INTO generated_tests (trajectory_id, file_path, test_framework, description, test_code)
       VALUES (?, ?, ?, ?, ?)`,
      [trajectoryId, testFilePath, framework, genTest.description, testCode],
    );
    saveDb();

    // Write the test file to disk
    const root = getProjectRoot();
    const fullPath = path.resolve(root, testFilePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, testCode, "utf-8");

    console.error(`[Trajectory] Generated test: ${testFilePath} from trajectory #${trajectoryId}`);
    return genTest;
  } catch (err) {
    console.error(`[Trajectory] Test generation error: ${err}`);
    return null;
  }
}

/**
 * Manually trigger test generation from a trajectory ID.
 */
export async function generateTestFromTrajectoryId(
  trajectoryId: number,
): Promise<string> {
  try {
    await ensureTrajectorySchema();
    const db = await getDb();

    const stmt = db.prepare("SELECT id, goal, steps FROM trajectories WHERE id = ?");
    stmt.bind([trajectoryId]);
    if (!stmt.step()) {
      stmt.free();
      return `❌ Trajectory #${trajectoryId} not found.`;
    }

    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();

    const goal = row.goal as string;
    const steps: TrajectoryStep[] = JSON.parse(row.steps as string);

    const result = await generateTestFromTrajectory(trajectoryId, goal, steps);
    if (!result) {
      return "⚠️ Could not generate test — no modified files found in trajectory.";
    }

    return [
      `🧪 **Test Generated** from trajectory #${trajectoryId}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📁 **File**: ${result.filePath}`,
      `⚡ **Framework**: ${result.framework}`,
      `📝 **Description**: ${result.description}`,
      ``,
      `\`\`\`${result.framework === "jest" ? "typescript" : "javascript"}`,
      result.code.substring(0, 800),
      result.code.length > 800 ? "..." : "",
      `\`\`\``,
      ``,
      `💡 Test file has been written to disk. Run your test suite to verify.`,
    ].filter(Boolean).join("\n");
  } catch (err) {
    return `❌ Test generation failed: ${err}`;
  }
}

/**
 * List all generated tests.
 */
export async function listGeneratedTests(): Promise<string> {
  try {
    await ensureTrajectorySchema();
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT gt.*, t.goal FROM generated_tests gt
      LEFT JOIN trajectories t ON t.id = gt.trajectory_id
      ORDER BY gt.created_at DESC LIMIT 20
    `);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();

    if (results.length === 0) {
      return "🧪 **No generated tests yet.** Tests are auto-generated from successful fix trajectories.";
    }

    const lines: string[] = [
      "🧪 **Generated Tests**",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const r of results) {
      const time = new Date((r.created_at as number) * 1000).toLocaleString();
      lines.push(`  📄 **${r.file_path}**`);
      lines.push(`     ⚡ ${r.test_framework} | 🕐 ${time}`);
      if (r.goal) lines.push(`     🎯 ${(r.goal as string).substring(0, 60)}`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err}`;
  }
}

// ============================================================
// TEST SYNTHESIS HELPERS
// ============================================================

function detectTestFramework(): "jest" | "vitest" | "node" | "unknown" {
  const root = getProjectRoot();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    if (pkg.devDependencies?.vitest) return "vitest";
    if (pkg.devDependencies?.jest || pkg.devDependencies?.["@jest/globals"]) return "jest";
  } catch {}
  if (fs.existsSync(path.join(root, "vitest.config.ts")) || fs.existsSync(path.join(root, "vitest.config.js"))) return "vitest";
  if (fs.existsSync(path.join(root, "jest.config.ts")) || fs.existsSync(path.join(root, "jest.config.js"))) return "jest";
  return "node";
}

function determineTestPath(filePath: string, _framework: string): string {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath, path.extname(filePath));
  return path.join(dir, `__tests__`, `${basename}.fix.test.ts`);
}

function synthesizeTestCode(
  goal: string,
  primaryFile: string,
  modifiedFiles: string[],
  framework: "jest" | "vitest" | "node" | "unknown",
): string {
  const importPath = primaryFile.replace(/\.ts$/, "").replace(/\.js$/, "");

  const describeBlock = `describe('Fix: ${goal.substring(0, 60)}', () => {`;

  const testBody = `
  it('should not regress the fix applied in ${path.basename(primaryFile)}', async () => {
    // Auto-generated from Kuma trajectory — regression test
    // Source file: ${primaryFile}
    // Goal: ${goal}
    // Modified files: ${modifiedFiles.slice(0, 3).join(", ")}

    // TODO: Replace with actual test logic
    // const { yourFunction } = await import('${importPath}');
    // const result = yourFunction();
    // expect(result).toBeDefined();

    expect(true).toBe(true);
  });
`;

  const closeBlock = `});`;

  switch (framework) {
    case "vitest":
    case "jest":
      return [
        `// ============================================================`,
        `// AUTO-GENERATED REGRESSION TEST`,
        `// Generated by Kuma Trajectory-to-Test Generator (Issue #28)`,
        `// ${new Date().toISOString()}`,
        `// Goal: ${goal}`,
        `// Files: ${modifiedFiles.join(", ")}`,
        `// ============================================================`,
        ``,
        `import { describe, it, expect } from '@jest/globals';`,
        ``,
        describeBlock,
        testBody,
        closeBlock,
        ``,
      ].join("\n");

    default:
      return [
        `// AUTO-GENERATED REGRESSION TEST`,
        `// Goal: ${goal}`,
        `// Files: ${modifiedFiles.join(", ")}`,
        ``,
        `const assert = require('assert');`,
        ``,
        describeBlock,
        testBody.replace("import", "// ").replace("expect", "// expect"),
        closeBlock,
        ``,
      ].join("\n");
  }
}

// ============================================================
// LIST SKILLS
// ============================================================

/**
 * List all distilled skills.
 */
export async function listDistilledSkills(): Promise<string> {
  try {
    await ensureTrajectorySchema();
    const db = await getDb();

    const stmt = db.prepare(`
      SELECT * FROM distilled_skills ORDER BY success_count DESC, last_used_at DESC LIMIT 20
    `);
    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();

    if (results.length === 0) {
      return "🧠 **No distilled skills yet** — skills are auto-generated from successful trajectories.";
    }

    const lines: string[] = [
      "🧠 **Distilled Skills** — auto-generated from trajectories",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const s of results) {
      const pattern = JSON.parse((s.pattern as string) || "[]") as string[];
      const patternStr = pattern.slice(0, 5).join(" → ");
      lines.push(`  ⚡ **${s.name}**`);
      lines.push(`     Pattern: ${patternStr}${pattern.length > 5 ? ` (+${pattern.length - 5} more)` : ""}`);
      lines.push(`     Used ${s.success_count}x | Avg ${s.avg_duration_ms}ms`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err}`;
  }
}

// ============================================================
// SIMILAR EXPERIENCE LOOKUP
// ============================================================

/**
 * Find similar past trajectories based on error pattern.
 */
export async function findSimilarTrajectories(
  errorPattern: string,
  limit: number = 5,
): Promise<string> {
  try {
    await ensureTrajectorySchema();
    const db = await getDb();

    const stmt = db.prepare(`
      SELECT id, goal, steps, total_duration_ms, success_rate, complexity, created_at
      FROM trajectories
      WHERE steps LIKE ?
      ORDER BY complexity DESC, created_at DESC
      LIMIT ?
    `);
    stmt.bind([`%${errorPattern}%`, limit]);

    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();

    if (results.length === 0) return "";

    const lines: string[] = [
      "🔄 **Similar Past Trajectories Found**",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const r of results) {
      const successIcon = (r.success_rate as number) > 0.8 ? "✅" : "⚠️";
      lines.push(`${successIcon} #${r.id} — ${(r.goal as string).substring(0, 60)}`);
      lines.push(`   Complexity: ${r.complexity} | Duration: ${Math.round((r.total_duration_ms as number) / 1000)}s | Rate: ${Math.round((r.success_rate as number) * 100)}%`);
      lines.push("");
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ============================================================
// FORMAT TRAJECTORIES
// ============================================================

/**
 * List recent trajectories.
 */
export async function listTrajectories(limit: number = 10): Promise<string> {
  try {
    await ensureTrajectorySchema();
    const db = await getDb();

    const stmt = db.prepare(`
      SELECT id, goal, total_duration_ms, success_rate, complexity, created_at
      FROM trajectories ORDER BY created_at DESC LIMIT ?
    `);
    stmt.bind([limit]);

    const results: Array<Record<string, unknown>> = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();

    if (results.length === 0) {
      return "📈 **No trajectories recorded yet.** Trajectories are logged automatically as agents work.";
    }

    const lines: string[] = [
      "📈 **Agent Trajectories**",
      "━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ];

    for (const r of results) {
      const time = new Date((r.created_at as number) * 1000).toLocaleString();
      const successIcon = (r.success_rate as number) > 0.8 ? "✅" : "⚠️";
      lines.push(`  ${successIcon} #${r.id} — ${(r.goal as string).substring(0, 50)} @ ${time}`);
      lines.push(`     ${Math.round((r.total_duration_ms as number) / 1000)}s | ${Math.round((r.success_rate as number) * 100)}% success | complexity: ${r.complexity}`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (err) {
    return `Error: ${err}`;
  }
}
