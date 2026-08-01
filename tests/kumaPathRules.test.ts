// ============================================================
// KUMA PATH RULES TESTS — Path-scoped on-demand rules (P2)
// ============================================================

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-pathrules-test-"));

jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: () => tmpRoot,
}));

const {
  ensureRulesDir,
  loadPathRules,
  matchRulePath,
  getRulesForScope,
  formatPathRules,
  hasPathRules,
} = await import("../src/engine/kumaPathRules.js");

const rulesDir = path.join(tmpRoot, ".kuma", "rules");

function writeRule(filename: string, frontmatter: string, body: string): void {
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(path.join(rulesDir, filename), `---\n${frontmatter}---\n${body}`, "utf-8");
}

afterEach(() => {
  try { fs.rmSync(path.join(tmpRoot, ".kuma"), { recursive: true, force: true }); } catch {}
});

describe("matchRulePath", () => {
  test("wildcard matches everything", () => {
    expect(matchRulePath("*", "anything/at/all.ts")).toBe(true);
    expect(matchRulePath("**", "src/deep/nested/x.ts")).toBe(true);
  });

  test("directory prefix matches descendants", () => {
    expect(matchRulePath("src/auth/**", "src/auth/login.ts")).toBe(true);
    expect(matchRulePath("src/auth/**", "src/auth/oauth/callback.ts")).toBe(true);
  });

  test("single star does not cross directory boundaries", () => {
    expect(matchRulePath("src/*", "src/index.ts")).toBe(true);
    expect(matchRulePath("src/*", "src/nested/index.ts")).toBe(false);
  });

  test("does not match unrelated paths", () => {
    expect(matchRulePath("src/auth/**", "src/billing/charge.ts")).toBe(false);
  });

  test("case-insensitive matching", () => {
    expect(matchRulePath("SRC/AUTH/**", "src/auth/Login.ts")).toBe(true);
  });
});

describe("loadPathRules", () => {
  test("returns empty when no rules dir", () => {
    expect(loadPathRules()).toEqual([]);
    expect(hasPathRules()).toBe(false);
  });

  test("parses frontmatter and body", () => {
    writeRule(
      "auth.md",
      'description: Auth middleware conventions\npaths:\n  - "src/auth/**"\n  - "src/middleware/**"\n',
      "Always validate JWT before mutating req.user.\nSecond line of rule.\n"
    );
    const rules = loadPathRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("auth");
    expect(rules[0].description).toBe("Auth middleware conventions");
    expect(rules[0].paths).toEqual(["src/auth/**", "src/middleware/**"]);
    expect(rules[0].content).toContain("Always validate JWT");
    expect(hasPathRules()).toBe(true);
  });

  test("rule without frontmatter applies to everything", () => {
    writeRule("plain.md", "", "Project-wide rule: never use any.\n");
    const rules = loadPathRules();
    expect(rules[0].paths).toEqual(["*"]);
    expect(rules[0].content).toContain("Project-wide rule");
  });

  test("ignores non-md files and corrupt files", () => {
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "notes.txt"), "not a rule", "utf-8");
    expect(loadPathRules()).toEqual([]);
  });
});

describe("getRulesForScope", () => {
  beforeEach(() => {
    writeRule(
      "auth.md",
      'description: Auth\npaths:\n  - "src/auth/**"\n',
      "JWT rule"
    );
    writeRule(
      "global.md",
      'description: Global\npaths:\n  - "*"\n',
      "Global rule"
    );
  });

  test("matches scoped rule by path", () => {
    const matches = getRulesForScope("src/auth/login.ts");
    expect(matches.map(r => r.id).sort()).toEqual(["auth", "global"]);
  });

  test("global rule applies when no scope", () => {
    const matches = getRulesForScope("");
    expect(matches.map(r => r.id)).toEqual(["global"]);
  });

  test("no match returns empty", () => {
    const matches = getRulesForScope("src/billing/charge.ts");
    expect(matches.map(r => r.id)).toEqual(["global"]);
  });
});

describe("formatPathRules", () => {
  test("returns empty string when nothing matches", () => {
    expect(formatPathRules("src/nothing/here.ts")).toBe("");
  });

  test("formats a compact block for matching scope", () => {
    writeRule(
      "api.md",
      'description: API conventions\npaths:\n  - "src/api/**"\n',
      "Never break response shape.\nKeep idempotency.\n"
    );
    const block = formatPathRules("src/api/routes.ts");
    expect(block).toContain("Path Rules");
    expect(block).toContain("API conventions");
    expect(block).toContain("Never break response shape");
    expect(block).toContain(".kuma/rules");
  });
});
