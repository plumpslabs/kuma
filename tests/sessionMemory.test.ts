import { jest } from '@jest/globals';
import { SessionMemory } from "../src/engine/sessionMemory.js";
import fs from "node:fs";

let mem: SessionMemory;

beforeEach(() => {
  // Suppress console.error (MCP uses stderr for logging, but test output should be clean)
  jest.spyOn(console, "error").mockImplementation(() => {});

  // Mock fs to isolate tests from disk I/O
  jest.spyOn(fs, "existsSync").mockReturnValue(false);
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
  jest.spyOn(fs, "readFileSync").mockReturnValue("");

  // Create fresh instance for each test
  mem = new SessionMemory();
  mem.init({
    projectRoot: "/test/project",
    startTime: 1000000,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SessionMemory", () => {
  // ============================================================
  // INIT & BASICS
  // ============================================================
  describe("init & basic operations", () => {
    test("getSummary returns correct initial state", () => {
      const summary = mem.getSummary();
      expect(summary.projectRoot).toBe("/test/project");
      expect(summary.currentGoal).toBe("");
      expect(summary.completedSteps).toEqual([]);
      expect(summary.modifiedFiles).toEqual([]);
      expect(summary.unresolvedFailures).toEqual([]);
      expect(summary.toolCallCount).toBe(0);
      expect(summary.hasConventions).toBe(false);
    });

    test("re-init resets state", () => {
      mem.setGoal("Old goal");
      mem.init({ projectRoot: "/new/project", startTime: 2000000 });
      expect(mem.getSummary().projectRoot).toBe("/new/project");
      expect(mem.getSummary().currentGoal).toBe("");
    });

    test("setGoal updates current goal", () => {
      mem.setGoal("Fix auth bug");
      expect(mem.getSummary().currentGoal).toBe("Fix auth bug");
    });

    test("addCompletedStep adds to list without duplicates", () => {
      mem.addCompletedStep("step1");
      mem.addCompletedStep("step2");
      mem.addCompletedStep("step1"); // duplicate
      expect(mem.getSummary().completedSteps).toEqual(["step1", "step2"]);
    });
  });

  // ============================================================
  // FILE TRACKING
  // ============================================================
  describe("file tracking", () => {
    test("addModifiedFile tracks new file", () => {
      mem.addModifiedFile("src/auth.ts");
      const files = mem.getModifiedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].filePath).toBe("src/auth.ts");
      expect(files[0].status).toBe("modified");
    });

    test("addModifiedFile updates existing file but keeps one entry", () => {
      mem.addModifiedFile("src/auth.ts");
      mem.addModifiedFile("src/auth.ts");
      const files = mem.getModifiedFiles();
      expect(files).toHaveLength(1);
    });

    test("addCreatedFile marks file as created", () => {
      mem.addCreatedFile("src/newFile.ts");
      const files = mem.getModifiedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].status).toBe("created");
    });

    test("tracks multiple files", () => {
      mem.addModifiedFile("src/auth.ts");
      mem.addCreatedFile("src/newFile.ts");
      mem.addModifiedFile("src/utils/helper.ts");

      const files = mem.getModifiedFiles();
      expect(files).toHaveLength(3);
    });
  });

  // ============================================================
  // FAILURE TRACKING
  // ============================================================
  describe("failure tracking", () => {
    test("addFailedFile records failure", () => {
      mem.addFailedFile("typecheck", "Type error in auth.ts:15");
      const failures = mem.getFailedFiles();
      expect(failures).toHaveLength(1);
      expect(failures[0].task).toBe("typecheck");
      expect(failures[0].failures[0].resolved).toBe(false);
    });

    test("unresolved failures appear in summary", () => {
      mem.addFailedFile("typecheck", "Error in auth.ts");
      const summary = mem.getSummary();
      expect(summary.unresolvedFailures).toHaveLength(1);
    });

    test("markFailureResolved clears failures from summary", () => {
      mem.addFailedFile("typecheck", "Error in auth.ts");
      mem.markFailureResolved("typecheck");
      const summary = mem.getSummary();
      expect(summary.unresolvedFailures).toHaveLength(0);
    });

    test("multiple failures to same task are tracked", () => {
      mem.addFailedFile("build", "Error 1");
      mem.addFailedFile("build", "Error 2");
      mem.addFailedFile("test", "Error 3");

      const failures = mem.getFailedFiles();
      const buildFailures = failures.find((f) => f.task === "build");
      expect(buildFailures?.failures).toHaveLength(2);
    });
  });

  // ============================================================
  // TOOL CALL TRACKING & LOOP DETECTION
  // ============================================================
  describe("tool call tracking & loop detection", () => {
    test("records tool calls", () => {
      mem.recordToolCall("smart_grep", { query: "test" });
      mem.recordToolCall("smart_file_picker", { filePath: "test.ts" });

      expect(mem.getSummary().toolCallCount).toBe(2);
      const history = mem.getToolCallHistory();
      expect(history).toHaveLength(2);
      expect(history[0].toolName).toBe("smart_grep");
    });

    test("getToolCallHistory respects limit", () => {
      for (let i = 0; i < 20; i++) {
        mem.recordToolCall(`tool_${i}`, {});
      }
      expect(mem.getToolCallHistory(5)).toHaveLength(5);
      expect(mem.getToolCallHistory(50)).toHaveLength(20);
    });

    test("getToolCallHistory with default limit returns last 10", () => {
      for (let i = 0; i < 15; i++) {
        mem.recordToolCall(`tool_${i}`, {});
      }
      expect(mem.getToolCallHistory()).toHaveLength(10);
    });

    test("detectLoop returns false for normal usage", () => {
      mem.recordToolCall("grep", { query: "a" });
      mem.recordToolCall("read", { file: "a.ts" });
      mem.recordToolCall("edit", { file: "a.ts" });
      mem.recordToolCall("grep", { query: "b" });
      mem.recordToolCall("read", { file: "b.ts" });
      mem.recordToolCall("test", { task: "typecheck" });

      expect(mem.detectLoop().isLooping).toBe(false);
    });

    test("detectLoop detects repetition of same tool", () => {
      for (let i = 0; i < 10; i++) {
        mem.recordToolCall("smart_grep", { query: "test" });
      }

      const result = mem.detectLoop();
      expect(result.isLooping).toBe(true);
      expect(result.toolName).toBe("smart_grep");
    });

    test("detectLoop returns false when too few calls", () => {
      mem.recordToolCall("grep", { query: "a" });
      mem.recordToolCall("grep", { query: "b" });

      expect(mem.detectLoop().isLooping).toBe(false);
    });
  });

  // ============================================================
  // SEARCH RESULTS
  // ============================================================
  describe("search results", () => {
    test("addSearchResult stores query results", () => {
      mem.addSearchResult("authenticate", ["src/auth.ts", "src/middleware.ts"]);

      const summary = mem.getSummary();
      expect(summary.recentSearches).toContain("authenticate");
    });
  });

  // ============================================================
  // CONVENTIONS
  // ============================================================
  describe("conventions", () => {
    test("setConventions reflected in summary", () => {
      mem.setConventions({ framework: "React", testRunner: "Vitest" });
      const summary = mem.getSummary();
      expect(summary.hasConventions).toBe(true);
    });
  });

  // ============================================================
  // MEMORY LIMITS
  // ============================================================
  describe("memory limits", () => {
    test("tool call history is capped at 100", () => {
      for (let i = 0; i < 150; i++) {
        mem.recordToolCall(`tool_${i}`, {});
      }

      const history = mem.getToolCallHistory(200);
      expect(history).toHaveLength(100);
    });
  });
  // ============================================================
  // MIGRATION (session.json → memory.json)
  // ============================================================
  describe("migration", () => {
    test("renames old session.json to memory.json during init", () => {
      const renameSpy = jest.spyOn(fs, "renameSync").mockImplementation(() => {});

      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("session.json")) return true;
        if (typeof p === "string" && p.endsWith("memory.json")) return false;
        if (typeof p === "string" && p.endsWith(".kuma-memory.json")) return false;
        return false;
      });

      const freshMem = new SessionMemory();
      freshMem.init({ projectRoot: "/test/project", startTime: 3000000 });

      expect(renameSpy).toHaveBeenCalledWith(
        expect.stringContaining("session.json"),
        expect.stringContaining("memory.json"),
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Migrated session.json"),
      );
    });
  });
});
