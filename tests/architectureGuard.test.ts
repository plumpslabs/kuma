import {
  checkArchitectureBoundaries,
  detectWorkspaceCircularDeps,
} from "../src/guards/architectureGuard.js";
import { getWorkspaceInfo } from "../src/engine/workspaceIntelligence.js";

describe("Architecture Boundary Guard", () => {
  it("detects no circular dependencies in current clean workspace", async () => {
    const wsInfo = await getWorkspaceInfo(process.cwd());
    const circulars = detectWorkspaceCircularDeps(wsInfo);
    expect(circulars).toEqual([]);
  });

  it("scans workspace without crashing and returns violations array", async () => {
    const violations = await checkArchitectureBoundaries(["src/engine/sessionMemory.ts"]);
    expect(Array.isArray(violations)).toBe(true);
  });
});
