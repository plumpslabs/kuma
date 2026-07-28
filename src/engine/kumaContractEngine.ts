// ============================================================
// KUMA CONTRACT ENGINE — Agent Contract Testing (Issue #26)
// ============================================================
// Pre/post-condition verification schemas for deterministic
// agent behavior boundaries. Inspired by Pact/OpenAPI contracts.
//
// Features:
//   1. Define JSON action contracts in .kuma/contracts/
//   2. Pre-condition checks before action execution
//   3. Post-condition checks after file modification
//   4. Auto-feed violations back to agent for self-correction
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// CONTRACT SCHEMA
// ============================================================

export interface ContractCondition {
  type: "file_exists" | "file_not_exists" | "contains" | "not_contains" | "matches_regex" | "has_test_file" | "api_status";
  target: string;        // File path pattern, API endpoint, etc.
  value?: string;        // Expected value, regex pattern, etc.
  description: string;
}

export interface ActionContract {
  id: string;
  description: string;
  appliesTo: string[];   // Tool names or file patterns
  preConditions: ContractCondition[];
  postConditions: ContractCondition[];
  severity: "error" | "warning";
}

export interface ContractConfig {
  version: number;
  contracts: ActionContract[];
}

// ============================================================
// DEFAULT CONTRACTS
// ============================================================

const DEFAULT_CONTRACTS: ContractConfig = {
  version: 1,
  contracts: [
    {
      id: "no-delete-tests-without-replacement",
      description: "Test files should not be deleted without replacement",
      appliesTo: ["*"],
      preConditions: [],
      postConditions: [
        {
          type: "not_contains",
          target: "*/.test.*",
          value: "test.skip",
          description: "Tests should not be skipped without reason",
        },
      ],
      severity: "warning",
    },
    {
      id: "no-silent-empty-catch",
      description: "Catch blocks must not be empty",
      appliesTo: ["*"],
      preConditions: [],
      postConditions: [
        {
          type: "not_contains",
          target: "*.ts",
          value: "catch {}",
          description: "Empty catch blocks suppress errors silently",
        },
        {
          type: "not_contains",
          target: "*.ts",
          value: "catch (e) {}",
          description: "Empty catch (e) {} suppresses errors silently",
        },
      ],
      severity: "error",
    },
    {
      id: "api-response-shape",
      description: "API response shape must be preserved",
      appliesTo: ["src/api/*", "src/routes/*"],
      preConditions: [],
      postConditions: [],
      severity: "warning",
    },
  ],
};

// ============================================================
// CONTRACT LOADING
// ============================================================

function contractsDir(): string {
  return path.join(getProjectRoot(), ".kuma", "contracts");
}

function ensureContractsDir(): void {
  const dir = contractsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    // Write default contracts only if directory was just created
    const defaultPath = path.join(dir, "default.json");
    if (!fs.existsSync(defaultPath)) {
      fs.writeFileSync(
        defaultPath,
        JSON.stringify(DEFAULT_CONTRACTS, null, 2),
        "utf-8",
      );
    }
  }
}

export function loadContracts(): ContractConfig[] {
  ensureContractsDir();
  const dir = contractsDir();
  const contracts: ContractConfig[] = [];

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const config = JSON.parse(content) as ContractConfig;
        contracts.push(config);
      } catch (err) {
        console.error(`[ContractEngine] Failed to load ${file}: ${err}`);
      }
    }
  } catch {}

  // Always include defaults as fallback
  if (contracts.length === 0) {
    contracts.push(DEFAULT_CONTRACTS);
  }

  return contracts;
}

// ============================================================
// EVALUATE CONDITIONS
// ============================================================

export interface ContractVerdict {
  contractId: string;
  description: string;
  passed: boolean;
  violations: Array<{
    condition: ContractCondition;
    message: string;
    severity: "error" | "warning";
  }>;
}

/**
 * Evaluate pre-conditions before a tool action.
 * Checks if the environment is ready for the action.
 */
