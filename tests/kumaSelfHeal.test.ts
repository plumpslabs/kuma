import { jest } from "@jest/globals";

// ============================================================
// Mock kumaDb — lightweight mocks to avoid sql.js WASM loading
// ============================================================
const mockRun = jest.fn<any>();
const mockPrepare = jest.fn<any>();
const mockStep = jest.fn<any>().mockReturnValue(false);
const mockGetAsObject = jest.fn<any>();
const mockFree = jest.fn<any>();
const mockGetRowsModified = jest.fn<any>().mockReturnValue(0);
const mockDb = {
  run: mockRun,
  prepare: mockPrepare,
  exec: jest.fn<any>(),
  getRowsModified: mockGetRowsModified,
};
const mockGetDb = jest.fn<any>().mockResolvedValue(mockDb);
const mockSaveDb = jest.fn<any>();

jest.unstable_mockModule("../src/engine/kumaDb.js", () => ({
  getDb: mockGetDb,
  saveDb: mockSaveDb,
}));

jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: jest.fn<any>().mockReturnValue("/tmp/kuma-selfheal-test"),
}));

const mockExecSync = jest.fn<any>();
jest.unstable_mockModule("node:child_process", () => ({
  execSync: mockExecSync,
}));

const {
  formatHealReport,
  formatStaleEntries,
  cascadeStaleEdges,
  healStaleNode,
  autoHeal,
  incrementalHeal,
  healOnQuery,
} = await import("../src/engine/kumaSelfHeal.js");

describe("kumaSelfHeal", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockRun.mockReturnValue(undefined);
    mockGetRowsModified.mockReturnValue(0);
    mockPrepare.mockReturnValue({
      bind: jest.fn<any>(),
      step: mockStep,
      getAsObject: mockGetAsObject,
      free: mockFree,
    });
    mockExecSync.mockReturnValue("");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================
  // FORMATTING (pure functions — no DB needed)
  // ============================================================
  describe("formatHealReport", () => {
    test("returns clean message when no stale entries", () => {
      expect(
        formatHealReport({ healed: 0, missing: 0, total: 0, cascadedEdges: 0 }),
      ).toContain("No stale entries found");
    });
    test("includes heal stats", () => {
      const result = formatHealReport({
        healed: 3,
        missing: 1,
        total: 4,
        cascadedEdges: 5,
      });
      expect(result).toContain("4 stale");
      expect(result).toContain("3 healed");
      expect(result).toContain("1 missing");
      expect(result).toContain("5 cascade");
    });
    test("handles singular vs plural", () => {
      expect(
        formatHealReport({ healed: 1, missing: 0, total: 1, cascadedEdges: 0 }),
      ).toContain("1 stale entry");
      expect(
        formatHealReport({ healed: 0, missing: 2, total: 2, cascadedEdges: 0 }),
      ).toContain("2 stale entries");
    });
  });

  describe("formatStaleEntries", () => {
    test("returns clean message when no entries", () => {
      expect(formatStaleEntries([])).toContain("No stale entries");
    });
    test("formats entries with renamed files", () => {
      const entries = [
        {
          nodeId: "file::src/missing.ts",
          type: "file",
          name: "src/missing.ts",
          oldPath: "src/missing.ts",
          newPath: null,
          issue: "file-missing" as const,
        },
        {
          nodeId: "function::login",
          type: "function",
          name: "login",
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          issue: "path-changed" as const,
        },
      ];
      const result = formatStaleEntries(entries);
      expect(result).toContain("src/missing.ts");
      expect(result).toContain("login");
      expect(result).toContain("src/new.ts");
    });
  });

  // ============================================================
  // cascadeStaleEdges
  // ============================================================
  describe("cascadeStaleEdges", () => {
    test("returns count of affected edges", async () => {
      mockGetRowsModified.mockReturnValueOnce(3);
      mockRun.mockReturnValue(undefined);

      const count = await cascadeStaleEdges(["file::src/missing.ts"]);
      expect(count).toBe(3);
      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE edges SET weight"),
        ["file::src/missing.ts", "file::src/missing.ts"],
      );
      expect(mockSaveDb).toHaveBeenCalled();
    });
    test("returns 0 when no edges affected", async () => {
      const count = await cascadeStaleEdges(["file::src/ok.ts"]);
      expect(count).toBe(0);
    });
    test("handles empty input", async () => {
      const count = await cascadeStaleEdges([]);
      expect(count).toBe(0);
    });
  });

  // ============================================================
  // healStaleNode
  // ============================================================
  describe("healStaleNode", () => {
    test("returns true when newPath exists (file renamed)", async () => {
      mockSaveDb.mockClear();
      const result = await healStaleNode({
        nodeId: "file::src/old-name.ts",
        type: "file",
        name: "src/old-name.ts",
        oldPath: "src/old-name.ts",
        newPath: "src/new-name.ts",
        issue: "path-changed",
      });
      expect(result).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE nodes SET file_path"),
        ["src/new-name.ts", "file::src/old-name.ts"],
      );
    });
    test("returns false when no newPath (file missing)", async () => {
      const result = await healStaleNode({
        nodeId: "file::src/missing.ts",
        type: "file",
        name: "src/missing.ts",
        oldPath: "src/missing.ts",
        newPath: null,
        issue: "file-missing",
      });
      expect(result).toBe(false);
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("$.stale"), [
        "file::src/missing.ts",
      ]);
    });
  });

  // ============================================================
  // healOnQuery
  // ============================================================
  describe("healOnQuery", () => {
    test("returns 0 when no file paths provided", async () => {
      expect(await healOnQuery([])).toEqual({ healed: 0 });
    });
    test("returns 0 when files exist", async () => {
      // getProjectRoot will return /tmp/kuma-selfheal-test which doesn't exist
      // but healOnQuery checks fs.existsSync so it should handle gracefully
      mockExecSync.mockReturnValue("");
      const result = await healOnQuery(["src/test-file.ts"]);
      expect(result).toEqual({ healed: 0 });
    });
    test("skips search:: and api_route:: paths", async () => {
      expect(await healOnQuery(["search::login"])).toEqual({ healed: 0 });
      expect(await healOnQuery(["api_route::POST/login"])).toEqual({
        healed: 0,
      });
    });
    test("handles git errors gracefully", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("git error");
      });
      const result = await healOnQuery(["src/missing.ts"]);
      expect(result).toEqual({ healed: 0 });
    });
  });

  // ============================================================
  // autoHeal — end-to-end (fast path: no stale nodes)
  // ============================================================
  describe("autoHeal", () => {
    test("returns zeros when no stale nodes", async () => {
      // Prepare returns a stmt with no rows
      const result = await autoHeal();
      expect(result).toMatchObject({
        total: 0,
        healed: 0,
        missing: 0,
        cascadedEdges: 0,
      });
    });
  });

  // ============================================================
  // incrementalHeal — (fast path: no changes)
  // ============================================================
  describe("incrementalHeal", () => {
    test("returns zeros when no stale nodes for changed files", async () => {
      // prepare returns stmt with no rows = no stale nodes
      const result = await incrementalHeal(["src/auth.ts"]);
      expect(result).toMatchObject({ total: 0, healed: 0, missing: 0 });
    });
  });
});
