import { jest } from "@jest/globals";
import { handleCodeReviewer } from "../src/agents/codeReviewer.js";
import fs from "node:fs";

describe("codeReviewer", () => {
  const testCodeContent = `
      console.log("hello");
      const x: any = 123;
      eval("alert('test')");
    `;

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
    jest.spyOn(fs, "readFileSync").mockImplementation((p) => {
      // Return valid JSON for session memory files, test code for everything else
      if (typeof p === "string" && (p.endsWith(".json") || p.endsWith(".kuma-memory.json"))) {
        return "{}";
      }
      return testCodeContent;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns text formatted review comments", async () => {
    const result = await handleCodeReviewer({
      files: ["src/index.ts"],
      focus: "correctness",
    });

    expect(result).toContain("Code Review");
    expect(result).toContain("console.log");
    expect(result).toContain("'any' type");
  });

  test("returns structured JSON with summary and issuesByFile", async () => {
    const result = await handleCodeReviewer({
      files: ["src/index.ts"],
      focus: "correctness",
      format: "json",
    });

    const parsed = JSON.parse(result);

    // Verify top-level structure
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("issuesByFile");
    expect(parsed).toHaveProperty("issues");

    // Verify summary fields
    expect(parsed.summary.totalIssues).toBeGreaterThan(0);
    expect(typeof parsed.summary.errors).toBe("number");
    expect(typeof parsed.summary.warnings).toBe("number");
    expect(typeof parsed.summary.info).toBe("number");
    expect(parsed.summary.filesReviewed).toBe(1);
    expect(parsed.summary.filesRequested).toBe(1);
    expect(parsed.summary.focus).toBe("correctness");
    expect(parsed.summary.customCriteria).toBeUndefined();

    // Verify issuesByFile is grouped correctly
    expect(parsed.issuesByFile["src/index.ts"]).toBeDefined();
    expect(parsed.issuesByFile["src/index.ts"].length).toBe(parsed.issues.length);

    // Verify issues array structure
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues[0].file).toBe("src/index.ts");
    expect(parsed.issues[0].severity).toBeDefined();
    expect(parsed.issues[0].message).toBeDefined();
  });

  test("includes customCriteria in JSON summary when provided", async () => {
    const result = await handleCodeReviewer({
      files: ["src/index.ts"],
      focus: "correctness",
      format: "json",
      customCriteria: "No console.log allowed",
    });

    const parsed = JSON.parse(result);
    expect(parsed.summary.customCriteria).toBe("No console.log allowed");
  });
});
