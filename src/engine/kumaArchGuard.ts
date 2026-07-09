// ============================================================
// KUMA ARCH GUARD — Architecture Guard (Phase 1.6)
// ============================================================
// Detects project architecture patterns (layered, clean, hexagonal)
// and checks for violations using the Knowledge Graph call analysis.
//
// Key concepts:
//   - architecture detection: identify the project's architecture pattern
//   - layer rules: which layers can depend on which
//   - violation detection: flag illegal dependency directions
// ============================================================

import { getDb } from "./kumaDb.js";
import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

interface ArchitectureProfile {
  name: string;
  layers: Layer[];
  rules: LayerRule[];
}

interface Layer {
  name: string;
  patterns: string[];  // file path patterns (glob-like)
  description: string;
}

interface LayerRule {
  from: string;   // layer name
  to: string;     // layer name  
  allowed: boolean; // true = allowed dependency, false = forbidden
}

interface ArchitectureViolation {
  sourceFile: string;
  targetFile: string;
  sourceLayer: string;
  targetLayer: string;
  rule: string;
  severity: "error" | "warning";
}

// Built-in architecture profiles
const ARCHITECTURES: ArchitectureProfile[] = [
  {
    name: "clean-architecture",
    layers: [
      { name: "domain", patterns: ["src/domain/**", "src/entities/**", "src/core/**"], description: "Domain entities and business rules" },
      { name: "application", patterns: ["src/application/**", "src/usecases/**", "src/services/**"], description: "Application use cases" },
      { name: "infrastructure", patterns: ["src/infrastructure/**", "src/repositories/**", "src/db/**", "src/external/**"], description: "Infrastructure implementations" },
      { name: "presentation", patterns: ["src/presentation/**", "src/controllers/**", "src/routes/**", "src/api/**", "src/web/**"], description: "API or UI layer" },
    ],
    rules: [
      // Domain: no dependencies allowed (innermost layer)
      { from: "domain", to: "application", allowed: false },
      { from: "domain", to: "infrastructure", allowed: false },
      { from: "domain", to: "presentation", allowed: false },
      // Application: can depend on domain
      { from: "application", to: "domain", allowed: true },
      { from: "application", to: "infrastructure", allowed: false },
      { from: "application", to: "presentation", allowed: false },
      // Infrastructure: can depend on domain + application
      { from: "infrastructure", to: "domain", allowed: true },
      { from: "infrastructure", to: "application", allowed: true },
      { from: "infrastructure", to: "presentation", allowed: false },
      // Presentation: can depend on application + domain
      { from: "presentation", to: "application", allowed: true },
      { from: "presentation", to: "domain", allowed: true },
      { from: "presentation", to: "infrastructure", allowed: false },
    ],
  },
  {
    name: "layered-architecture",
    layers: [
      { name: "data", patterns: ["src/data/**", "src/repositories/**", "src/models/**"], description: "Data access and models" },
      { name: "business", patterns: ["src/business/**", "src/services/**", "src/logic/**"], description: "Business logic layer" },
      { name: "presentation", patterns: ["src/presentation/**", "src/controllers/**", "src/routes/**", "src/api/**", "src/web/**"], description: "API or UI layer" },
    ],
    rules: [
      { from: "data", to: "business", allowed: false },
      { from: "data", to: "presentation", allowed: false },
      { from: "business", to: "data", allowed: true },
      { from: "business", to: "presentation", allowed: false },
      { from: "presentation", to: "data", allowed: false },
      { from: "presentation", to: "business", allowed: true },
    ],
  },
  {
    name: "hexagonal-architecture",
    layers: [
      { name: "domain", patterns: ["src/domain/**", "src/core/**", "src/hexagon/**"], description: "Core domain (hexagon)" },
      { name: "ports", patterns: ["src/ports/**", "src/interfaces/**"], description: "Port interfaces" },
      { name: "adapters", patterns: ["src/adapters/**", "src/infrastructure/**", "src/external/**"], description: "Adapters to external systems" },
    ],
    rules: [
      { from: "domain", to: "ports", allowed: false },
      { from: "domain", to: "adapters", allowed: false },
      { from: "ports", to: "domain", allowed: true },
      { from: "ports", to: "adapters", allowed: false },
      { from: "adapters", to: "domain", allowed: true },
      { from: "adapters", to: "ports", allowed: true },
    ],
  },
  {
    name: "mcp-server",
    layers: [
      { name: "tools", patterns: ["src/tools/**"], description: "MCP tool implementations" },
      { name: "engine", patterns: ["src/engine/**"], description: "Core engine" },
      { name: "agents", patterns: ["src/agents/**"], description: "AI agents" },
      { name: "utils", patterns: ["src/utils/**"], description: "Shared utilities" },
    ],
    rules: [
      { from: "tools", to: "engine", allowed: true },
      { from: "tools", to: "agents", allowed: true },
      { from: "tools", to: "utils", allowed: true },
      { from: "engine", to: "utils", allowed: true },
      { from: "engine", to: "tools", allowed: false },
      { from: "engine", to: "agents", allowed: false },
      { from: "agents", to: "engine", allowed: true },
      { from: "agents", to: "tools", allowed: false },
      { from: "agents", to: "utils", allowed: true },
    ],
  },
  {
    name: "flat",
    layers: [
      { name: "source", patterns: ["src/**"], description: "All source files" },
    ],
    rules: [],
  },
];

