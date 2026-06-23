import { jest } from "@jest/globals";
import { handleGitDiff } from "../src/tools/gitDiff.js";
import child_process from "node:child_process";

describe("handleGitDiff", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns structured diff output for unstaged changes", async () => {
    const sampleDiff = [
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc123..def456 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -10,7 +10,9 @@ function foo() {',
      ' const x = 1;',
      '+const y = 2;',
      ' const z = 3;',
      '+const w = 4;',
      '+const v = 5;',
      ' }',
      '',
    ].join('\n');

    jest.spyOn(child_process, "execSync").mockReturnValue(sampleDiff);

    const result = await handleGitDiff({});
    expect(result).toContain("**Git Diff**");
    expect(result).toContain("src/index.ts");
    expect(result).toContain("+ const y = 2");
    expect(result).toContain("Summary:");
  });

  test("handles no uncommitted changes", async () => {
    jest.spyOn(child_process, "execSync").mockReturnValue("");

    const result = await handleGitDiff({});
    expect(result).toContain("No uncommitted changes");
  });

  test("handles no staged changes", async () => {
    jest.spyOn(child_process, "execSync").mockReturnValue("");

    const result = await handleGitDiff({ staged: true });
    expect(result).toContain("No staged changes");
  });

  test("returns staged changes when staged flag is set", async () => {
    const diff = [
      'diff --git a/src/index.ts b/src/index.ts',
      'new file mode 100644',
      'index 0000000..abc1234',
      '--- /dev/null',
      '+++ b/src/index.ts',
      '@@ -0,0 +1,3 @@',
      '+export function hello() {',
      '+  return "world";',
      '+}',
    ].join('\n');

    jest.spyOn(child_process, "execSync").mockReturnValue(diff);

    const result = await handleGitDiff({ staged: true });
    expect(result).toContain("[New file]");
    expect(result).toContain("+ export function hello()");
  });

  test("handles deleted file mode", async () => {
    const diff = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      'index abc1234..0000000',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,5 +0,0 @@',
      '-const oldCode = "remove me";',
    ].join('\n');

    jest.spyOn(child_process, "execSync").mockReturnValue(diff);

    const result = await handleGitDiff({});
    expect(result).toContain("[Deleted file]");
    expect(result).toContain("- const oldCode");
  });

  test("handles not a git repository error", async () => {
    jest.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    const result = await handleGitDiff({});
    expect(result).toContain("Not a git repository");
  });

  test("handles execution errors gracefully", async () => {
    jest.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("Command failed: git diff");
    });

    const result = await handleGitDiff({});
    expect(result).toContain("Error");
    expect(result).toContain("Command failed");
  });

  test("shows file path when filePath filter is used", async () => {
    const diff = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    jest.spyOn(child_process, "execSync").mockReturnValue(diff);

    const result = await handleGitDiff({ filePath: "src/index.ts" });
    expect(result).toContain("src/index.ts");
  });

  test("counts additions and deletions correctly", async () => {
    const diff = [
      'diff --git a/src/test.ts b/src/test.ts',
      '--- a/src/test.ts',
      '+++ b/src/test.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-line2',
      '+line2_modified',
      '+line3_new',
      ' line4',
    ].join('\n');

    jest.spyOn(child_process, "execSync").mockReturnValue(diff);

    const result = await handleGitDiff({});
    expect(result).toContain("Summary:");
    expect(result).toContain("+2");  // 2 additions
    expect(result).toContain("/ -1"); // 1 deletion
  });

  test("handles multiple files in diff", async () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old_a',
      '+new_a',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '-old_b',
      '+new_b',
    ].join('\n');

    jest.spyOn(child_process, "execSync").mockReturnValue(diff);

    const result = await handleGitDiff({});
    expect(result).toContain("src/a.ts");
    expect(result).toContain("src/b.ts");
    expect(result).toContain("2 file(s)");
  });
});
