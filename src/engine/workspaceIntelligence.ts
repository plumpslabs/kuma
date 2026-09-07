// ============================================================
// KUMA WORKSPACE INTELLIGENCE — Monorepo & Package Dependency Engine
// ============================================================
// Detects monorepo topologies (pnpm, npm, yarn, cargo, go),
// maps internal package dependencies and reverse dependencies (consumers),
// and determines downstream affected packages & test scopes.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import { getProjectRoot } from "../utils/pathValidator.js";

export interface WorkspacePackage {
  name: string;
  path: string; // relative to root, e.g. "packages/ide/studio"
  absPath: string;
  version?: string;
  description?: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  internalDependencies: string[];
  testCommand?: string;
  entryPoints: string[];
  isRoot?: boolean;
}

export interface WorkspaceInfo {
  isWorkspace: boolean;
  type: "pnpm" | "npm" | "yarn" | "cargo" | "go" | "standalone";
  root: string;
  packages: WorkspacePackage[];
  packageMap: Map<string, WorkspacePackage>;
}

export interface AffectedAnalysis {
  directlyModifiedPackages: WorkspacePackage[];
  downstreamPackages: WorkspacePackage[];
  allAffectedPackages: WorkspacePackage[];
  affectedTestCommands: string[];
}

let _cachedWorkspaceInfo: WorkspaceInfo | null = null;
let _cachedRoot: string | null = null;

/**
 * Reset workspace cache (useful in tests or when files change)
 */
export function clearWorkspaceCache(): void {
  _cachedWorkspaceInfo = null;
  _cachedRoot = null;
}

/**
 * Parse package globs from pnpm-workspace.yaml
 */
function parsePnpmWorkspaceGlobs(content: string): string[] {
  const globs: string[] = [];
  const lines = content.split("\n");
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("packages:")) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith("-")) {
        const cleaned = trimmed.replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, "").trim();
        if (cleaned && !cleaned.startsWith("#")) {
          globs.push(cleaned);
        }
      } else if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
        // Exited packages section
        break;
      }
    }
  }

  return globs.length > 0 ? globs : ["packages/*"];
}

/**
 * Inspect root files to determine workspace type and package glob patterns
 */
function detectWorkspaceType(root: string): { type: WorkspaceInfo["type"]; globs: string[] } {
  // 1. pnpm-workspace.yaml
  const pnpmWs = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWs)) {
    try {
      const content = fs.readFileSync(pnpmWs, "utf-8");
      return { type: "pnpm", globs: parsePnpmWorkspaceGlobs(content) };
    } catch {
      return { type: "pnpm", globs: ["packages/*"] };
    }
  }

  // 2. package.json workspaces (npm / yarn / bun)
  const rootPkgPath = path.join(root, "package.json");
  if (fs.existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
      if (pkg.workspaces) {
        let globs: string[] = [];
        if (Array.isArray(pkg.workspaces)) {
          globs = pkg.workspaces;
        } else if (Array.isArray(pkg.workspaces.packages)) {
          globs = pkg.workspaces.packages;
        }
        const hasYarnLock = fs.existsSync(path.join(root, "yarn.lock"));
        return { type: hasYarnLock ? "yarn" : "npm", globs };
      }
    } catch {}
  }

  // 3. Cargo workspace
  const cargoToml = path.join(root, "Cargo.toml");
  if (fs.existsSync(cargoToml)) {
    try {
      const content = fs.readFileSync(cargoToml, "utf-8");
      if (content.includes("[workspace]")) {
        const memberMatch = content.match(/members\s*=\s*\[([^\]]+)\]/);
        if (memberMatch) {
          const members = memberMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/['"]/g, ""))
            .filter(Boolean);
          return { type: "cargo", globs: members };
        }
        return { type: "cargo", globs: ["crates/*", "packages/*"] };
      }
    } catch {}
  }

  // 4. Go work
  const goWork = path.join(root, "go.work");
  if (fs.existsSync(goWork)) {
    try {
      const content = fs.readFileSync(goWork, "utf-8");
      const uses = Array.from(content.matchAll(/\buse\s+(?:\(\s*([\s\S]*?)\s*\)|([^\s\n]+))/g));
      const dirs: string[] = [];
      for (const m of uses) {
        if (m[1]) {
          dirs.push(...m[1].split(/\s+/).filter(Boolean));
        } else if (m[2]) {
          dirs.push(m[2].trim());
        }
      }
      return { type: "go", globs: dirs.length > 0 ? dirs : ["./*"] };
    } catch {}
  }

  return { type: "standalone", globs: [] };
}

/**
 * Load package metadata from a package.json file
 */
