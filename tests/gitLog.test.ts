import { jest } from "@jest/globals";
import type { Mock } from "jest-mock";

jest.unstable_mockModule("../src/utils/gitUtils.js", () => ({
  runGitCommand: jest.fn(),
  isGitRepo: jest.fn().mockReturnValue(true),
  getGitRoot: jest.fn().mockReturnValue("/test"),
}));

const { handleGitLog } = await import("../src/tools/gitLog.js");
const gitUtils = await import("../src/utils/gitUtils.js");

describe("gitLog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns commit log successfully", async () => {
    (gitUtils.runGitCommand as Mock).mockReturnValue(
      "a1b2c3d feat: initial commit\n5e6f7g8 chore: bump version"
    );

    const result = await handleGitLog({ maxCount: 2 });
    expect(result).toContain("Git Commit History");
    expect(result).toContain("feat: initial commit");
  });

  test("handles empty git history", async () => {
    (gitUtils.runGitCommand as Mock).mockReturnValue("");

    const result = await handleGitLog({ filePath: "nonexistent.ts" });
    expect(result).toContain("No commit history found");
  });

  test("handles execution errors gracefully", async () => {
    (gitUtils.runGitCommand as Mock).mockImplementation(() => {
      throw new Error("Command failed");
    });

    const result = await handleGitLog({});
    expect(result).toContain("Error");
    expect(result).toContain("Command failed");
  });
});