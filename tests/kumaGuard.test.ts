import { jest } from "@jest/globals";
import type { Mock } from "jest-mock";

// ESM-compatible mocking — jest.unstable_mockModule intercepts imports before resolution
jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: jest.fn().mockReturnValue("/test/project"),
  validateFilePath: jest.fn().mockReturnValue({ valid: true, resolvedPath: "/test/project/file.ts" }),
}));

jest.unstable_mockModule("../src/guards/antiPatternDetector.js", () => ({
  detectAllAntiPatterns: jest.fn().mockReturnValue([]),
}));

jest.unstable_mockModule("node:child_process", () => ({
  execSync: jest.fn().mockReturnValue(""),
}));

jest.unstable_mockModule("node:fs", () => {
  const fsMock = {
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn().mockReturnValue(""),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue("{}"),
    readdirSync: jest.fn().mockReturnValue([]),
    statSync: jest.fn().mockReturnValue({}),
  };
  return { ...fsMock, default: fsMock };
});

jest.unstable_mockModule("node:fs", () => {
  const fsMock = {
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn().mockReturnValue(""),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue("{}"),
    readdirSync: jest.fn().mockReturnValue([]),
    statSync: jest.fn().mockReturnValue({}),
  };
  return { ...fsMock, default: fsMock };
});

jest.unstable_mockModule("node:fs", () => {
  const fsMock = {
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn().mockReturnValue(""),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue("{}"),
    readdirSync: jest.fn().mockReturnValue([]),
    statSync: jest.fn().mockReturnValue({}),
  };
  return { ...fsMock, default: fsMock };
});

const { handleKumaGuard } = await import("../src/tools/kumaGuard.js");
const { sessionMemory } = await import("../src/engine/sessionMemory.js");
const antiPatternDetector = await import("../src/guards/antiPatternDetector.js");
const fs = await import("node:fs");

type MockGuardWarning = {
  severity: string;
  pattern: string;
  message: string;
  suggestion: string;
  filePath?: string;
  evidence?: string;
};

function parseReport(result: string): Record<string, unknown> {
  return JSON.parse(result);
}

