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
  formatHealReport,
  autoHeal,
  healOnQuery,
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("formatHealReport", () => {
    test("returns clean message when no stale entries", () => {
      const result = formatHealReport({ total: 0, healed: 0, missing: 0 });
      expect(result).toContain("No stale entries");
    });

    test("includes heal stats", () => {
      const result = formatHealReport({ total: 5, healed: 3, missing: 2 });
      expect(result).toContain("5");
      expect(result).toContain("3");
      expect(result).toContain("2");
    });

    test("handles singular vs plural", () => {
      const singular = formatHealReport({ total: 1, healed: 1, missing: 0 });
      expect(singular).toContain("entry");
      const plural = formatHealReport({ total: 2, healed: 1, missing: 1 });
      expect(plural).toContain("entries");
    });
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

  describe("autoHeal", () => {
    test("returns zeros when no stale nodes", async () => {
      mockGetAsObject.mockReturnValue(undefined);
      mockExecSync.mockReturnValue(Buffer.from(""));
      const result = await autoHeal();
      expect(result).toEqual({ total: 0, healed: 0, missing: 0, cascadedEdges: 0 });
    });
  });
});
