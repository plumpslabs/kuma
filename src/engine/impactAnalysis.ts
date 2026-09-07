// ============================================================
// KUMA IMPACT ANALYSIS — Blast Radius & Downstream Dependency Tracing
// ============================================================
// Calculates the full blast radius of a change:
//   - Directly affected file/symbol
//   - Package owner & downstream consumer packages
//   - Importing files (direct dependents)
//   - Associated unit and integration tests
//   - Risk assessment (low / medium / high / critical) with risk flags
// ============================================================

import fs from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import { getProjectRoot } from "../utils/pathValidator.js";
import {
  getWorkspaceInfo,
  findPackageForFile,
  getReverseDependencies,
  type WorkspacePackage,
} from "./workspaceIntelligence.js";

export type ImpactRisk = "low" | "medium" | "high" | "critical";

export interface DetailedImpactResult {
  target: string;
  targetType: "file" | "package" | "symbol" | "session";
  owningPackage: WorkspacePackage | null;
  directDependents: string[];
  downstreamPackages: string[];
  affectedTests: string[];
  risk: ImpactRisk;
  riskFlags: string[];
  summary: string;
  confidence: number;
}

/**
 * Find files in the repository that import a given file or package
 */
async function findImportingFiles(targetFile: string, root: string): Promise<string[]> {
  const normTarget = path.normalize(targetFile);
  const baseName = path.basename(normTarget, path.extname(normTarget));
  const relTarget = path.isAbsolute(normTarget) ? path.relative(root, normTarget) : normTarget;

  try {
    const files = await fastGlob(
      ["**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs}"],
      {
        cwd: root,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/.kuma/**"],
        onlyFiles: true,
      }
    );

    const dependents: string[] = [];
    const importRegex = new RegExp(
      `(?:import|from|require\\s*\\(|export\\s+.*from)\\s*['"][^'"]*\\b${baseName}(?:\\.[a-zA-Z0-9]+)?['"]`,
      "i"
    );

    for (const f of files) {
      if (path.normalize(f) === path.normalize(relTarget)) continue;
      const fullPath = path.join(root, f);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        if (importRegex.test(content)) {
          dependents.push(f);
        }
      } catch {}
    }

    return dependents;
  } catch {
    return [];
  }
}

/**
 * Find related test files for a target file or package
 */
async function findRelatedTests(
  targetFile: string,
  root: string,
  owningPackage: WorkspacePackage | null
): Promise<string[]> {
  const norm = path.normalize(targetFile);
  const baseName = path.basename(norm, path.extname(norm));
  const testFiles: string[] = [];

  const testPatterns = [
    `**/*${baseName}*.test.*`,
    `**/*${baseName}*.spec.*`,
    `**/*${baseName}*_test.*`,
    `**/tests/**/*${baseName}*.*`,
    `**/test/**/*${baseName}*.*`,
    `**/__tests__/**/*${baseName}*.*`,
  ];

  try {
    const matches = await fastGlob(testPatterns, {
      cwd: root,
      ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.kuma/**"],
      onlyFiles: true,
    });
    testFiles.push(...matches);
  } catch {}

  // If owning package has its own test directory, check tests in that package
  if (owningPackage && owningPackage.path !== ".") {
    try {
      const pkgTests = await fastGlob(["**/*.{test,spec}.*"], {
        cwd: path.join(root, owningPackage.path),
        ignore: ["**/node_modules/**", "**/dist/**"],
        onlyFiles: true,
      });
      for (const pt of pkgTests) {
        const fullRel = path.join(owningPackage.path, pt);
        if (!testFiles.includes(fullRel)) {
          testFiles.push(fullRel);
        }
      }
    } catch {}
  }

  return Array.from(new Set(testFiles));
}

/**
 * Determine risk level and risk flags
 */
function assessRisk(
  target: string,
  targetType: string,
  directDependents: string[],
  downstreamPackages: string[],
  affectedTests: string[],
  owningPackage: WorkspacePackage | null
): { risk: ImpactRisk; riskFlags: string[] } {
  const riskFlags: string[] = [];

  // 1. Critical path indicators
  if (/(database|schema|migration|auth|security|safety|guard|policy|payment|secret|billing)/i.test(target)) {
    riskFlags.push("Security/Critical domain file");
  }

  // 2. Public entrypoint
  if (owningPackage?.entryPoints.some((e) => target.endsWith(e) || e.includes(target))) {
    riskFlags.push("Public package entrypoint/export");
  }

  // 3. Cross-package impact
  if (downstreamPackages.length > 0) {
    riskFlags.push(`Cross-package impact: ${downstreamPackages.length} consumer package(s) affected`);
  }

  // 4. Dependents count
  if (directDependents.length > 8) {
    riskFlags.push(`High fan-in: ${directDependents.length} files depend directly on this`);
  }

  // 5. Test coverage check
  if (affectedTests.length === 0) {
    riskFlags.push("No direct test suite found for this target");
  }

  // 6. Target scope
  if (targetType === "package") {
    riskFlags.push("Package-level modification scope");
  }

  let risk: ImpactRisk = "low";
  if (
    riskFlags.includes("Security/Critical domain file") ||
    (downstreamPackages.length > 2 && riskFlags.includes("Public package entrypoint/export"))
  ) {
    risk = "critical";
  } else if (
    targetType === "package" ||
    downstreamPackages.length > 0 ||
    directDependents.length > 5 ||
    riskFlags.includes("Public package entrypoint/export")
  ) {
    risk = "high";
  } else if (directDependents.length > 0 || riskFlags.includes("No direct test suite found for this target")) {
    risk = "medium";
  }

  return { risk, riskFlags };
}

/**
 * Calculate the comprehensive Blast Radius of changing a file, package, or symbol
 */
export async function calculateBlastRadius(
  target: string,
  options: { root?: string } = {}
): Promise<DetailedImpactResult> {
  const root = options.root || getProjectRoot();
  const wsInfo = await getWorkspaceInfo(root);

  // 1. Determine target type
  let targetType: DetailedImpactResult["targetType"] = "file";
  const isPkg = wsInfo.packages.some((p) => p.name === target);
  if (isPkg) {
    targetType = "package";
  } else if (target.includes("/") || target.includes(".")) {
    targetType = "file";
  } else {
    targetType = "symbol";
  }

  // 2. Identify owning package
  let owningPackage: WorkspacePackage | null = null;
  if (targetType === "package") {
    owningPackage = wsInfo.packageMap.get(target) || null;
  } else {
    owningPackage = findPackageForFile(target, wsInfo);
  }

  // 3. Determine downstream packages
  const downstreamPackages: string[] = [];
  if (owningPackage && !owningPackage.isRoot) {
    const rev = getReverseDependencies(owningPackage.name, wsInfo);
    downstreamPackages.push(...rev.map((p) => p.name));
  }

  // 4. Find direct dependents (files importing this)
  let directDependents: string[] = [];
  if (targetType === "file" || targetType === "symbol") {
    directDependents = await findImportingFiles(target, root);
  }

  // 5. Find affected tests
  const affectedTests = await findRelatedTests(target, root, owningPackage);

  // 6. Risk assessment
  const { risk, riskFlags } = assessRisk(
    target,
    targetType,
    directDependents,
    downstreamPackages,
    affectedTests,
    owningPackage
  );

  // 7. Format markdown summary
  const summaryLines: string[] = [
    `🎯 **Impact / Blast Radius: \`${target}\`**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ **Risk Level: ${risk.toUpperCase()}**`,
    owningPackage ? `📦 Owning package: \`${owningPackage.name}\` (${owningPackage.path})` : "",
  ];

  if (riskFlags.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🚨 **Risk Flags:**`);
    for (const flag of riskFlags) {
      summaryLines.push(`  • ${flag}`);
    }
  }

  if (downstreamPackages.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🌐 **Downstream Consumer Packages (${downstreamPackages.length}):**`);
    for (const dp of downstreamPackages) {
      summaryLines.push(`  • \`${dp}\``);
    }
  }

  if (directDependents.length > 0) {
    summaryLines.push("");
    summaryLines.push(`📄 **Direct Dependents (${directDependents.length} file(s)):**`);
    for (const dep of directDependents.slice(0, 6)) {
      summaryLines.push(`  • \`${dep}\``);
    }
    if (directDependents.length > 6) {
      summaryLines.push(`  ... and ${directDependents.length - 6} more`);
    }
  }

  if (affectedTests.length > 0) {
    summaryLines.push("");
    summaryLines.push(`🧪 **Affected Test Suites (${affectedTests.length}):**`);
    for (const t of affectedTests.slice(0, 5)) {
      summaryLines.push(`  • \`${t}\``);
    }
    if (affectedTests.length > 5) {
      summaryLines.push(`  ... and ${affectedTests.length - 5} more`);
    }
  } else {
    summaryLines.push("");
    summaryLines.push(`⚠️ **No test suites detected for this scope.** Consider adding tests before editing.`);
  }

  return {
    target,
    targetType,
    owningPackage,
    directDependents,
    downstreamPackages,
    affectedTests,
    risk,
    riskFlags,
    summary: summaryLines.filter(Boolean).join("\n"),
    confidence: 0.85,
  };
}
