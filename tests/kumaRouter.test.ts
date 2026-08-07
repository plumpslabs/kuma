import { jest } from "@jest/globals";

const mockHandleContext = jest.fn<() => Promise<string>>().mockResolvedValue("context done");
const mockHandleMemory = jest.fn<() => Promise<string>>().mockResolvedValue("memory done");
const mockHandleSafety = jest.fn<() => Promise<string>>().mockResolvedValue("safety done");

jest.unstable_mockModule("../src/tools/kumaContextTool.js", () => ({ handleContext: mockHandleContext }));
jest.unstable_mockModule("../src/tools/kumaMemoryTool.js", () => ({ handleMemory: mockHandleMemory }));
jest.unstable_mockModule("../src/tools/kumaSafetyTool.js", () => ({ handleSafety: mockHandleSafety }));

const { handleContext, handleMemory, handleSafety } = await import("../src/engine/kumaRouter.js");

describe("kumaRouter", () => {
  test("handleContext delegates", async () => {
    const result = await handleContext({ action: "init", goal: "test" });
    expect(result).toBe("context done");
  });

  test("handleMemory delegates", async () => {
    const result = await handleMemory({ action: "decision" });
    expect(result).toBe("memory done");
  });

  test("handleSafety delegates", async () => {
    const result = await handleSafety({ action: "guard" });
    expect(result).toBe("safety done");
  });
});
