import { calculateBlastRadius } from "../src/engine/impactAnalysis.js";

describe("Impact & Blast Radius Analysis", () => {
  it("calculates blast radius for a file target", async () => {
    const result = await calculateBlastRadius("src/engine/sessionMemory.ts");
    expect(result).toBeDefined();
    expect(result.target).toBe("src/engine/sessionMemory.ts");
    expect(result.targetType).toBe("file");
    expect(result.risk).toBeDefined();
    expect(result.summary).toContain("Blast Radius");
    // sessionMemory is imported by multiple files in kuma
    expect(result.directDependents.length).toBeGreaterThan(0);
  });

  it("identifies package ownership and downstream packages", async () => {
    const result = await calculateBlastRadius("@kuma/studio");
    expect(result.targetType).toBe("package");
    expect(result.owningPackage?.name).toBe("@kuma/studio");
  });

  it("flags critical files properly", async () => {
    const result = await calculateBlastRadius("src/engine/kumaSafetyLayer.ts");
    expect(result.riskFlags.some((f) => f.includes("Critical") || f.includes("Security"))).toBe(true);
  });
});
