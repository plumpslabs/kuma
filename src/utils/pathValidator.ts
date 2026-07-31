import path from "node:path";
import fs from "node:fs";
// ============================================================
// SANDBOX DIRECTORY LOCKING
// ============================================================

/**
 * Validates that a file path is within the allowed project directory.
 * Prevents path traversal attacks and access to system files.
 */
export function validateFilePath(
  filePath: string,
  projectRoot?: string,
): { valid: true; resolvedPath: string } | { valid: false; error: Error } {
  try {
    const root = projectRoot ?? getProjectRoot();
    const resolvedRoot = path.resolve(root);
    const normalizedRoot = path.normalize(resolvedRoot).toLowerCase();
    let resolvedPath: string;

    if (!path.isAbsolute(filePath)) {
      const cwdPath = path.resolve(process.cwd(), filePath);
      const normalizedCwdPath = path.normalize(cwdPath).toLowerCase();
      if (
        fs.existsSync(cwdPath) &&
        normalizedCwdPath.startsWith(normalizedRoot)
      ) {
        resolvedPath = cwdPath;
      } else {
        resolvedPath = path.resolve(resolvedRoot, filePath);
      }
    } else {
      resolvedPath = path.resolve(resolvedRoot, filePath);
    }

    const normalizedPath = path.normalize(resolvedPath).toLowerCase();

    // Check: path must be within project root
    if (!normalizedPath.startsWith(normalizedRoot)) {
      return {
        valid: false,
        error: new Error(
          `PATH_TRAVERSAL: Access denied. Path "${filePath}" resolves outside project root "${resolvedRoot}".`,
        ),
      };
    }

    // Check: path must not contain symlink escapes
    if (normalizedPath.includes("..")) {
      return {
        valid: false,
        error: new Error(
          `PATH_TRAVERSAL: Path traversal detected in "${filePath}". Relative paths with ".." are not allowed.`,
        ),
      };
    }

    // Block access to sensitive system directories
    const blockedPatterns = [
      "/etc/",
      "/sys/",
      "/proc/",
      "/dev/",
      "/boot/",
      "/usr/",
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      "C:\\System32",
      "~/.ssh",
      "/root/",
    ];

    for (const pattern of blockedPatterns) {
      if (normalizedPath.includes(pattern.toLowerCase())) {
        return {
          valid: false,
          error: new Error(
            `PATH_TRAVERSAL: Access to system directory "${pattern}" is blocked.`,
          ),
        };
      }
    }

    // Resolve symlinks to prevent symlink escape attacks.
    // If a symlink points outside the project root, block access.
    try {
      if (fs.existsSync(resolvedPath)) {
        const realPath = fs.realpathSync(resolvedPath);
        const normalizedRealPath = path.normalize(realPath).toLowerCase();
        if (!normalizedRealPath.startsWith(normalizedRoot)) {
          return {
            valid: false,
            error: new Error(
              `PATH_TRAVERSAL: Symlink escape detected. Path "${filePath}" resolves to "${realPath}" which is outside project root "${resolvedRoot}".`,
            ),
          };
        }
      }
    } catch {
      // realpathSync throws ENOENT for non-existent files — fall through
    }

    // Check: node_modules access (read-only allowed but warn)
    if (normalizedPath.includes("node_modules")) {
      return {
        valid: true,
        resolvedPath,
        // Warning will be handled by caller
      };
    }

    return { valid: true, resolvedPath };
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error
          ? err
          : new Error(`Path validation error: ${String(err)}`),
    };
  }
}

/**
 * Validates that a file extension is in the allowed list for writing.
 */
export function validateFileExtension(filePath: string): boolean {
  const allowedExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".html",
    ".htm",
    ".env",
    ".env.example",
    ".env.local",
    ".yml",
    ".yaml",
    ".toml",
    ".svg",
    ".png",
    ".jpg",
    ".gif",
    ".sh",
    ".bat",
    ".ps1",
    ".sql",
    ".graphql",
    ".gql",
    ".vue",
    ".svelte",
    ".astro",
    ".prisma",
    ".proto",
    ".txt",
    ".log",
  ];

  const ext = path.extname(filePath).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Gets the project root directory.
 * Defaults to current working directory.
 */
export function getProjectRoot(): string {
  return process.env.AGENT_PROJECT_ROOT ?? process.cwd();
}

/**
 * Checks if a file exists and is readable.
 */
export function isReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a directory is writable.
 */
export function isWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates backup path for a file.
 */
export function getBackupPath(filePath: string, timestamp?: number): string {
  const ts = timestamp ?? Date.now();
  const root = getProjectRoot();
  const relativePath = path.relative(root, filePath);
  return path.join(root, ".kuma", "backups", String(ts), relativePath);
}

/**
 * Ensure .kuma/backups directory exists
 */
export function ensureBackupDir(): string {
  const root = getProjectRoot();
  const backupDir = path.join(root, ".kuma", "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
}

/**
 * Gets the .kuma directory path (used for database and session storage).
 * Creates it if it doesn't exist.
 */
export function getKumaDir(): string {
  const root = getProjectRoot();
  return path.join(root, ".kuma");
}

export function getKumaBackupsDir(): string {
  return path.join(getKumaDir(), "backups");
}

// ============================================================
// SCOPE NORMALIZATION — Prevent duplicate nodes from path variants
// ============================================================

/**
 * Normalize a scope/path to a canonical form relative to project root.
 * Handles: absolute paths, file:line format, backslash/forward slash,
 * leading ./ or ../, and strips trailing whitespace.
 *
 * Returns null if the scope is not a resolvable file path (e.g., a domain name).
 */
export function normalizeScope(raw: string, projectRoot?: string): string | null {
  if (!raw || !raw.trim()) return null;
  const root = projectRoot ?? getProjectRoot();

  let scope = raw.trim();

  // Strip file:line format (e.g., "src/auth.ts:403" → "src/auth.ts")
  const lineMatch = scope.match(/^(.+):(\d+)$/);
  if (lineMatch) scope = lineMatch[1];

  // Normalize backslashes to forward slashes
  scope = scope.replace(/\\/g, "/");

  // If it looks like a domain name (no slashes, no extension), return as-is
  if (!scope.includes("/") && !scope.includes(".")) return scope;

  // Try to resolve relative to project root
  const resolved = path.resolve(root, scope);
  const relative = path.relative(root, resolved);

  // If resolved path escapes project root, return normalized string only
  if (relative.startsWith("..")) return scope.replace(/^\.\//, "");

  // Return forward-slash relative path
  return relative.replace(/\\/g, "/");
}

/**
 * Normalize a node ID by normalizing its scope portion.
 * e.g., "file::ProspectAssignmentService.js" → "file::crm_sales_backend/src/.../ProspectAssignmentService.js"
 */
export function normalizeNodeId(type: string, rawName: string, projectRoot?: string): string {
  const normalized = normalizeScope(rawName, projectRoot);
  return normalized ? `${type}::${normalized}` : `${type}::${rawName}`;
}
