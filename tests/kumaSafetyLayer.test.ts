import { jest } from "@jest/globals";

// ============================================================
// Shared mutable mock refs — prevents state leaks between tests
// jest.unstable_mockModule factories close over these variables
// NOTE: Do NOT mock node:fs globally — it breaks other test suites
// that rely on real filesystem operations (e.g., sql.js WASM loading).
// ============================================================
const mockIsLocked = jest.fn<() => { locked: boolean; by?: string; since?: number }>().mockReturnValue({ locked: false });
const mockGetSummary = jest
  .fn<() => { modifiedFiles: string[] }>()
  .mockReturnValue({ modifiedFiles: [] });

// Mock sql.js so kumaDb.ts doesn't try to load real WASM.
// jest.unstable_mockModule returns the factory value as-is (no __importDefault wrapping),
// so the default export is just { default: mockInit }.
const mockSqlJsInit = jest.fn<() => Promise<any>>().mockResolvedValue({
  Database: jest.fn<() => any>().mockReturnValue({
    exec: jest.fn<(query: string) => any[]>().mockImplementation((query: string) => {
      if (query.includes("FROM nodes")) {
        return [{ columns: ["c"], values: [[5]] }];
      }
      if (query.includes("FROM failure_kb")) {
        return [{ columns: ["c"], values: [[0]] }];
      }
      return [];
    }),
    run: jest.fn(),
    close: jest.fn(),
    export: jest.fn<() => Uint8Array>().mockReturnValue(new Uint8Array()),
  }),
});

jest.unstable_mockModule("sql.js", () => ({
  default: mockSqlJsInit,
}));

// Mock pathValidator that kumaDb.ts needs
jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: jest.fn<() => string>().mockReturnValue("/tmp/kuma-test"),
  getKumaDir: jest.fn<() => string>().mockReturnValue("/tmp/kuma-test/.kuma"),
  validateFilePath: jest
    .fn<() => { valid: boolean; resolvedPath: string }>()
    .mockReturnValue({ valid: true, resolvedPath: "/test/project/file.ts" }),
}));

// Mock kumaLock with mutable ref
jest.unstable_mockModule("../src/engine/kumaLock.js", () => ({
  isLocked: mockIsLocked,
}));

// Mock sessionMemory with mutable ref
jest.unstable_mockModule("../src/engine/sessionMemory.js", () => ({
  sessionMemory: {
    getSummary: mockGetSummary,
  },
}));

// ============================================================
// Dynamic imports — work because unstable_mockModule is called
// BEFORE await import()
// ============================================================
const { safetyCheck } = await import("../src/engine/kumaSafetyLayer.js");

describe("kumaSafetyLayer", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    // Reset shared mutable mocks to default state
    mockIsLocked.mockReturnValue({ locked: false });
    mockGetSummary.mockReturnValue({ modifiedFiles: [] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("safetyCheck", () => {
    test("returns allowed when all checks pass", async () => {
      const result = await safetyCheck("edit", "file.ts");
      expect(result).toContain("Allowed");
      expect(result).toContain("low");
    });

    test("blocks when file is locked", async () => {
      mockIsLocked.mockReturnValue({
        locked: true,
        by: "other-agent",
        since: Date.now(),
      });
      const result = await safetyCheck("edit", "locked.ts");
      expect(result).toContain("Blocked");
    });

    test("flags dangerous commands", async () => {
      const result = await safetyCheck("command", undefined, "rm -rf /");
      expect(result).toContain("Blocked");
    });

    test("allows safe commands", async () => {
      const result = await safetyCheck("command", undefined, "ls -la");
      expect(result).toContain("Allowed");
    });

    test("handles DB errors gracefully", async () => {
      mockGetSummary.mockImplementation(() => {
        throw new Error("no session");
      });
      mockIsLocked.mockReturnValue({
        locked: true,
        by: "other-agent",
        since: Date.now(),
      });
      const result = await safetyCheck("edit", "file.ts");
      expect(result).not.toContain("Error in safety check");
    });

    test("does not crash when sessionMemory.getSummary throws", async () => {
      mockGetSummary.mockImplementation(() => {
        throw new Error("no session");
      });
      const result = await safetyCheck("edit", "file.ts");
      expect(result).toContain("Allowed");
    });
  });
});