/**
 * Detect the project's architecture by analyzing directory structure.
 */
export function detectArchitecture(): ArchitectureProfile {
  const root = getProjectRoot();

  // Check for known architecture patterns
  const srcDir = path.join(root, "src");

  if (!fs.existsSync(srcDir)) {
    return getArchitectureProfile("flat");
  }

  // Count which architecture profiles match best
  const scores = ARCHITECTURES.map((arch) => {
    let matchCount = 0;
    let totalPatterns = 0;

    for (const layer of arch.layers) {
      for (const pattern of layer.patterns) {
        totalPatterns++;
        const globPattern = pattern.replace(/\/\*\*$/, "/**");
        try {
          const matches = fg.sync(globPattern, { cwd: root, onlyFiles: false, deep: 1 });
          if (matches.length > 0) matchCount++;
        } catch {}
      }
    }

    return { arch, score: totalPatterns > 0 ? matchCount / totalPatterns : 0 };
  });

  // Sort by score, pick best
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // If no architecture detected, check conventions for framework hints
  if (!best || best.score < 0.2) {
    // Default: try clean architecture if src/{domain,application,infrastructure} exists
    if (fs.existsSync(path.join(srcDir, "domain")) ||
        fs.existsSync(path.join(srcDir, "entities"))) {
      return getArchitectureProfile("clean-architecture");
    }
    if (fs.existsSync(path.join(srcDir, "data")) ||
        fs.existsSync(path.join(srcDir, "business"))) {
      return getArchitectureProfile("layered-architecture");
    }
    return getArchitectureProfile("flat");
  }

  return best.arch;
}

/**
 * Get an architecture profile by name.
 */
export function getArchitectureProfile(name: string): ArchitectureProfile {
  return ARCHITECTURES.find((a) => a.name === name) || ARCHITECTURES[ARCHITECTURES.length - 1];
}

/**
 * Determine which layer a file belongs to.
 */
function getLayerForFile(filePath: string, profile: ArchitectureProfile): string | null {
  for (const layer of profile.layers) {
    for (const pattern of layer.patterns) {
      // Convert glob pattern to regex
      const regexStr = pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
      if (new RegExp(`^${regexStr}$`).test(filePath)) {
        return layer.name;
      }
    }
  }
  return null;
}

/**
 * Check if a dependency between two files violates architecture rules.
 */
export function checkDependency(
  sourceFile: string,
  targetFile: string,
  profile?: ArchitectureProfile
): ArchitectureViolation | null {
  const arch = profile || detectArchitecture();
  const sourceLayer = getLayerForFile(sourceFile, arch);
  const targetLayer = getLayerForFile(targetFile, arch);

  if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) return null;

  // Find the rule
  const rule = arch.rules.find((r) => r.from === sourceLayer && r.to === targetLayer);
  if (!rule) return null;
  if (rule.allowed) return null;

  return {
    sourceFile,
    targetFile,
    sourceLayer,
    targetLayer,
    rule: `${sourceLayer} → ${targetLayer} (${arch.name})`,
    severity: "error",
  };
}

/**
 * Scan the knowledge graph for architecture violations.
 */
export async function scanGraphForViolations(profile?: ArchitectureProfile): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];
  const arch = profile || detectArchitecture();

  try {
    const db = await getDb();

    // Get all file→file edges from the graph (imports)
    const stmt = db.prepare(`
      SELECT e.source_id, e.target_id, n1.file_path as source_path, n2.file_path as target_path
      FROM edges e
      JOIN nodes n1 ON n1.id = e.source_id AND n1.type = 'file'
      JOIN nodes n2 ON n2.id = e.target_id AND n2.type = 'file'
      WHERE e.type = 'imports'
    `);

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const sourcePath = row.source_path as string;
      const targetPath = row.target_path as string;

      if (!sourcePath || !targetPath) continue;

      const violation = checkDependency(sourcePath, targetPath, arch);
      if (violation) {
        violations.push(violation);
      }
    }
    stmt.free();
  } catch (err) {
    console.error(`[KumaArchGuard] Failed to scan graph for violations: ${err}`);
  }

  return violations;
}

