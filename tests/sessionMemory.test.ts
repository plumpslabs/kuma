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
  // MEMORY SEARCH (keyword search)
  // ============================================================
  describe("searchMemory", () => {
    test("returns empty for empty memory", () => {
      const results = mem.searchMemory("anything");
      expect(results).toEqual([]);
    });

    test("finds tool calls by tool name", () => {
      mem.recordToolCall("smart_grep", { query: "auth" });
      mem.recordToolCall("smart_file_picker", { filePath: "test.ts" });

      const results = mem.searchMemory("smart_grep");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool:smart_grep");
    });

    test("finds tool calls by param content", () => {
      mem.recordToolCall("smart_grep", { query: "authentication" });

      const results = mem.searchMemory("authentication");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool:smart_grep");
      expect(results[0].content).toContain("authentication");
    });

    test("finds search results by query string", () => {
      mem.addSearchResult("authenticate", ["src/auth.ts"]);

      const results = mem.searchMemory("authenticate");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("search");
    });

    test("finds search results by file path", () => {
      mem.addSearchResult("login", ["src/auth.ts", "src/middleware.ts"]);

      const results = mem.searchMemory("middleware");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("search");
    });

    test("finds modified files by path", () => {
      mem.addModifiedFile("src/auth.ts");

      const results = mem.searchMemory("auth");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("file:modified");
    });

    test("finds created files", () => {
      mem.addCreatedFile("src/newFile.ts");

      const results = mem.searchMemory("newFile");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("file:created");
    });

    test("finds failed files by error message", () => {
      mem.addFailedFile("typecheck", "Type error in auth.ts:15");

      const results = mem.searchMemory("Type error");
      expect(results).toHaveLength(1);
      expect(results[0].type).toContain("failure");
      expect(results[0].content).toContain("UNRESOLVED");
    });

    test("finds failed files by task name", () => {
      mem.addFailedFile("typecheck", "Type error in auth.ts:15");

      const results = mem.searchMemory("typecheck");
      expect(results).toHaveLength(1);
    });

    test("multi-source search returns combined results", () => {
      mem.recordToolCall("smart_grep", { query: "auth test" });
      mem.addModifiedFile("src/auth.ts");
      mem.addSearchResult("auth_test", ["src/auth.ts"]);

      const results = mem.searchMemory("auth");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    test("search is case-insensitive", () => {
      mem.recordToolCall("FindUser", { query: "User" });

      const results = mem.searchMemory("finduser");
      expect(results).toHaveLength(1);
    });

    test("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        mem.recordToolCall("tool_" + i, {});
      }

      const results = mem.searchMemory("tool", 3);
      expect(results).toHaveLength(3);
    });

    test("returns all matching tool calls regardless of timestamp ordering", () => {
      mem.recordToolCall("tool_first", { seq: 1 });
      mem.recordToolCall("tool_second", { seq: 2 });
      mem.recordToolCall("tool_third", { seq: 3 });

      const results = mem.searchMemory("tool");
      expect(results.length).toBe(3);
      // All three should be found regardless of sort order
      expect(results.some(r => r.content.includes("tool_first"))).toBe(true);
      expect(results.some(r => r.content.includes("tool_third"))).toBe(true);
    });

    test("returns empty for non-matching query", () => {
      mem.recordToolCall("smart_grep", { query: "user" });
      mem.addModifiedFile("src/user.ts");

      const results = mem.searchMemory("nonexistent_pattern_xyz");
      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // SEARCH SESSION MEMORY (exported function wrapper)
  // ============================================================
  describe("searchSessionMemory formatting", () => {
    test("searchMemory returns correctly typed results", () => {
      mem.recordToolCall("smart_grep", { query: "test-query" });

      const results = mem.searchMemory("test-query");
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty("type");
      expect(results[0]).toHaveProperty("content");
      // timestamp is optional, but tool calls have it
      expect(results[0].timestamp).toBeDefined();
    });

    test("searchMemory returns tool calls with correct structure", () => {
      mem.recordToolCall("my_tool", { key: "value" });

      const results = mem.searchMemory("my_tool");
      expect(results[0].type).toBe("tool:my_tool");
      expect(results[0].content).toContain("my_tool");
      expect(results[0].content).toContain("value");
    });

    test("searchMemory finds dependency graph entries", () => {
      mem.addDependency("src/auth.ts", "src/user.ts");

      const results = mem.searchMemory("auth.ts");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("dependency");
      expect(results[0].content).toContain("user.ts");
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
