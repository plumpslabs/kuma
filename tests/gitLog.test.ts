import { jest } from "@jest/globals";

const mockRunGitCommand = jest.fn<any>();
const mockIsGitRepo = jest.fn<any>().mockReturnValue(true);
const mockGetGitRoot = jest.fn<any>().mockReturnValue("/test");

jest.unstable_mockModule("../src/utils/gitUtils.js", () => ({
  runGitCommand: mockRunGitCommand,
  isGitRepo: mockIsGitRepo,
  getGitRoot: mockGetGitRoot,
}));

const { handleGitLog } = await import("../src/tools/gitLog.js");

describe("gitLog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns commit log successfully", async () => {
    mockRunGitCommand.mockReturnValue(
      "a1b2c3d feat: initial commit\n5e6f7g8 chore: bump version",
    );

    const result = await handleGitLog({ maxCount: 2 });
    expect(result).toContain("Git Commit History");
    expect(result).toContain("feat: initial commit");
  });

  test("handles empty git history", async () => {
    mockRunGitCommand.mockReturnValue("");

    const result = await handleGitLog({ filePath: "nonexistent.ts" });
    expect(result).toContain("No commit history found");
  });

  test("handles execution errors gracefully", async () => {
    mockRunGitCommand.mockImplementation(() => {
      throw new Error("Command failed");
    });

    const result = await handleGitLog({});
    expect(result).toContain("Error");
    expect(result).toContain("Command failed");
  });
});