export function evaluatePreConditions(
  toolName: string,
  filePath?: string,
): ContractVerdict[] {
  const contracts = loadContracts();
  const verdicts: ContractVerdict[] = [];

  for (const config of contracts) {
    for (const contract of config.contracts) {
      // Check if contract applies to this tool/file
      if (!appliesToContract(contract, toolName, filePath)) continue;

      const violations: ContractVerdict["violations"] = [];
      for (const condition of contract.preConditions) {
        const result = evaluateCondition(condition, filePath);
        if (!result.passed) {
          violations.push({
            condition,
            message: result.message,
            severity: contract.severity,
          });
        }
      }

      verdicts.push({
        contractId: contract.id,
        description: contract.description,
        passed: violations.length === 0,
        violations,
      });
    }
  }

  return verdicts;
}

/**
 * Evaluate post-conditions after a file modification.
 * Checks if the modification violated any contract.
 */
export function evaluatePostConditions(
  toolName: string,
  filePath?: string,
): ContractVerdict[] {
  const contracts = loadContracts();
  const verdicts: ContractVerdict[] = [];

  for (const config of contracts) {
    for (const contract of config.contracts) {
      if (!appliesToContract(contract, toolName, filePath)) continue;

      const violations: ContractVerdict["violations"] = [];
      for (const condition of contract.postConditions) {
        const result = evaluateCondition(condition, filePath);
        if (!result.passed) {
          violations.push({
            condition,
            message: result.message,
            severity: contract.severity,
          });
        }
      }

      verdicts.push({
        contractId: contract.id,
        description: contract.description,
        passed: violations.length === 0,
        violations,
      });
    }
  }

  return verdicts;
}

// ============================================================
// CONDITION EVALUATION (internal)
// ============================================================

interface ConditionResult {
  passed: boolean;
  message: string;
}

function evaluateCondition(
  condition: ContractCondition,
  contextPath?: string,
): ConditionResult {
  const root = getProjectRoot();

  switch (condition.type) {
    case "file_exists": {
      const targetPath = resolveTarget(condition.target, contextPath, root);
      const exists = targetPath.some(p => fs.existsSync(p));
      return {
        passed: exists,
        message: exists
          ? `✅ File exists: ${condition.target}`
          : `❌ Required file not found: ${condition.target} (${condition.description})`,
      };
    }

    case "file_not_exists": {
      const targetPath = resolveTarget(condition.target, contextPath, root);
      const exists = targetPath.some(p => fs.existsSync(p));
      return {
        passed: !exists,
        message: !exists
          ? `✅ File does not exist: ${condition.target}`
          : `❌ File should not exist: ${condition.target} (${condition.description})`,
      };
    }

    case "contains": {
      if (!contextPath) return { passed: true, message: "⚠️ No file to check" };
      const fullPath = path.resolve(root, contextPath);
      if (!fs.existsSync(fullPath)) return { passed: true, message: "⚠️ File not found" };
      const content = fs.readFileSync(fullPath, "utf-8");
      const hasContent = condition.value ? content.includes(condition.value) : false;
      return {
        passed: hasContent,
        message: hasContent
          ? `✅ Contains expected content`
          : `❌ Missing expected content: "${condition.value}" (${condition.description})`,
      };
    }

    case "not_contains": {
      if (!contextPath) return { passed: true, message: "⚠️ No file to check" };
      const root2 = getProjectRoot();
      const targets = resolveTarget(condition.target, contextPath, root2);
      for (const t of targets) {
        if (fs.existsSync(t)) {
          const content = fs.readFileSync(t, "utf-8");
          if (condition.value && content.includes(condition.value)) {
            return {
              passed: false,
              message: `❌ Found forbidden pattern "${condition.value}" in ${path.relative(root2, t)} (${condition.description})`,
            };
          }
        }
      }
      return { passed: true, message: "✅ No forbidden patterns found" };
    }

    case "has_test_file": {
      if (!contextPath) return { passed: true, message: "⚠️ No file to check" };
      const basename = path.basename(contextPath, path.extname(contextPath));
      const dir = path.dirname(contextPath);
      const possibleTests = [
        path.join(dir, `${basename}.test.ts`),
        path.join(dir, `${basename}.spec.ts`),
        path.join(dir, `__tests__/${basename}.test.ts`),
        path.join(dir, `__tests__/${basename}.spec.ts`),
      ];
      const hasTest = possibleTests.some(t => fs.existsSync(t));
      return {
        passed: hasTest,
        message: hasTest
          ? `✅ Test file exists`
          : `❌ No test file found for ${contextPath} (${condition.description})`,
      };
    }

    default:
      return { passed: true, message: `⚠️ Unknown condition type: ${condition.type}` };
  }
}

