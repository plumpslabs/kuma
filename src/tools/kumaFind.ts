import fg from "fast-glob";
import path from "node:path";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// KUMA FIND v2 — Ripgrep-first, blazing-fast file finder
// Replaces: find /path -name "*.ts" -path "*/src/*"
// ============================================================

export interface KumaFindParams {
  name?: string;
  path?: string;
  extensions?: string[];
  targetFolder?: string;
  maxResults?: number;
  type?: "file" | "dir" | "both";
  outputMode?: "rich" | "raw" | "json";
  compact?: boolean;
}

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.cache/**",
  "**/.kuma/backups/**",
  "**/coverage/**",
  "**/.nyc_output/**",
];

const CACHE_TTL_MS = 30_000;
const findCache = new Map<string, { results: string; timestamp: number }>();

let rgAvailable: boolean | null = null;

function isRipgrepAvailable(): boolean {
  if (process.env.KUMA_DISABLE_RG === "1" || process.env.KUMA_DISABLE_RG === "true") {
    return false;
  }
  if (rgAvailable !== null) return rgAvailable;
  try {
    execSync("rg --version", { stdio: "ignore", timeout: 2000 });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

function quotePath(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

export async function handleKumaFind(params: KumaFindParams): Promise<string> {
  const {
    name = "*",
    path: pathPattern,
    extensions,
    targetFolder,
    maxResults = 30,
    type = "file",
    outputMode = "rich",
    compact = false,
  } = params;

  // Determine name pattern
  const recursiveName = (!pathPattern && !targetFolder && !name.startsWith("**/"))
    ? `**/${name}`
    : name;

  // Build cache key
  const cacheKey = `${recursiveName}:${pathPattern ?? ""}:${targetFolder ?? ""}:${type}:${maxResults}:${extensions ? extensions.join(",") : ""}`;
  const cached = findCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  const projectRoot = getProjectRoot();
  let entries: string[];

  // Try ripgrep first (10-50x faster than fast-glob)
  if (isRipgrepAvailable() && type !== "dir") {
    entries = await tryRipgrepFind({
      name: recursiveName,
      pathPattern,
      targetFolder,
      extensions,
      maxResults,
      projectRoot,
    });
  } else {
    // Fallback to fast-glob
    entries = await fastGlobFind({
      name: recursiveName,
      pathPattern,
      targetFolder,
      extensions,
      maxResults,
      type,
      projectRoot,
    });
  }

  if (entries.length === 0) {
    const noResult = compact
      ? `0:${name}`
      : `🔍 No files found matching "${name}"${targetFolder ? ` in ${targetFolder}` : ""}.`;
    findCache.set(cacheKey, { results: noResult, timestamp: Date.now() });
    return noResult;
  }

  // Record to session
  sessionMemory.recordToolCall("kuma_find", {
    name,
    matchCount: entries.length,
    engine: rgAvailable ? "ripgrep" : "fast-glob",
  });

  // Format output
  let result: string;
  if (outputMode === "json") {
    result = JSON.stringify(entries);
  } else if (compact || outputMode === "raw") {
    result = entries.join("\n");
  } else {
    const lines = [
      `🔍 Find: "${name}"`,
      `📁 ${entries.length} files found${targetFolder ? ` in ${targetFolder}` : ""}`,
      "",
      ...entries.map((e, i) => `[${i + 1}] 📄 ${e}`),
    ];
    result = lines.join("\n");
  }

  findCache.set(cacheKey, { results: result, timestamp: Date.now() });
  return result;
}

// ============================================================
// RIPGREP ENGINE
// ============================================================

interface FindOptions {
  name: string;
  pathPattern?: string;
  targetFolder?: string;
  extensions?: string[];
  maxResults: number;
  projectRoot: string;
}

async function tryRipgrepFind(opts: FindOptions): Promise<string[]> {
  const { name, pathPattern, targetFolder, extensions, maxResults, projectRoot } = opts;

  const args: string[] = ["rg", "--files", "--no-ignore-vcs", "--color", "never"];

  // Exclude patterns
  for (const ignore of IGNORE_PATTERNS) {
    const glob = ignore.replace(/^\*\*\//, "");
    args.push("-g", `!${glob}`);
  }

  // File name pattern
  args.push("-g", name);

  // Path pattern (additional glob filter)
  if (pathPattern) {
    args.push("-g", pathPattern);
  }

  // Extensions
  if (extensions && extensions.length > 0) {
    for (const ext of extensions) {
      const clean = ext.startsWith(".") ? ext : `.${ext}`;
      args.push("-g", `*${clean}`);
    }
  }

  // Target directory
  const searchDir = targetFolder
    ? path.join(projectRoot, targetFolder)
    : projectRoot;
  args.push(quotePath(searchDir));

  try {
    const output = execSync(args.join(" "), {
      cwd: projectRoot,
      maxBuffer: 5 * 1024 * 1024,
      timeout: 10000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (!output || output.trim().length === 0) return [];

    // Parse output — rg --files returns one file per line
    let files = output.trim().split("\n").map((f) => f.trim()).filter(Boolean);

    // rg --files outputs paths RELATIVE to searchDir.
    // When targetFolder is set, prepend it so paths are relative to projectRoot
    // (matching the JS fallback behavior)
    if (targetFolder) {
      const prefix = targetFolder.replace(/\/+$/, "") + "/";
      files = files.map((f) => prefix + f);
    }

    return files.slice(0, maxResults);
  } catch (err: any) {
    // rg exits with code 1 when no matches — normal
    return [];
  }
}

// ============================================================
// FAST-GLOB FALLBACK ENGINE
// ============================================================

interface FastGlobOptions {
  name: string;
  pathPattern?: string;
  targetFolder?: string;
  extensions?: string[];
  maxResults: number;
  type: string;
  projectRoot: string;
}

async function fastGlobFind(opts: FastGlobOptions): Promise<string[]> {
  const { name, pathPattern, targetFolder, extensions, maxResults, type, projectRoot } = opts;

  // Build glob pattern
  const globParts: string[] = [];
  if (pathPattern) {
    globParts.push(pathPattern.replace(/^\/+/, "").replace(/\/+$/, ""));
  } else if (targetFolder) {
    globParts.push(targetFolder.replace(/^\/+/, "").replace(/\/+$/, ""));
  }
  globParts.push(name);
  const searchPattern = globParts.join("/");

  try {
    let entries = await fg(searchPattern, {
      cwd: projectRoot,
      ignore: IGNORE_PATTERNS,
      onlyFiles: type === "file",
      onlyDirectories: type === "dir",
      absolute: false,
      deep: 20,
      dot: false,
    });

    // Filter by extensions
    if (extensions && extensions.length > 0 && type !== "dir") {
      const normalizedExts = extensions.map((e) =>
        e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
      );
      entries = entries.filter((entry) => {
        const ext = path.extname(entry).toLowerCase();
        return normalizedExts.includes(ext);
      });
    }

    return entries.slice(0, maxResults);
  } catch {
    return [];
  }
}
