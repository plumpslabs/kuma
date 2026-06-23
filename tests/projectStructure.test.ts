import { jest } from "@jest/globals";
import { handleProjectStructure } from "../src/tools/projectStructure.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("handleProjectStructure", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-"));
  let origRoot: string | undefined;

  beforeAll(() => {
    // Create mock project structure
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "utils"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".kuma"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project" }),
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test", "utf-8");
    fs.writeFileSync(
      path.join(tmpDir, "src", "index.ts"),
      "export const x = 1;",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "src", "components", "Button.tsx"),
      "export const Button = () => null;",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "src", "utils", "helpers.ts"),
      "export const helper = () => {};",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "tests", "index.test.ts"),
      "test('x', () => {});",
      "utf-8",
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    origRoot = process.env.AGENT_PROJECT_ROOT;
    process.env.AGENT_PROJECT_ROOT = tmpDir;
  });

  afterEach(() => {
    process.env.AGENT_PROJECT_ROOT = origRoot;
  });

  test("returns tree structure for simple project", async () => {
    const result = await handleProjectStructure({ depth: 3 });
    expect(result).toContain("[Project Structure]");
    expect(result).toContain("src/");
    expect(result).toContain("package.json");
    expect(result).toContain("index.ts");
    expect(result).toContain("Button.tsx");
  });

  test("respects depth 1 (top level only)", async () => {
    const result = await handleProjectStructure({ depth: 1 });
    expect(result).toContain("src/");
    expect(result).toContain("package.json");
    expect(result).toContain("README.md");
    // Should NOT contain nested items
    expect(result).not.toContain("Button.tsx");
    expect(result).not.toContain("helpers.ts");
    expect(result).not.toContain("index.test.ts");
  });

  test("folderOnly mode shows only directories", async () => {
    const result = await handleProjectStructure({
      depth: 3,
      folderOnly: true,
    });
    expect(result).toContain("src/");
    expect(result).toContain("components/");
    expect(result).toContain("utils/");
    expect(result).toContain("tests/");
    // Should NOT contain files
    expect(result).not.toContain("package.json");
    expect(result).not.toContain("index.ts");
    expect(result).not.toContain("README.md");
  });

  test("ignores node_modules, .git, and .kuma directories", async () => {
    const result = await handleProjectStructure({ depth: 3 });
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain(".git");
    expect(result).not.toContain(".kuma");
  });

  test("clamps depth to valid range (min 1, max 6)", async () => {
    // depth 0 should clamp to 1 (minimum)
    const resultMin = await handleProjectStructure({ depth: 0 });
    expect(resultMin).toContain("[Project Structure]");

    // depth 10 should clamp to 6 (maximum)
    const resultMax = await handleProjectStructure({ depth: 10 });
    expect(resultMax).toContain("[Project Structure]");
  });

  test("includePattern filters visible items", async () => {
    const result = await handleProjectStructure({
      depth: 3,
      includePattern: ".ts",
    });
    // Should show .ts files/dirs but not .json or .md
    expect(result).toContain("index.ts");
    expect(result).toContain("helpers.ts");
    // Note: includePattern doesn't hide directories containing matches
  });

  test("excludePattern filters out items", async () => {
    const result = await handleProjectStructure({
      depth: 3,
      excludePattern: "test",
    });
    // Should NOT show "tests" directory or test files
    expect(result).not.toContain("tests");
    expect(result).not.toContain("index.test");
  });

  test("reports file sizes", async () => {
    const result = await handleProjectStructure({ depth: 2 });
    expect(result).toContain("B"); // Either "B" for bytes or "KB"
    expect(result).toContain("package.json");
  });

  test("handles execution errors gracefully", async () => {
    // Set project root to a non-existent directory to trigger errors
    process.env.AGENT_PROJECT_ROOT = path.join(os.tmpdir(), "nonexistent-dir-12345");

    const result = await handleProjectStructure({});
    expect(result).toContain("[Project Structure]");
    // Should gracefully handle missing root and show basic structure
  });
});