describe("handleKumaGuard", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
      projectRoot: "/test/project",
      currentGoal: "",
      modifiedFiles: [],
      toolCallCount: 0,
      unresolvedFailures: [],
    } as any);

    jest.spyOn(sessionMemory, "recordToolCall").mockImplementation(() => {});
    jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({ isLooping: false });
    jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue([]);
    jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([]);
    jest.spyOn(sessionMemory, "getFailedFiles").mockReturnValue([]);

    // pathValidator, antiPatternDetector, and child_process are mocked via jest.unstable_mockModule

    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    jest.spyOn(fs, "readFileSync").mockImplementation(() => "{}");
    jest.spyOn(fs, "readdirSync").mockImplementation(() => []);
    jest.spyOn(fs, "statSync").mockImplementation(() => ({} as any));

    // Reset antiPatternDetector mock to default (no warnings)
    (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================
  // CHECK: \"all\" (default)
  // ============================================================
  describe('check: "all" (default mode)', () => {
    test("returns onTrack: true when nothing wrong", async () => {
      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.onTrack).toBe(true);
      expect(report.warnings).toEqual([]);
      expect(report.drifts).toEqual([]);
      expect(report.suggestion).toContain("goal");
    });

    test('suggests "No goal set" when goal is missing', async () => {
      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.suggestion).toBe(
        "No goal set \u2014 use goal parameter or setGoal to track intent"
      );
      expect(report.stats).toMatchObject({
        goal: "",
        modifiedFiles: 0,
        toolCalls: 0,
        hasLoop: false,
        hasRunTests: false,
      });
    });

    test("detects script-patching anti-pattern with high severity", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Created script file that modifies other files: patch.py",
          suggestion:
            "Use **precise_diff_editor** instead \u2014 it has fuzzy matching, auto-backup, and rollback support",
          evidence: "File: patch.py contains 'writeFileSync'",
          filePath: "patch.py",
        },
      ]);

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.onTrack).toBe(false);
      expect(report.warnings).toHaveLength(1);
      expect((report.warnings as MockGuardWarning[])[0].pattern).toBe("script-patching");
      expect(report.suggestion).toContain("Remove patch scripts");
    });

    test("anti-pattern warning includes file path and evidence", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Created script file: patch_service.py",
          suggestion: "Use precise_diff_editor instead",
          evidence: "File: patch_service.py contains 'sed'",
          filePath: "patch_service.py",
        },
      ]);

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      const warning = (report.warnings as MockGuardWarning[])[0] as any;
      expect(warning.filePath).toBe("patch_service.py");
      expect(warning.evidence).toContain("sed");
    });

    test("detects bash-grep anti-pattern", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "medium",
          pattern: "bash-grep",
          message: "Used bash grep instead of smart_grep",
          suggestion:
            "Use **smart_grep** \u2014 it returns line numbers + context, caches results, respects .gitignore",
          evidence: "Command: grep -rn 'auth' src/",
        },
      ]);

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.onTrack).toBe(false);
      expect(report.suggestion).toContain("smart_grep");
    });

    test("detects tool loop from session memory", async () => {
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message:
          'Detected potential loop: "smart_grep" called 5 times in last 10 tool calls',
      });

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.onTrack).toBe(false);
      expect(report.stats).toMatchObject({ hasLoop: true });
      expect((report.warnings as MockGuardWarning[])[0].pattern).toBe("tool-loop");
      expect(report.suggestion).toContain("Switch approach");
    });

    test("detects no-test-after-edit drift", async () => {
      jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([
        { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
      ] as any);
      jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue([
        { toolName: "precise_diff_editor", params: {}, timestamp: 1 },
      ] as any);
      jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
        projectRoot: "/test/project",
        currentGoal: "refactor auth",
        modifiedFiles: [
          { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
        ],
        toolCallCount: 1,
        unresolvedFailures: [],
      } as any);

      const result = await handleKumaGuard({ goal: "refactor auth" });
      const report = parseReport(result);

      expect(report.onTrack).toBe(false);
      expect(report.drifts).toContain("1 file(s) edited but no test run");
      expect((report.warnings as MockGuardWarning[])[0].pattern).toBe("no-test-after-edit");
      expect(report.suggestion).toContain("Run tests");
    });

    test("detects unresolved failures", async () => {
      jest.spyOn(sessionMemory, "getFailedFiles").mockReturnValue([
        {
          task: "typecheck",
          failures: [
            { task: "typecheck", error: "Type error in auth.ts:15", timestamp: 1, resolved: false },
          ],
        },
      ]);

      const result = await handleKumaGuard({ goal: "refactor auth" });
      const report = parseReport(result);

      expect(report.drifts).toContain("1 unresolved failure(s)");
    });

    test("detects excessive edits (ladder violation)", async () => {
      const editCalls = Array.from({ length: 7 }, (_, i) => ({
        toolName: "precise_diff_editor",
        params: {},
        timestamp: i,
      }));
      jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue(editCalls);
      jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
        projectRoot: "/test/project",
        currentGoal: "refactor",
        modifiedFiles: [],
        toolCallCount: 7,
        unresolvedFailures: [],
      } as any);

      const result = await handleKumaGuard({ goal: "refactor" });
      const report = parseReport(result);

      expect((report.warnings as MockGuardWarning[]).some(
        (w) => w.pattern === "excessive-edits"
      )).toBe(true);
      expect(report.suggestion).toContain("Pause");
    });

    test("records tool call in session memory", async () => {
      const recordSpy = jest.spyOn(sessionMemory, "recordToolCall");

      await handleKumaGuard({ check: "all", goal: "test goal" });

      expect(recordSpy).toHaveBeenCalledWith("kuma_guard", {
        check: "all",
        goal: "test goal",
      });
    });

    test("onTrack is true when all checks pass with goal set", async () => {
      jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue([
        { toolName: "execute_safe_test", params: {}, timestamp: 1 },
      ] as any);
      jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
        projectRoot: "/test/project",
        currentGoal: "refactor",
        modifiedFiles: [{ filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" }],
        toolCallCount: 1,
        unresolvedFailures: [],
      } as any);

      const result = await handleKumaGuard({ goal: "refactor auth" });
      const report = parseReport(result);

      expect(report.onTrack).toBe(true);
      expect(report.suggestion).toBe("On track \u2014 continue with current approach");
    });

    test("handles git not available gracefully", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([]);
    // execSync is already mocked via jest.unstable_mockModule - override for this test
    const cp = await import("node:child_process");
    (cp.execSync as Mock).mockImplementation(() => {
      throw new Error("not a git repository");
    });

      const result = await handleKumaGuard({ goal: "test" });
      const report = parseReport(result);

      expect(report.onTrack).toBeDefined();
      expect(report.stats).toBeDefined();
    });
  });

  // ============================================================
  // CHECK: \"anti-pattern\"
  // ============================================================
  describe('check: "anti-pattern"', () => {
    test("only runs anti-pattern detection, not loop or drift", async () => {
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message: "Loop detected",
      });
      jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([
        { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
      ] as any);

      const result = await handleKumaGuard({ check: "anti-pattern" });
      const report = parseReport(result);

      expect((report.warnings as MockGuardWarning[]).filter(
        (w) => w.pattern === "tool-loop"
      )).toHaveLength(0);
      expect(report.drifts).toHaveLength(0);
    });

    test("reports anti-pattern warnings when detected", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Script detected: patch.py",
          suggestion: "Use precise_diff_editor instead",
          evidence: "File: patch.py",
          filePath: "patch.py",
        },
      ]);

      const result = await handleKumaGuard({ check: "anti-pattern" });
      const report = parseReport(result);

      expect(report.warnings).toHaveLength(1);
    });
  });

  // ============================================================
  // CHECK: \"loop\"
  // ============================================================
  describe('check: "loop"', () => {
    test("only runs loop detection, not anti-pattern or drift", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Script detected",
          suggestion: "Fix it",
        },
      ]);

      const result = await handleKumaGuard({ check: "loop" });
      const report = parseReport(result);

      expect(report.warnings).toHaveLength(0);
      expect(report.stats).toMatchObject({ hasLoop: false });
    });

    test("reports loop when detected", async () => {
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message: 'Loop: "smart_grep" called too many times',
      });

      const result = await handleKumaGuard({ check: "loop" });
      const report = parseReport(result);

      expect(report.warnings).toHaveLength(1);
      expect((report.warnings as MockGuardWarning[])[0].pattern).toBe("tool-loop");
      expect(report.stats).toMatchObject({ hasLoop: true });
      expect(report.suggestion).toContain("Switch approach");
    });

    test("returns onTrack when no loop", async () => {
      const result = await handleKumaGuard({ check: "loop" });
      const report = parseReport(result);

      expect(report.onTrack).toBe(true);
    });
  });

  // ============================================================
  // CHECK: \"drift\"
  // ============================================================
  describe('check: "drift"', () => {
    test("only runs drift detection, not anti-pattern or loop", async () => {
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message: "Loop detected",
      });
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Script detected",
          suggestion: "Fix it",
        },
      ]);

      const result = await handleKumaGuard({ check: "drift" });
      const report = parseReport(result);

      expect((report.warnings as MockGuardWarning[]).filter(
        (w) => w.pattern === "script-patching" || w.pattern === "tool-loop"
      )).toHaveLength(0);
      expect(report.stats).toMatchObject({ hasLoop: false });
    });

    test("reports edits without tests", async () => {
      jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([
        { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
        { filePath: "src/user.ts", modifiedAt: Date.now(), status: "modified" },
      ] as any);
      jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue([
        { toolName: "precise_diff_editor", params: {}, timestamp: 1 },
      ] as any);

      const result = await handleKumaGuard({ check: "drift" });
      const report = parseReport(result);

      expect(report.drifts).toContain("2 file(s) edited but no test run");
    });

    test("does not report drift when tests have been run", async () => {
      jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([
        { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
      ] as any);
      jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue([
        { toolName: "precise_diff_editor", params: {}, timestamp: 1 },
        { toolName: "execute_safe_test", params: { task: "typecheck" }, timestamp: 2 },
      ] as any);

      const result = await handleKumaGuard({ check: "drift" });
      const report = parseReport(result);

      expect(report.drifts).not.toContain(expect.stringContaining("edited but no test"));
      expect(report.stats).toMatchObject({ hasRunTests: true });
    });

    test("reports unresolved failures", async () => {
      jest.spyOn(sessionMemory, "getFailedFiles").mockReturnValue([
        {
          task: "typecheck",
          failures: [
            { task: "typecheck", error: "Error", timestamp: 1, resolved: false },
          ],
        },
      ]);

      const result = await handleKumaGuard({ check: "drift" });
      const report = parseReport(result);

      expect(report.drifts).toContain("1 unresolved failure(s)");
    });
  });

  // ============================================================
  // CHECK: \"context\" (creates snapshot, returns markdown)
  // ============================================================
  describe('check: "context" (creates snapshot)', () => {
    test("returns formatted snapshot with goal", async () => {
      const result = await handleKumaGuard({ check: "context" as any, goal: "refactor auth" });

      expect(result).toContain("Context Snapshot");
      expect(result).toContain("refactor auth");
      expect(result).toContain("Modified Files");
      expect(result).toContain("Unresolved Failures");
      expect(result).toContain("Tool Calls");
      expect(result).toContain("Git Diff");
    });

    test("does not include drift or loop info (short-circuits guard report)", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Script detected",
          suggestion: "Fix it",
        },
      ]);
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message: "Loop detected",
      });

      const result = await handleKumaGuard({ check: "context" as any });

      expect(result).not.toContain("onTrack");
      expect(result).not.toContain("script-patching");
      expect(result).not.toContain("tool-loop");
      expect(result).toContain("Context Snapshot");
    });

    test("returns error message when snapshot creation fails", async () => {
      (fs.mkdirSync as Mock).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      jest.spyOn(fs, "existsSync").mockReturnValue(false);

      const result = await handleKumaGuard({ check: "context" as any });

      expect(result).toContain("Could not create context snapshot");
    });
  });

  // ============================================================
  // GOAL HANDLING
  // ============================================================
  describe("goal handling", () => {
    test("uses goal from params when provided", async () => {
      const result = await handleKumaGuard({ goal: "refactor auth module" });
      const report = parseReport(result);

      expect(report.stats).toMatchObject({ goal: "refactor auth module" });
    });

    test("falls back to session memory goal when no param goal", async () => {
      jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
        projectRoot: "/test/project",
        currentGoal: "session goal from memory",
        modifiedFiles: [],
        toolCallCount: 0,
        unresolvedFailures: [],
      } as any);

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.stats).toMatchObject({ goal: "session goal from memory" });
    });

    test("empty goal when neither param nor session has goal", async () => {
      jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
        projectRoot: "/test/project",
        currentGoal: "",
        modifiedFiles: [],
        toolCallCount: 0,
        unresolvedFailures: [],
      } as any);

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.stats).toMatchObject({ goal: "" });
    });
  });

  // ============================================================
  // SUGGESTION PRIORITY
  // ============================================================
  describe("suggestion priority", () => {
    test("script-patching takes highest priority", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "high",
          pattern: "script-patching",
          message: "Script detected",
          suggestion: "Use precise_diff_editor",
        },
      ]);
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message: "Loop detected",
      });
      jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([
        { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
      ] as any);

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.suggestion).toContain("Remove patch scripts");
    });

    test("tool-loop suggestion when loop detected without script-patching", async () => {
      jest.spyOn(sessionMemory, "detectLoop").mockReturnValue({
        isLooping: true,
        toolName: "smart_grep",
        message: "Loop detected",
      });

      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(report.suggestion).toContain("Switch approach");
    });

    test("no-test-after-edit suggestion when edits without tests", async () => {
      jest.spyOn(sessionMemory, "getModifiedFiles").mockReturnValue([
        { filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" },
      ] as any);
      jest.spyOn(sessionMemory, "getToolCallHistory").mockReturnValue([
        { toolName: "precise_diff_editor", params: {}, timestamp: 1 },
      ] as any);
      jest.spyOn(sessionMemory, "getSummary").mockReturnValue({
        projectRoot: "/test/project",
        currentGoal: "test",
        modifiedFiles: [{ filePath: "src/auth.ts", modifiedAt: Date.now(), status: "modified" }],
        toolCallCount: 1,
        unresolvedFailures: [],
      } as any);

      const result = await handleKumaGuard({ goal: "test" });
      const report = parseReport(result);

      expect(report.suggestion).toContain("Run tests");
    });

    test("bash-grep suggestion when grep detected", async () => {
      (antiPatternDetector.detectAllAntiPatterns as Mock).mockReturnValue([
        {
          severity: "medium",
          pattern: "bash-grep",
          message: "Used bash grep",
          suggestion: "Use smart_grep",
        },
      ]);

      const result = await handleKumaGuard({ goal: "test" });
      const report = parseReport(result);

      expect(report.suggestion).toContain("smart_grep");
    });
  });

  // ============================================================
  // REPORT STRUCTURE
  // ============================================================
  describe("report structure", () => {
    test("includes ISO timestamp", async () => {
      const result = await handleKumaGuard({});
      const report = parseReport(result);

      expect(typeof report.timestamp).toBe("string");
      expect(new Date(report.timestamp as string).toISOString()).toBe(report.timestamp);
    });

    test("has all required stats fields", async () => {
      const result = await handleKumaGuard({ goal: "fix bug" });
      const report = parseReport(result);

      expect(report.stats).toHaveProperty("goal");
      expect(report.stats).toHaveProperty("modifiedFiles");
      expect(report.stats).toHaveProperty("toolCalls");
      expect(report.stats).toHaveProperty("unresolvedFailures");
      expect(report.stats).toHaveProperty("hasLoop");
      expect(report.stats).toHaveProperty("hasRunTests");
    });
  });
});