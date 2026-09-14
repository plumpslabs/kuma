import { describe, test, expect } from "@jest/globals";
import { parseFileAst, resolveImportPath, scanCodebase } from "../src/engine/kumaCodeScanner.js";
import { nodeId } from "../src/engine/kumaGraph.js";
import { calculateBlastRadius } from "../src/engine/impactAnalysis.js";

describe("Deterministic AST Scanner & Blast Radius", () => {
  test("nodeId generates 100% deterministic IDs without random UUIDs", () => {
    const id1 = nodeId("function", "getDb");
    const id2 = nodeId("function", "getDb");
    expect(id1).toBe(id2);
    expect(id1).toBe("function::getDb");

    const domainId1 = nodeId("feature_domain", "AuthFlow");
    const domainId2 = nodeId("feature_domain", "AuthFlow");
    expect(domainId1).toBe(domainId2);
    expect(domainId1).toBe("feature_domain::AuthFlow");

    const fileId = nodeId("file", "src/engine/kumaDb.ts");
    expect(fileId).toBe("file::src/engine/kumaDb.ts");
  });

  test("resolveImportPath correctly resolves ESM .js imports to .ts files", () => {
    const resolved = resolveImportPath("src/engine/kumaGraph.ts", "./kumaDb.js", process.cwd());
    expect(resolved).toBe("src/engine/kumaDb.ts");
  });

  test("parseFileAst extracts functions, classes, interfaces, descriptions, and signatures", () => {
    const sampleTs = `
      import { getDb } from "./kumaDb.js";
      import path from "node:path";

      /**
       * Configuration options for user entity.
       */
      export interface UserConfig {
        name: string;
      }

      /**
       * Manages user records in database.
       */
      export class UserManager implements UserConfig {
        name = "admin";
        saveUser(id: string) { return id; }
      }

      /**
       * Computes the sum metrics.
       * @param a first operand
       * @param b second operand
       */
      export async function calculateMetrics(a: number, b: number): Promise<number> {
        return a + b;
      }
    `;

    const parsed = parseFileAst("src/sample.ts", sampleTs);
    const fn = parsed.symbols.find((s) => s.name === "calculateMetrics");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.signature).toContain("(a: number, b: number): Promise<number>");
    expect(fn?.description).toContain("Computes the sum metrics");

    const cls = parsed.symbols.find((s) => s.name === "UserManager");
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe("class");
    expect(cls?.description).toContain("Manages user records in database");
    expect(cls?.methods).toContain("saveUser(id)");

    const iface = parsed.symbols.find((s) => s.name === "UserConfig");
    expect(iface).toBeDefined();
    expect(iface?.description).toContain("Configuration options for user entity");
    expect(iface?.members).toContain("name");

    expect(parsed.imports.some((i) => i.source === "./kumaDb.js")).toBe(true);
  });

  test("scanCodebase indexes files into real nodes and edges", async () => {
    const scanResult = await scanCodebase({
      include: ["src/engine/*.ts", "src/tools/*.ts"],
      force: true,
    });

    expect(scanResult.filesScanned).toBeGreaterThanOrEqual(15);
    expect(scanResult.nodeCount).toBeGreaterThan(50);
    expect(scanResult.edgeCount).toBeGreaterThan(50);
  });

  test("calculateBlastRadius leverages graph-first analysis", async () => {
    const blast = await calculateBlastRadius("src/engine/kumaDb.ts");
    expect(blast.target).toContain("kumaDb");
    expect(blast.confidence).toBeGreaterThan(0.5);
    expect(blast.directDependents.length).toBeGreaterThan(0);
    expect(blast.summary).toContain("Impact");
  });
});