function appliesToContract(
  contract: ActionContract,
  toolName: string,
  filePath?: string,
): boolean {
  if (contract.appliesTo.includes("*")) return true;
  if (contract.appliesTo.includes(toolName)) return true;
  if (filePath) {
    return contract.appliesTo.some(pattern => {
      return filePath.includes(pattern.replace("*", ""));
    });
  }
  return false;
}

function resolveTarget(pattern: string, contextPath?: string, root?: string): string[] {
  const r = root || getProjectRoot();
  if (pattern.startsWith("*")) {
    // Glob-like pattern — try to find matching files
    // Simple implementation: match against context file dir
    if (contextPath) {
      const dir = path.dirname(path.resolve(r, contextPath));
      const suffix = pattern.replace("*", "");
      try {
        const files = fs.readdirSync(dir);
        return files
          .filter(f => f.endsWith(suffix) || f.includes(suffix))
          .map(f => path.join(dir, f));
      } catch {
        return [path.join(dir, pattern.replace("*", ""))];
      }
    }
    return [];
  }
  return [path.resolve(r, pattern)];
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Run all contract checks for a given tool action.
 */
export async function runContractChecks(
  toolName: string,
  filePath?: string,
  phase: "pre" | "post" = "pre",
): Promise<string> {
  const verdicts = phase === "pre"
    ? evaluatePreConditions(toolName, filePath)
    : evaluatePostConditions(toolName, filePath);

  if (verdicts.length === 0) {
    return "✅ **No applicable contracts** for this action.";
  }

  const lines: string[] = [
    `📜 **Contract Check** (${phase}-conditions)`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
  ];

  let totalViolations = 0;
  let errors = 0;

  for (const v of verdicts) {
    if (v.passed) {
      lines.push(`  ✅ **${v.description}** — passed`);
    } else {
      totalViolations += v.violations.length;
      const errorCount = v.violations.filter(x => x.severity === "error").length;
      errors += errorCount;
      lines.push(`  ${errorCount > 0 ? "🔴" : "🟡"} **${v.description}** — ${v.violations.length} violation(s)`);
      for (const violation of v.violations) {
        lines.push(`     ${violation.severity === "error" ? "🔴" : "🟡"} ${violation.message.substring(0, 120)}`);
      }
    }
  }

  lines.push("");

  if (errors > 0) {
    lines.push(`🔴 **${errors} error(s)** — blocking. Resolve before proceeding.`);
  } else if (totalViolations > 0) {
    lines.push(`🟡 **${totalViolations} warning(s)** — review recommended.`);
  } else {
    lines.push("✅ All contract checks passed.");
  }

  return lines.join("\n");
}

/**
 * List all active contracts.
 */
export function listContracts(): string {
  const configs = loadContracts();
  const lines: string[] = [
    "📜 **Active Contracts**",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  for (const config of configs) {
    for (const contract of config.contracts) {
      const appliesTo = contract.appliesTo.join(", ");
      lines.push(`  📌 **${contract.id}**`);
      lines.push(`     ${contract.description}`);
      lines.push(`     Applies to: ${appliesTo}`);
      lines.push(`     Pre-conditions: ${contract.preConditions.length}`);
      lines.push(`     Post-conditions: ${contract.postConditions.length}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
