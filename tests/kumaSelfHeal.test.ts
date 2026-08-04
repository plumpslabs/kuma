import { jest } from "@jest/globals";

const mockRun = jest.fn<any>();
const mockPrepare = jest.fn<any>();
const mockStep = jest.fn<any>().mockReturnValue(false);
const mockGetAsObject = jest.fn<any>();
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
  healOnQuery,
  verifyGotchaStaleness,
  formatGotchaStalenessReport,
} = await import("../src/engine/kumaSelfHeal.js");

describe("kumaSelfHeal", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockRun.mockReturnValue(undefined);
    mockGetRowsModified.mockReturnValue(0);
    mockPrepare.mockReturnValue({
      step: mockStep,
      getAsObject: mockGetAsObject,
      free: jest.fn<any>(),
    });
    mockDb.exec.mockReturnValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("healOnQuery", () => {
    test("returns 0 when no file paths provided", async () => {
      const result = await healOnQuery([]);
      expect(result).toEqual({ healed: 0 });
    });

    test("returns 0 when files exist", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      mockGetAsObject.mockReturnValue(undefined);
      const result = await healOnQuery(["src/exists.ts"]);
      expect(result).toEqual({ healed: 0 });
    });

    test("skips search:: and api_route:: paths", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      mockGetAsObject.mockReturnValue(undefined);
      const result = await healOnQuery(["search::foo", "api_route::bar"]);
      expect(result).toEqual({ healed: 0 });
    });

    test("handles git errors gracefully", async () => {
      mockExecSync.mockImplementation(() => { throw new Error("git error"); });
      mockGetAsObject.mockReturnValue(undefined);
      const result = await healOnQuery(["src/broken.ts"]);
      expect(result).toEqual({ healed: 0 });
    });
  });

  describe("verifyGotchaStaleness", () => {
    test("returns empty when no gotcha nodes", async () => {
      mockDb.exec.mockReturnValue([]);
      const stale = await verifyGotchaStaleness();
      expect(stale).toEqual([]);
    });

    test("flags gotchas whose file is missing", async () => {
      mockDb.exec.mockReturnValue([{
        columns: ["id", "metadata"],
        values: [["g1", JSON.stringify({ file_path: "src/ghost.ts", description: "weird quirk" })]],
      }]);
      const stale = await verifyGotchaStaleness();
      expect(stale).toEqual([{ gotchaId: "g1", file_path: "src/ghost.ts", issue: "file_missing" }]);
    });

    test("skips non-file paths", async () => {
      mockDb.exec.mockReturnValue([{
        columns: ["id", "metadata"],
        values: [["g1", JSON.stringify({ file_path: "search::query", description: "weird" })]],
      }]);
      const stale = await verifyGotchaStaleness();
      expect(stale).toEqual([]);
    });

    test("handles corrupt metadata gracefully", async () => {
      mockDb.exec.mockReturnValue([{
        columns: ["id", "metadata"],
        values: [["g1", "{ not json"]],
      }]);
      const stale = await verifyGotchaStaleness();
      expect(stale).toEqual([]);
    });
  });

  describe("formatGotchaStalenessReport", () => {
    test("clean message when nothing stale", () => {
      const r = formatGotchaStalenessReport([]);
      expect(r).toContain("All gotcha references are valid");
    });

    test("lists stale gotchas with file paths", () => {
      const r = formatGotchaStalenessReport([
        { gotchaId: "g1", file_path: "src/a.ts", issue: "file_missing" },
      ]);
      expect(r).toContain("g1");
      expect(r).toContain("file missing");
      expect(r).toContain("src/a.ts");
    });
  });
});