function loadNodePackage(pkgJsonPath: string, root: string, isRoot = false): WorkspacePackage | null {
  try {
    const content = fs.readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content);
    const absPath = path.dirname(pkgJsonPath);
    const relPath = path.relative(root, absPath) || ".";
    const name = pkg.name || (isRoot ? path.basename(root) : path.basename(relPath));

    const dependencies = Object.keys(pkg.dependencies || {});
    const devDependencies = Object.keys(pkg.devDependencies || {});
    const scripts = pkg.scripts || {};

    let testCommand = undefined;
    if (scripts.test) {
      testCommand = scripts.test;
    }

    const entryPoints: string[] = [];
    if (pkg.main) entryPoints.push(path.normalize(pkg.main));
    if (pkg.module) entryPoints.push(path.normalize(pkg.module));
    if (pkg.exports) {
      if (typeof pkg.exports === "string") {
        entryPoints.push(path.normalize(pkg.exports));
      } else if (typeof pkg.exports === "object") {
        for (const val of Object.values(pkg.exports)) {
          if (typeof val === "string") entryPoints.push(path.normalize(val));
          else if (val && typeof val === "object") {
            const def = (val as any).default || (val as any).import;
            if (typeof def === "string") entryPoints.push(path.normalize(def));
          }
        }
      }
    }

    // Common standard files if not specified
    if (entryPoints.length === 0) {
      for (const candidate of ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "index.ts", "index.js"]) {
        if (fs.existsSync(path.join(absPath, candidate))) {
          entryPoints.push(candidate);
          break;
        }
      }
    }

    return {
      name,
      path: relPath,
      absPath,
      version: pkg.version,
      description: pkg.description,
      scripts,
      dependencies,
      devDependencies,
      internalDependencies: [], // populated later
      testCommand,
      entryPoints,
      isRoot,
    };
  } catch {
    return null;
  }
}

/**
 * Scan and resolve the complete workspace graph
 */
