import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// SAFETY POLICY — Parse .kuma/policy.yml and enforce rules
// ============================================================

interface KumaPolicy {
  never_touch?: string[];
  require_review?: string[];
  require_tests?: string[];
  max_file_size?: number;
  block_commands?: string[];
}

interface PolicyViolation {
  rule: string;
  pattern: string;
  message: string;
  severity: "error" | "warning";
}

interface PolicyWarning {
  rule: string;
  message: string;
}

const DEFAULT_POLICY: KumaPolicy = {
  never_touch: [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "node_modules/**",
  ],
  block_commands: [
    "rm -rf",
    "rm -fr",
    "git push --force",
    "git push -f",
    "npm publish",
    "yarn publish",
    "pnpm publish",
    "curl | bash",
    "curl | sh",
  ],
};

/**
 * Load policy from .kuma/policy.yml or .kuma/policy.yaml.
 * Falls back to DEFAULT_POLICY if no file exists.
 */
export function loadPolicy(): KumaPolicy {
  const root = getProjectRoot();
  const ymlPath = path.join(root, ".kuma", "policy.yml");
  const yamlPath = path.join(root, ".kuma", "policy.yaml");

  let policyContent: string | null = null;
  let policyPath: string | null = null;

  if (fs.existsSync(ymlPath)) {
    policyContent = fs.readFileSync(ymlPath, "utf-8");
    policyPath = ymlPath;
  } else if (fs.existsSync(yamlPath)) {
    policyContent = fs.readFileSync(yamlPath, "utf-8");
    policyPath = yamlPath;
  }

  if (!policyContent) {
    return { ...DEFAULT_POLICY };
  }

  try {
    return parseSimpleYaml(policyContent);
  } catch (err) {
    console.error(`[Policy] Failed to parse ${policyPath}: ${err}. Using defaults.`);
    return { ...DEFAULT_POLICY };
  }
}

/**
 * Simple YAML parser for policy files.
 * Supports: strings, arrays, and nested keys.
 */
function parseSimpleYaml(content: string): KumaPolicy {
  const policy: KumaPolicy = {};
  const lines = content.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith("#")) continue;

    // Check for key: value or key:
    const keyMatch = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (keyMatch) {
      // Save previous array if exists
      if (currentKey && currentArray.length > 0) {
        setPolicyValue(policy, currentKey, currentArray);
        currentArray = [];
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value === "" || value === "|") {
        // Start of array (next indented lines)
        currentArray = [];
      } else {
        // Inline value
        if (value.startsWith("[") && value.endsWith("]")) {
          // Inline array: [a, b, c]
          const items = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
          setPolicyValue(policy, currentKey, items);
        } else {
          // Single string value
          setPolicyValue(policy, currentKey, value.replace(/^['"]|['"]$/g, ""));
        }
        currentKey = null;
      }
    } else if (currentKey && line.startsWith("- ")) {
      // Array item
      currentArray.push(line.slice(2).trim().replace(/^['"]|['"]$/g, ""));
    }
  }

  // Save last array
  if (currentKey && currentArray.length > 0) {
    setPolicyValue(policy, currentKey, currentArray);
  }

  return policy;
}

function setPolicyValue(policy: KumaPolicy, key: string, value: unknown): void {
  switch (key) {
    case "never_touch":
      policy.never_touch = value as string[];
      break;
    case "require_review":
      policy.require_review = value as string[];
      break;
    case "require_tests":
      policy.require_tests = value as string[];
      break;
    case "max_file_size":
      policy.max_file_size = Number(value);
      break;
    case "block_commands":
      policy.block_commands = value as string[];
      break;
  }
}

/**
 * Check if a glob pattern matches a path.
 * Simple glob matching: supports **, *, and ?.
 */
function matchesGlob(pattern: string, filePath: string): boolean {
  // Normalize paths
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Convert glob to regex
  let regexStr = "^";
  for (let i = 0; i < normalizedPattern.length; i++) {
    const ch = normalizedPattern[i];
    if (ch === "*" && normalizedPattern[i + 1] === "*" && normalizedPattern[i + 2] === "/") {
      regexStr += "(.+/)?";
      i += 2;
    } else if (ch === "*") {
      regexStr += "[^/]*";
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else {
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr).test(normalizedPath);
  } catch {
    return false;
  }
}

/**
 * Check a file path against the policy.
 */
export function checkFilePathPolicy(filePath: string, policy: KumaPolicy): { violations: PolicyViolation[]; warnings: PolicyWarning[] } {
  const violations: PolicyViolation[] = [];
  const warnings: PolicyWarning[] = [];

  // Check never_touch
  if (policy.never_touch) {
    for (const pattern of policy.never_touch) {
      if (matchesGlob(pattern, filePath)) {
        violations.push({
          rule: "never_touch",
          pattern,
          message: `File "${filePath}" matches never_touch pattern "${pattern}"`,
          severity: "error",
        });
      }
    }
  }

  // Check max_file_size
  if (policy.max_file_size && policy.max_file_size > 0) {
    try {
      const root = getProjectRoot();
      const fullPath = path.join(root, filePath);
      if (fs.existsSync(fullPath)) {
        const sizeKB = fs.statSync(fullPath).size / 1024;
        if (sizeKB > policy.max_file_size) {
          violations.push({
            rule: "max_file_size",
            pattern: `${policy.max_file_size}KB`,
            message: `File "${filePath}" is ${Math.round(sizeKB)}KB, exceeds max_file_size of ${policy.max_file_size}KB`,
            severity: "error",
          });
        }
      }
    } catch {
      // File doesn't exist yet - skip size check
    }
  }

  // Check require_review
  if (policy.require_review) {
    for (const pattern of policy.require_review) {
      if (matchesGlob(pattern, filePath)) {
        warnings.push({
          rule: "require_review",
          message: `File "${filePath}" requires review (matches "${pattern}")`,
        });
      }
    }
  }

  return { violations, warnings };
}


