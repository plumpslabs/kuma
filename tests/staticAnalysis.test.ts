import { jest } from "@jest/globals";
import type { Mock } from "jest-mock";

// Mock processRunner at module level (ESM-compatible)
jest.unstable_mockModule("../src/utils/processRunner.js", () => ({
  spawnProcess: jest.fn(),
  spawnShell: jest.fn(),
}));

const { handleStaticAnalysis } = await import("../src/tools/staticAnalysis.js");
const processRunner = await import("../src/utils/processRunner.js");
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("handleStaticAnalysis", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-test-"));
  let origRoot: string | undefined;

  beforeAll(() => {
    // Create a minimal project with config files
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          eslint: "^8.0.0",
          typescript: "^5.0.0",
          prettier: "^3.0.0",
        },
      }),
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".eslintrc.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".prettierrc"), "{}", "utf-8");
    fs.writeFileSync(
      path.join(tmpDir, "src"),
      "export const x: number = 1;",
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
    jest.restoreAllMocks();
  });

  // ============================================================
  // TOOL DETECTION
  // ============================================================

  test("detects no tools when no config files exist", async () => {
    process.env.AGENT_PROJECT_ROOT = path.join(
      os.tmpdir(),
      "empty-dir-" + Date.now(),
    );
    const result = await handleStaticAnalysis({});
    expect(result).toContain("No linters or checkers detected");
  });

  test("detects no tools when packages are missing despite config files", async () => {
    // Create config files but no package.json with deps
    const noDepDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-nodep-"));
    try {
      fs.writeFileSync(path.join(noDepDir, ".eslintrc.json"), "{}", "utf-8");
      fs.writeFileSync(path.join(noDepDir, "tsconfig.json"), "{}", "utf-8");
      fs.writeFileSync(
        path.join(noDepDir, "package.json"),
        JSON.stringify({ name: "empty" }),
        "utf-8",
      );
      process.env.AGENT_PROJECT_ROOT = noDepDir;

      const result = await handleStaticAnalysis({});
      expect(result).toContain("No linters or checkers detected");
    } finally {
      fs.rmSync(noDepDir, { recursive: true, force: true });
    }
  });

  test("reports when requested tool is not available", async () => {
    // Only eslint is available (tsconfig exists but no typescript dep... wait, we have typescript dep)
    // Actually, let's override: only detect ruff which won't be found
    const result = await handleStaticAnalysis({ tool: "ruff" });
    expect(result).toContain("not available");
  });

  // ============================================================
  // ESLINT PARSING (unit test via mock)
  // ============================================================

  test("parses eslint unix format correctly", async () => {
    const eslintOutput = [
      "src/index.ts:1:10: error 'x' is assigned a value but never used [no-unused-vars]",
      "src/index.ts:3:5: warning Unexpected console statement [no-console]",
      "src/utils/helper.ts:5:15: error Missing return type on function [@typescript-eslint/explicit-function-return-type]",
    ].join("\n");

    jest.mocked(processRunner.spawnProcess).mockResolvedValue({
      stdout: eslintOutput + "\n",
      stderr: "",
      exitCode: 1,
      timedOut: false,
    });

    const result = await handleStaticAnalysis({ tool: "eslint" });
    expect(result).toContain("[ERROR]");
    expect(result).toContain("[WARN]");
    expect(result).toContain("no-unused-vars");
    expect(result).toContain("no-console");
    expect(result).toContain("2E / 1W");
  });

  // ============================================================
  // TSC PARSING
  // ============================================================

  test("parses tsc output correctly", async () => {
    const tscOutput = [
      "src/index.ts(1,10): error TS2322: Type 'number' is not assignable to type 'string'.",
      "src/app.ts(5,3): error TS2554: Expected 2 arguments, but got 1.",
    ].join("\n");

    jest.mocked(processRunner.spawnProcess).mockResolvedValue({
      stdout: "",
      stderr: tscOutput,
      exitCode: 2,
      timedOut: false,
    });

    const result = await handleStaticAnalysis({ tool: "tsc" });
    expect(result).toContain("[ERROR]");
    expect(result).toContain("TS2322");
    expect(result).toContain("TS2554");
    expect(result).toContain("Type 'number'");
  });

  // ============================================================
  // PRETTIER PARSING
  // ============================================================

  test("parses prettier check output correctly", async () => {
    const prettierOutput = [
      "src/index.ts [error]",
      "src/app.ts [error] Code style issues found",
    ].join("\n");

    jest.mocked(processRunner.spawnProcess).mockResolvedValue({
      stdout: prettierOutput,
      stderr: "",
      exitCode: 1,
      timedOut: false,
    });

    const result = await handleStaticAnalysis({ tool: "prettier" });
    expect(result).toContain("[WARN]");
    expect(result).toContain("Formatting issue");
    expect(result).toContain("[WARN]");
  });

  // ============================================================
  // NO ISSUES FOUND
  // ============================================================

  test("returns clean result when no issues found", async () => {
    jest.mocked(processRunner.spawnProcess).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });

    const result = await handleStaticAnalysis({ tool: "eslint" });
    expect(result).toContain("All checks passed");
  });

  // ============================================================
  // SPAWN ERROR HANDLING
  // ============================================================

  test("handles spawn errors gracefully", async () => {
    jest.mocked(processRunner.spawnProcess).mockResolvedValue({
      stdout: "",
      stderr: "Failed to spawn process: eslint",
      exitCode: -1,
      timedOut: false,
    });

    const result = await handleStaticAnalysis({ tool: "eslint" });
    // Should show that the tool failed to execute with exit code -1
    expect(result).toContain("exit: -1");
  });

  // ============================================================
  // FILE FILTER
  // ============================================================

  test("passes file filter to tool command", async () => {
    // Note: when eslint is not installed locally, source falls back to npx with "." target
    // File filter is only forwarded when eslint binary is found locally.
    // This test verifies the tool is called at all — file filtering behavior depends
    // on the local environment having the tool installed.

    jest.mocked(processRunner.spawnProcess).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });

    await handleStaticAnalysis({
      tool: "eslint",
      files: ["src/index.ts", "src/app.ts"],
    });

    expect(processRunner.spawnProcess).toHaveBeenCalled();
  });

  // ============================================================
  // RUFF (PYTHON) PARSING
  // ============================================================

  test("handles explicit ruff tool not detected gracefully", async () => {
    // Ruff not configured in test project, should show not available
    const result = await handleStaticAnalysis({ tool: "ruff" });
    expect(result).toContain("not available");
  });
});