/**
 * Scan the filesystem for architecture violations by analyzing imports.
 */
export async function scanFilesystemForViolations(profile?: ArchitectureProfile): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];
  const arch = profile || detectArchitecture();
  const root = getProjectRoot();

  try {
    // Find all TypeScript source files
    const files = await fg(["src/**/*.{ts,tsx,js,jsx}"], {
      cwd: root,
      ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*", "**/*.d.ts"],
      onlyFiles: true,
    });

    // Regex to extract import paths
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

    for (const file of files.slice(0, 200)) {
      try {
        const content = fs.readFileSync(path.join(root, file), "utf-8");
        const imports: string[] = [];

        // Extract imports
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          imports.push(match[1]);
        }
        while ((match = requireRegex.exec(content)) !== null) {
          imports.push(match[1]);
        }

        // Check each import
        for (const imp of imports) {
          // Skip external imports (node_modules)
          if (!imp.startsWith(".") && !imp.startsWith("/") && !imp.startsWith("src/")) continue;

          // Resolve the import to a file path
          let targetFile = imp;
          if (imp.startsWith(".")) {
            const resolved = path.resolve(path.dirname(file), imp);
            targetFile = path.relative(root, resolved);
          } else if (imp.startsWith("/")) {
            targetFile = imp.substring(1);
          }

          // Add extensions if needed
          if (!path.extname(targetFile)) {
            const extVariants = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
            let found = false;
            for (const ext of extVariants) {
              if (fs.existsSync(path.join(root, targetFile + ext))) {
                targetFile += ext;
                found = true;
                break;
              }
            }
            if (!found) continue;
          }

          const violation = checkDependency(file, targetFile, arch);
          if (violation) {
            violations.push(violation);
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error(`[KumaArchGuard] Failed to scan filesystem: ${err}`);
  }

  return violations;
}

/**
 * Get all available architecture profiles.
 */
export function getArchitectureProfiles(): Array<{ name: string; description: string }> {
  return ARCHITECTURES
    .filter((a) => a.name !== "flat")
    .map((a) => ({
      name: a.name,
      description: `${a.name}: ${a.layers.map((l) => `${l.name}`).join(" → ")}`,
    }));
}

/**
 * Format violations as human-readable output.
 */
export function formatViolations(
  violations: ArchitectureViolation[],
  architectureName: string
): string {
  if (violations.length === 0) {
    return `✅ **Architecture Guard** — ${architectureName}\nNo violations found. All dependencies respect the architecture.`;
  }

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warning");

  const lines: string[] = [
    `🏗️ **Architecture Guard** — ${architectureName}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `❌ **${violations.length} violation(s) found** (${errors.length} errors, ${warnings.length} warnings)`,
    "",
  ];

  for (const v of violations) {
    const icon = v.severity === "error" ? "❌" : "⚠️";
    lines.push(`${icon} **${v.rule}**`);
    lines.push(`   📄 ${v.sourceFile}`);
    lines.push(`   → 📄 ${v.targetFile}`);
    lines.push("");
  }

  lines.push(
    "💡 These violations mean files are depending on layers they shouldn't.",
    "💡 Run kuma_arch_guard({ action: 'detect' }) to see detected architecture.",
    "💡 Fix by moving files to the correct layer or adding a valid abstraction.",
  );

  return lines.join("\n");
}

/**
 * Format architecture detection result.
 */
export function formatArchitectureDetection(profile: ArchitectureProfile): string {
  const lines: string[] = [
    `🏗️ **Detected Architecture** — ${profile.name}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    "**Layers:**",
  ];

  for (const layer of profile.layers) {
    lines.push(`  • **${layer.name}** — ${layer.description}`);
    for (const p of layer.patterns) {
      lines.push(`    📁 \`${p}\``);
    }
  }

  const relevantRules = profile.rules.filter((r) => !r.allowed);
  if (relevantRules.length > 0) {
    lines.push("", "**Forbidden Dependencies:**");
    for (const r of relevantRules) {
      lines.push(`  ❌ ${r.from} → ${r.to}`);
    }
  }

  lines.push(
    "",
    "💡 Run kuma_arch_guard({ action: 'scan' }) to check for violations.",
    "💡 Run kuma_arch_guard({ action: 'scan:graph' }) to check via knowledge graph.",
  );

  return lines.join("\n");
}