export async function getWorkspaceInfo(root?: string, forceRefresh = false): Promise<WorkspaceInfo> {
  const projectRoot = root || getProjectRoot();

  if (_cachedWorkspaceInfo && _cachedRoot === projectRoot && !forceRefresh) {
    return _cachedWorkspaceInfo;
  }

  const { type, globs } = detectWorkspaceType(projectRoot);
  const packages: WorkspacePackage[] = [];
  const packageMap = new Map<string, WorkspacePackage>();

  // Always load the root package if package.json exists
  const rootPkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = loadNodePackage(rootPkgPath, projectRoot, true);
    if (rootPkg) {
      packages.push(rootPkg);
      packageMap.set(rootPkg.name, rootPkg);
    }
  }

  // If workspace globs found, discover subpackages
  if (globs.length > 0 && type !== "standalone") {
    const patterns = globs.map((g) => {
      if (g.endsWith("package.json")) return g;
      const clean = g.replace(/\/+$/, "");
      return `${clean}/package.json`;
    });

    try {
      const matches = await fastGlob(patterns, {
        cwd: projectRoot,
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.kuma/**"],
        onlyFiles: true,
      });

      for (const match of matches) {
        const fullPath = path.join(projectRoot, match);
        // Don't re-add root package
        if (path.normalize(fullPath) === path.normalize(rootPkgPath)) continue;

        const pkg = loadNodePackage(fullPath, projectRoot, false);
        if (pkg) {
          packages.push(pkg);
          packageMap.set(pkg.name, pkg);
        }
      }
    } catch {}
  }

  // Populate internal dependencies by matching package names
  const allNames = new Set(packages.map((p) => p.name));
  for (const pkg of packages) {
    const combined = new Set([...pkg.dependencies, ...pkg.devDependencies]);
    pkg.internalDependencies = Array.from(combined).filter((dep) => allNames.has(dep) && dep !== pkg.name);
  }

  const isWorkspace = packages.length > 1 || type !== "standalone";

  _cachedWorkspaceInfo = {
    isWorkspace,
    type,
    root: projectRoot,
    packages,
    packageMap,
  };
  _cachedRoot = projectRoot;

  return _cachedWorkspaceInfo;
}

/**
 * Given a file path (relative or absolute), determine which workspace package it belongs to.
 */
export function findPackageForFile(filePath: string, wsInfo: WorkspaceInfo): WorkspacePackage | null {
  const normFile = path.normalize(filePath);
  const relFile = path.isAbsolute(normFile) ? path.relative(wsInfo.root, normFile) : normFile;

  let bestMatch: WorkspacePackage | null = null;
  let maxLen = -1;

  for (const pkg of wsInfo.packages) {
    if (pkg.isRoot) continue; // prefer subpackages over root
    const pkgRel = path.normalize(pkg.path);
    if (relFile === pkgRel || relFile.startsWith(pkgRel + path.sep)) {
      if (pkgRel.length > maxLen) {
        maxLen = pkgRel.length;
        bestMatch = pkg;
      }
    }
  }

  if (bestMatch) return bestMatch;

  // Fallback to root package if present
  const rootPkg = wsInfo.packages.find((p) => p.isRoot);
  return rootPkg || null;
}

/**
 * Find all packages that depend on the given package (downstream consumers)
 */
export function getReverseDependencies(pkgName: string, wsInfo: WorkspaceInfo): WorkspacePackage[] {
  const consumers: WorkspacePackage[] = [];
  for (const pkg of wsInfo.packages) {
    if (pkg.name === pkgName) continue;
    if (pkg.internalDependencies.includes(pkgName)) {
      consumers.push(pkg);
    }
  }
  return consumers;
}

/**
 * Given a list of modified files, compute:
 * 1. Directly modified packages
 * 2. Downstream packages (transitively affected)
 * 3. Scoped test commands
 */
export function getAffectedPackages(modifiedFiles: string[], wsInfo: WorkspaceInfo): AffectedAnalysis {
  const directlyModifiedMap = new Map<string, WorkspacePackage>();

  for (const file of modifiedFiles) {
    const pkg = findPackageForFile(file, wsInfo);
    if (pkg) {
      directlyModifiedMap.set(pkg.name, pkg);
    }
  }

  const directlyModified = Array.from(directlyModifiedMap.values());
  const downstreamMap = new Map<string, WorkspacePackage>();

  // Breadth-first traversal to find all downstream consumers
  const queue = [...directlyModified];
  const visited = new Set<string>(queue.map((p) => p.name));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const revDeps = getReverseDependencies(current.name, wsInfo);
    for (const dep of revDeps) {
      if (!visited.has(dep.name)) {
        visited.add(dep.name);
        downstreamMap.set(dep.name, dep);
        queue.push(dep);
      }
    }
  }

  const downstream = Array.from(downstreamMap.values());
  const allAffected = [...directlyModified, ...downstream];

  // Construct test commands based on workspace type
  const testCommands: string[] = [];
  if (allAffected.length > 0) {
    const nonRootPkgs = allAffected.filter((p) => !p.isRoot);
    const targetPkgs = nonRootPkgs.length > 0 ? nonRootPkgs : allAffected;

    if (wsInfo.type === "pnpm") {
      const filterArgs = targetPkgs.map((p) => `--filter "${p.name}"`).join(" ");
      testCommands.push(`pnpm ${filterArgs} test`);
    } else if (wsInfo.type === "npm") {
      const wsArgs = targetPkgs.map((p) => `--workspace="${p.name}"`).join(" ");
      testCommands.push(`npm test ${wsArgs}`);
    } else if (wsInfo.type === "yarn") {
      for (const p of targetPkgs) {
        testCommands.push(`yarn workspace ${p.name} test`);
      }
    } else {
      for (const p of targetPkgs) {
        if (p.testCommand) {
          testCommands.push(`cd ${p.path} && npm test`);
        }
      }
    }
  }

  return {
    directlyModifiedPackages: directlyModified,
    downstreamPackages: downstream,
    allAffectedPackages: allAffected,
    affectedTestCommands: testCommands,
  };
}

/**
 * Format a lean, structured repository map for AI agents
 */
export function formatWorkspaceMap(wsInfo: WorkspaceInfo): string {
  if (!wsInfo.isWorkspace || wsInfo.packages.length <= 1) {
    const rootPkg = wsInfo.packages[0];
    return [
      `📦 **Repository Map (Standalone)**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `• Root: \`${path.basename(wsInfo.root)}\``,
      rootPkg?.description ? `• Description: ${rootPkg.description}` : "",
      rootPkg?.entryPoints?.length ? `• Entrypoints: ${rootPkg.entryPoints.map((e) => `\`${e}\``).join(", ")}` : "",
      rootPkg?.scripts?.test ? `• Test command: \`${rootPkg.scripts.test}\`` : "",
    ].filter(Boolean).join("\n");
  }

  const lines: string[] = [
    `📦 **Workspace Repository Map (${wsInfo.type.toUpperCase()})**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Total packages: ${wsInfo.packages.length}`,
    "",
  ];

  for (const pkg of wsInfo.packages) {
    lines.push(`📦 **${pkg.name}** \`${pkg.path}\``);
    if (pkg.description) {
      lines.push(`   📝 ${pkg.description}`);
    }
    if (pkg.entryPoints && pkg.entryPoints.length > 0) {
      lines.push(`   🎯 Entry: ${pkg.entryPoints.slice(0, 3).map((e) => `\`${e}\``).join(", ")}`);
    }
    if (pkg.internalDependencies && pkg.internalDependencies.length > 0) {
      lines.push(`   🔗 Internal deps: ${pkg.internalDependencies.map((d) => `\`${d}\``).join(", ")}`);
    }
    const consumers = getReverseDependencies(pkg.name, wsInfo);
    if (consumers.length > 0) {
      lines.push(`   👥 Used by: ${consumers.map((c) => `\`${c.name}\``).join(", ")}`);
    }
    if (pkg.scripts && pkg.scripts.test) {
      lines.push(`   🧪 Test: \`${pkg.scripts.test}\``);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
