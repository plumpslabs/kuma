import fs from "node:fs";
import path from "node:path";
import { getKumaDir } from "../utils/pathValidator.js";

// ============================================================
// KUMA CONFIG — Parse .kuma/config.yml for all settings
// ============================================================

export interface KumaConfig {
  storage?: {
    keep_tool_calls?: number;
    keep_search_results?: number;
    keep_failures_days?: number;
    keep_backups_per_file?: number;
    keep_snapshots?: number;
    auto_prune?: boolean;
    prune_on_init?: boolean;
  };
  policy?: {
    never_touch?: string[];
    require_review?: string[];
    require_tests?: string[];
    max_file_size?: number;
    block_commands?: string[];
  };
}

const DEFAULT_CONFIG: KumaConfig = {
  storage: {
    keep_tool_calls: 100,
    keep_search_results: 50,
    keep_failures_days: 30,
    keep_backups_per_file: 30,
    keep_snapshots: 20,
    auto_prune: true,
    prune_on_init: true,
  },
};

/**
 * Load config from .kuma/config.yml.
 * Falls back to DEFAULT_CONFIG if no file exists.
 */
export function loadConfig(): KumaConfig {
  const kumaDir = getKumaDir();
  const configPath = path.join(kumaDir, "config.yml");

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return parseSimpleYamlConfig(content);
  } catch (err) {
    console.error(`[Config] Failed to parse config.yml: ${err}. Using defaults.`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Simple YAML parser for config files.
 * Supports nested keys with 2 levels of depth.
 */
function parseSimpleYamlConfig(content: string): KumaConfig {
  const config: KumaConfig = {};
  const lines = content.split("\n");
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Check for section header (e.g. "storage:")
    const sectionMatch = trimmed.match(/^(\w+):\s*(.*)/);
    if (sectionMatch && !trimmed.startsWith("  ")) {
      currentSection = sectionMatch[1];
      const value = sectionMatch[2].trim();
      if (value) {
        // Inline value at section level (unlikely but handle)
        setConfigValue(config, currentSection, value);
        currentSection = null;
      }
      continue;
    }

    // Check for key-value within a section (indented)
    const kvMatch = trimmed.match(/^(\w[\w_-]*):\s*(.*)/);
    if (kvMatch && currentSection) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        // Array: [a, b, c]
        const items = value.slice(1, -1).split(",").map((s) =>
          s.trim().replace(/^['"]|['"]$/g, "")
        );
        setNestedConfigValue(config, currentSection, key, items);
      } else if (value) {
        // Single value (number or string)
        const numVal = Number(value);
        const finalVal = isNaN(numVal) ? value.replace(/^['"]|['"]$/g, "") : numVal;
        setNestedConfigValue(config, currentSection, key, finalVal);
      }
    }
  }

  return config;
}

function setConfigValue(config: KumaConfig, key: string, value: unknown): void {
  (config as Record<string, unknown>)[key] = value;
}

function setNestedConfigValue(config: KumaConfig, section: string, key: string, value: unknown): void {
  const sectionObj = (config as Record<string, Record<string, unknown>>)[section] ?? {};
  sectionObj[key] = value;
  (config as Record<string, Record<string, unknown>>)[section] = sectionObj;
}

/**
 * Generate a default .kuma/config.yml file.
 */
export function generateDefaultConfig(): string {
  return `# Kuma Configuration
# See: https://github.com/plumpslabs/kuma

## Storage Settings
storage:
  # Maximum tool calls kept in session memory
  keep_tool_calls: 100
  # Maximum search results cached
  keep_search_results: 50
  # Days to keep resolved failures (0 = forever)
  keep_failures_days: 30
  # Maximum backups per file (oldest removed first)
  keep_backups_per_file: 30
  # Maximum context snapshots to keep
  keep_snapshots: 20
  # Auto-prune memory on session init
  auto_prune: true
  # Prune old data on kuma_init()
  prune_on_init: true
`;
}

/**
 * Load a specific storage config value.
 */
export function getStorageConfig(): Required<NonNullable<KumaConfig["storage"]>> {
  const cfg = loadConfig();
  const defaults = DEFAULT_CONFIG.storage!;
  const s = cfg.storage ?? {};
  return {
    keep_tool_calls: s.keep_tool_calls ?? defaults.keep_tool_calls!,
    keep_search_results: s.keep_search_results ?? defaults.keep_search_results!,
    keep_failures_days: s.keep_failures_days ?? defaults.keep_failures_days!,
    keep_backups_per_file: s.keep_backups_per_file ?? defaults.keep_backups_per_file!,
    keep_snapshots: s.keep_snapshots ?? defaults.keep_snapshots!,
    auto_prune: s.auto_prune ?? defaults.auto_prune!,
    prune_on_init: s.prune_on_init ?? defaults.prune_on_init!,
  };
}
