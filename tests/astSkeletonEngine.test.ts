import { generateFileSkeleton, findSourceFilePath } from "../src/engine/astSkeletonEngine.js";

describe("Kuma AST Skeleton Engine", () => {
  it("finds source file path from relative or partial path", () => {
    const found = findSourceFilePath("src/index.ts");
    expect(found).not.toBeNull();
    expect(found).toContain("src/index.ts");
  });

  it("compresses TypeScript file into structural skeleton without function bodies", () => {
    const result = generateFileSkeleton("src/engine/kumaGraph.ts");
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.originalLines).toBeGreaterThan(500);
    expect(result.skeletonLines).toBeLessThan(result.originalLines);
    expect(result.compressionRatio).toBeGreaterThan(60);
    expect(result.skeletonCode).toContain("export interface ImpactResult");
    expect(result.skeletonCode).toContain("export async function analyzeImpact(");
    // Function body should be omitted (ended with semicolon or signature, not raw body lines)
    expect(result.formattedOutput).toContain("AST Code Skeleton");
    expect(result.formattedOutput).toContain("token reduction");
  });

  it("filters skeleton by specific targetSymbol", () => {
    const result = generateFileSkeleton("src/engine/kumaGraph.ts", "analyzeImpact");
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.skeletonCode).toContain("analyzeImpact");
    expect(result.formattedOutput).toContain("analyzeImpact");
  });

  it("returns null for non-existent file path", () => {
    const result = generateFileSkeleton("non_existent_dummy_file_12345.ts");
    expect(result).toBeNull();
  });
});
