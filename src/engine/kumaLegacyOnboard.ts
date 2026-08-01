// ============================================================
// KUMA LEGACY ONBOARD — Bulk Legacy-Codebase Bootstrap (P1)
// ============================================================
// One command to make a large legacy repo agent-ready:
//   1. Harvest git history → decisions + gotchas (reuse kumaGitHarvester)
//   2. Mine inline HACK/FIXME/TODO markers → gotchas
//   3. Build feature nodes from package structure
//   4. Generate architecture digest
//
// Wired via: kuma init --legacy
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// 1. GIT HARVEST — reuse existing harvester
// ============================================================

async function harvestGit(commitCount: number): Promise<string> {
  try {
    const { harvestGitHistory } = await import("./kumaGitHarvester.js");
    return await harvestGitHistory({ commitCount });
  } catch (err) {
    return `⚠️ Git harvest skipped: ${err}`;
  }
}

// ============================================================
// 2. INLINE MARKER MINING — HACK/FIXME/TODO → gotchas
// ============================================================

const MARKER_PATTERNS: Array<{ tag: string; regex: RegExp }> = [
  { tag: "HACK", regex: /\/\/\s*HACK:?\s*(.*)|#\s*HACK:?\s*(.*)|<!--\s*HACK:?\s*(.*)-->/i },
  { tag: "FIXME", regex: /\/\/\s*FIXME:?\s*(.*)|#\s*FIXME:?\s*(.*)|<!--\s*FIXME:?\s*(.*)-->/i },
  { tag: "TODO", regex: /\/\/\s*TODO:?\s*(.*)|#\s*TODO:?\s*(.*)|<!--\s*TODO:?\s*(.*)-->/i },
  { tag: "WARNING", regex: /\/\/\s*WARNING:?\s*(.*)|#\s*WARNING:?\s*(.*)|<!--\s*WARNING:?\s*(.*)-->/i },
  { tag: "XXX", regex: /\/\/\s*XXX:?\s*(.*)|#\s*XXX:?\s*(.*)|<!--\s*XXX:?\s*(.*)-->/i },
];

interface MinedMarker {
  filePath: string;
  line: number;
  tag: string;
  text: string;
}

async function mineInlineMarkers(root: string, maxFiles: number): Promise<MinedMarker[]> {
  const markers: MinedMarker[] = [];
  try {
    const { default: fg } = await import("fast-glob");
    const files = await fg(
      ["**/*.{ts,tsx,js,jsx,py,go,rs,java,kt,cs,rb,php,c,cpp,h,hpp}"],
      {
        cwd: root,
        ignore: ["node_modules/**", "dist/**", "build/**", ".git/**", ".kuma/**", "coverage/**", "vendor/**"],
        onlyFiles: true,
        deep: 8,
      }
    );

    for (const file of files.slice(0, maxFiles)) {
      try {
        const fullPath = path.join(root, file);
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && markers.length < 100; i++) {
          const line = lines[i];
          for (const { tag, regex } of MARKER_PATTERNS) {
            const m = regex.exec(line);
            if (m) {
              const text = (m[1] || m[2] || m[3] || line.trim()).trim().substring(0, 160);
              markers.push({ filePath: file, line: i + 1, tag, text });
              break;
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* fast-glob unavailable */ }
  return markers;
}

// ============================================================
// 3. FEATURE NODES — from package structure / src dirs
// ============================================================

async function buildFeatureNodes(root: string): Promise<{ created: number; names: string[] }> {
  const names: string[] = [];
  try {
    const { recordFeature } = await import("./kumaGraph.js");

    // Try package.json workspaces / main exports
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const candidates = [
          pkg.main, pkg.module, pkg.bin ? Object.keys(pkg.bin)[0] : null,
          ...(Array.isArray(pkg.exports) ? pkg.exports : []),
        ].filter(Boolean) as string[];
        for (const c of candidates.slice(0, 5)) {
          const name = path.basename(c, path.extname(c)).replace(/[^a-zA-Z0-9]/g, " ").trim();
          if (name && !names.includes(name)) {
            await recordFeature({ name, description: `Detected entry point during legacy onboarding (${c})`, files: [c] });
            names.push(name);
          }
        }
      } catch { /* ignore */ }
    }

    // Top-level src dirs → coarse features
    const srcDir = path.join(root, "src");
    if (fs.existsSync(srcDir)) {
      try {
        const entries = fs.readdirSync(srcDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .filter(n => !n.startsWith(".") && !["node_modules", "dist", "build", "__tests__", "test", "tests", "assets", "styles", "types", "utils"].includes(n));
        for (const dir of entries.slice(0, 15)) {
          if (!names.includes(dir)) {
            const files = [path.join("src", dir)];
            await recordFeature({
              name: dir,
              description: `Detected top-level module during legacy onboarding`,
              files,
              risk: "medium",
            });
            names.push(dir);
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { created: names.length, names };
}

// ============================================================
// 4. ARCHITECTURE DIGEST — entry points + chain summary
// ============================================================

function buildArchitectureDigest(root: string, featureNames: string[]): string {
  const lines: string[] = [];
  try {
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      lines.push(`🏗️ **Stack**: ${[pkg.framework, pkg.orm, pkg.testFramework].filter(Boolean).join(" + ") || "detected"}`);
    }
    if (featureNames.length > 0) {
      lines.push(`🧩 **Detected Modules**: ${featureNames.slice(0, 8).join(", ")}`);
    }
    lines.push(`📄 **Entry Points**: check package.json main/bin or src/index.*`);
  } catch { /* ignore */ }
  return lines.join("\n");
}

// ============================================================
// MAIN — runLegacyOnboarding
// ============================================================

export interface LegacyOnboardOptions {
  commitCount?: number;
  maxFiles?: number;
}

/**
 * Bulk-onboard a legacy codebase. Returns a structured report.
 */
export async function runLegacyOnboarding(options: LegacyOnboardOptions = {}): Promise<string> {
  const root = getProjectRoot();
  const commitCount = options.commitCount ?? 25;
  const maxFiles = options.maxFiles ?? 200;

  const lines: string[] = [
    "🚀 **Kuma Legacy Onboarding**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `📁 Project: ${root.split("/").pop() || "unknown"}`,
    "",
    "⏳ Running bulk analysis — this may take a few seconds...",
    "",
  ];

  // 1. Git harvest
  lines.push("### 1️⃣ Git History Harvest");
  try {
    const harvest = await harvestGit(commitCount);
    lines.push(harvest);
  } catch (err) {
    lines.push(`⚠️ ${err}`);
  }
  lines.push("");

  // 2. Inline markers → gotchas
  lines.push("### 2️⃣ Inline Marker Mining (HACK/FIXME/TODO → gotchas)");
  try {
    const markers = await mineInlineMarkers(root, maxFiles);
    if (markers.length === 0) {
      lines.push("✅ No HACK/FIXME/TODO markers found — clean codebase.");
    } else {
      const { addGotcha } = await import("./kumaGotchas.js");
      let recorded = 0;
      for (const m of markers.slice(0, 40)) {
        try {
          const severity = m.tag === "HACK" || m.tag === "WARNING" ? "high" : m.tag === "FIXME" ? "medium" : "low";
          await addGotcha({
            filePath: m.filePath,
            description: `[${m.tag}] ${m.text} (line ${m.line})`,
            severity: severity as "low" | "medium" | "high",
            workaround: `Legacy marker ${m.tag} at ${m.filePath}:${m.line} — review before modifying this file.`,
          });
          recorded++;
        } catch { /* skip duplicate */ }
      }
      lines.push(`⚠️ Found ${markers.length} marker(s); recorded ${recorded} as gotchas (capped at 40).`);
      lines.push(`💡 Remaining ${Math.max(0, markers.length - 40)} — re-run or use kuma_memory({ action: 'gotcha' }) inline.`);
    }
  } catch (err) {
    lines.push(`⚠️ Marker mining failed: ${err}`);
  }
  lines.push("");

  // 3. Feature nodes
  lines.push("### 3️⃣ Feature Graph Bootstrap");
  let featureNames: string[] = [];
  try {
    const feat = await buildFeatureNodes(root);
    featureNames = feat.names;
    lines.push(feat.created > 0
      ? `🧩 Built ${feat.created} feature node(s): ${feat.names.slice(0, 8).join(", ")}`
      : "ℹ️ No obvious top-level features detected — record manually via kuma_memory({ action: 'feature' }).");
  } catch (err) {
    lines.push(`⚠️ Feature bootstrap failed: ${err}`);
  }
  lines.push("");

  // 4. Architecture digest
  lines.push("### 4️⃣ Architecture Digest");
  try {
    const digest = buildArchitectureDigest(root, featureNames);
    lines.push(digest);
  } catch { /* ignore */ }
  lines.push("");

  // Wrap-up
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("✅ **Onboarding complete.** Suggested next steps:");
  lines.push("  • `kuma_context({ action: 'digest' })` — compact briefing");
  lines.push("  • `kuma_context({ action: 'research', scope: '<area>' })` — deep-dive first area");
  lines.push("  • `kuma_memory({ action: 'arch_flow', content: 'domain: X | hops: a → b → c' })` — map core flows");
  lines.push("  • `kuma_safety({ action: 'heal' })` — repair any stale graph entries");

  return lines.join("\n");
}
