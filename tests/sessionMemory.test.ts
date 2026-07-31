import { jest } from "@jest/globals";
import fs from "node:fs";

// Mock kumaDb.js to prevent sql.js WASM loading crash in test environment
jest.unstable_mockModule("../src/engine/kumaDb.js", () => ({
  getDb: jest.fn<any>().mockResolvedValue({
    run: jest.fn(),
    prepare: jest.fn().mockReturnValue({
      step: jest.fn().mockReturnValue(false),
      getAsObject: jest.fn(),
      bind: jest.fn(),
      free: jest.fn(),
    }),
    exec: jest.fn().mockReturnValue([]),
  }),
  saveDb: jest.fn(),
}));

// Dynamic import after mocking
const { sessionMemory } = await import("../src/engine/sessionMemory.js");

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(fs, "existsSync").mockReturnValue(false);
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
  jest.spyOn(fs, "readFileSync").mockReturnValue("");

  sessionMemory.init({
    projectRoot: "/test/project",
    startTime: 1000000,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SessionMemory", () => {
  test("writeMemory and getMemoryContent", () => {
    sessionMemory.writeMemory("decisions", "hello");
    const content = sessionMemory.getMemoryContent("decisions");
    expect(typeof content).toBe("string");
  });

  test("recordToolCall and getToolCallHistory", () => {
    sessionMemory.recordToolCall("tool1", { arg: 1 });
    sessionMemory.recordToolCall("tool2", { arg: 2 });
    const history = sessionMemory.getToolCallHistory(10);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  test("getSummary returns state object", () => {
    const summary = sessionMemory.getSummary();
    expect(summary).toHaveProperty("currentGoal");
    expect(summary).toHaveProperty("modifiedFiles");
    expect(summary).toHaveProperty("toolCallCount");
  });

  test("detectLoop returns isLooping false when no loop", () => {
    sessionMemory.recordToolCall("a", {});
    sessionMemory.recordToolCall("b", {});
    const loop = sessionMemory.detectLoop();
    expect(loop.isLooping).toBe(false);
  });

  test("detectLoop detects tool loop", () => {
    for (let i = 0; i < 12; i++) {
      sessionMemory.recordToolCall("same_tool", {});
    }
    const loop = sessionMemory.detectLoop();
    expect(loop.isLooping).toBe(true);
    expect(loop.toolName).toBe("same_tool");
  });

  test("getConventions returns undefined when none set", () => {
    const conv = sessionMemory.getConventions();
    expect(conv).toBeUndefined();
  });

  test("recordToolCall auto-tracks to DB without crashing", () => {
    // This should not crash even though kumaDb is mocked
    expect(() => {
      sessionMemory.recordToolCall("test_tool", { arg: "value" });
    }).not.toThrow();
  });
});
