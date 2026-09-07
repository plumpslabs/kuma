// ============================================================
// KUMA ARCHITECTURE GUARD — Boundary & Dependency Rule Checker
// ============================================================
// Enforces architecture boundaries before or after code edits:
//   - Disallowed import directions (e.g. UI importing DB directly)
//   - Cross-package deep private imports (leaking internal modules)
//   - Package circular dependencies
// ============================================================

import fs from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import { getProjectRoot } from "../utils/pathValidator.js";
import { getWorkspaceInfo, findPackageForFile, type WorkspaceInfo } from "../engine/workspaceIntelligence.js";

export interface ArchitectureRule {
  from: string; // package name or path pattern, e.g. "packages/ide/*"
  disallow: string[]; // package names or path patterns that cannot be imported
  message?: string;
}

export interface ArchitectureViolation {
  sourceFile: string;
  targetImport: string;
  rule: string;
  severity: "high" | "medium";
  suggestion: string;
}

/**
 * Load configured architecture rules from .kuma/architecture.json or policy.yml
 */
export function loadArchitectureRules(root: string): ArchitectureRule[] {
  const rulesPath = path.join(root, ".kuma", "architecture.json");
  if (fs.existsSync(rulesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      if (Array.isArray(data.rules)) {
        return data.rules;
      }
    } catch {}
  }
  return [];
}

/**
 * Detect circular dependencies across workspace packages
 */
export function detectWorkspaceCircularDeps(wsInfo: WorkspaceInfo): string[][] {
  const circulars: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(current: string, pathTrace: string[]) {
    visited.add(current);
    recStack.add(current);
    pathTrace.push(current);

    const pkg = wsInfo.packageMap.get(current);
    if (pkg) {
      for (const dep of pkg.internalDependencies) {
        if (!visited.has(dep)) {
          dfs(dep, [...pathTrace]);
        } else if (recStack.has(dep)) {
          const cycleStart = pathTrace.indexOf(dep);
          circulars.push([...pathTrace.slice(cycleStart), dep]);
        }
      }
    }

    recStack.delete(current);
  }

  for (const pkg of wsInfo.packages) {
    if (!visited.has(pkg.name)) {
      dfs(pkg.name, []);
    }
  }

  return circulars;
}

/**
 * Scan modified files or all source files for boundary violations
 */
export async function checkArchitectureBoundaries(
  filesToCheck?: string[],
  customRoot?: string
): Promise<ArchitectureViolation[]> {
  const root = customRoot || getProjectRoot();
  const wsInfo = await getWorkspaceInfo(root);
  const violations: ArchitectureViolation[] = [];

  // 1. Check circular dependencies in workspace
  const circulars = detectWorkspaceCircularDeps(wsInfo);
  for (const cycle of circulars) {
    violations.push({
      sourceFile: cycle[0],
      targetImport: cycle[cycle.length - 1],
      rule: "circular-package-dependency",
      severity: "high",
      suggestion: `Circular dependency detected: ${cycle.join(" → ")}. Extract shared interfaces to a separate package.`,
    });
  }

  // 2. Select files to inspect
  let targetFiles = filesToCheck;
  if (!targetFiles || targetFiles.length === 0) {
    targetFiles = await fastGlob(["**/*.{ts,tsx,js,jsx,mjs,cjs}"], {
      cwd: root,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/.kuma/**"],
      onlyFiles: true,
    });
  }

  const customRules = loadArchitectureRules(root);
  const importRegex = /(?:import|export\s+.*from|require\s*\()\s*['"]([^'"]+)['"]/g;

  for (const file of targetFiles) {
    const fullPath = path.isAbsolute(file) ? file : path.join(root, file);
    if (!fs.existsSync(fullPath)) continue;

    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const currentPkg = findPackageForFile(file, wsInfo);
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];

      // A. Deep relative import into another package's private src
      if (wsInfo.isWorkspace && currentPkg && !currentPkg.isRoot) {
        if (importPath.startsWith("../") && (importPath.includes("/src/") || importPath.includes("/dist/"))) {
          const resolvedTarget = path.normalize(path.resolve(path.dirname(fullPath), importPath));
          const targetPkg = findPackageForFile(resolvedTarget, wsInfo);

          if (targetPkg && targetPkg.name !== currentPkg.name) {
            violations.push({
              sourceFile: file,
              targetImport: importPath,
              rule: "no-deep-cross-package-import",
              severity: "high",
              suggestion: `Do not deep-import private files from '${targetPkg.name}'. Use the public package name \`${targetPkg.name}\` or its exported API.`,
            });
          }
        }
      }

      // B. Custom Architecture Rules configured in .kuma/architecture.json
      for (const rule of customRules) {
        const matchesFrom = file.includes(rule.from) || (currentPkg && currentPkg.name === rule.from);
        if (matchesFrom) {
          for (const disallowed of rule.disallow) {
            if (importPath.includes(disallowed) || (currentPkg && disallowed === currentPkg.name)) {
              violations.push({
                sourceFile: file,
                targetImport: importPath,
                rule: `disallowed-boundary: ${rule.from} → ${disallowed}`,
                severity: "high",
                suggestion: rule.message || `Import from '${disallowed}' is forbidden in '${rule.from}'.`,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}
