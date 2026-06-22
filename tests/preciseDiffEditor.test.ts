import {
  applyEdit,
  countOccurrences,
  replaceAll,
  normalizeWhitespace,
  findFuzzyMatch,
  calculateSimilarity,
  levenshteinDistance,
  findNearestLine,
} from "../src/tools/preciseDiffEditor.js";
import fs from "node:fs";

// ============================================================
// PRECISE DIFF EDITOR — Unit Tests
// ============================================================

describe("countOccurrences", () => {
  test("counts single occurrence", () => {
    expect(countOccurrences("hello world hello", "world")).toBe(1);
  });

  test("counts multiple occurrences", () => {
    expect(countOccurrences("hello hello hello", "hello")).toBe(3);
  });

  test("returns 0 when not found", () => {
    expect(countOccurrences("hello world", "xyz")).toBe(0);
  });

  test("handles empty strings", () => {
    expect(countOccurrences("hello", "")).toBe(0);
    expect(countOccurrences("", "hello")).toBe(0);
  });
});

describe("replaceAll", () => {
  test("replaces all occurrences", () => {
    expect(replaceAll("a-b-c-d", "-", ":")).toBe("a:b:c:d");
  });

  test("no matches returns original", () => {
    expect(replaceAll("hello world", "x", "y")).toBe("hello world");
  });

  test("handles empty strings", () => {
    expect(replaceAll("", "a", "b")).toBe("");
  });
});

describe("normalizeWhitespace", () => {
  test("normalizes CRLF to LF", () => {
    expect(normalizeWhitespace("hello\r\nworld\r\n")).toBe("hello\nworld");
  });

  test("collapses multiple spaces", () => {
    expect(normalizeWhitespace("hello    world")).toBe("hello world");
  });

  test("collapses multiple tabs", () => {
    expect(normalizeWhitespace("hello\t\t\tworld")).toBe("hello world");
  });

  test("trims leading/trailing whitespace per line", () => {
    expect(normalizeWhitespace("  hello world  ")).toBe("hello world");
  });

  test("collapses multiple blank lines", () => {
    expect(normalizeWhitespace("hello\n\n\n\nworld")).toBe("hello\n\nworld");
  });

  test("handles mixed whitespace in code", () => {
    const input = "  function foo() {\n    return 1;\n  }  ";
    const result = normalizeWhitespace(input);
    expect(result).toBe("function foo() {\nreturn 1;\n}");
  });
});

describe("levenshteinDistance", () => {
  test("identical strings have distance 0", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  test("completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });

  test("single character substitution", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
  });

  test("insertion", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  test("deletion", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  test("handles empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });
});

describe("calculateSimilarity", () => {
  test("identical strings have similarity 1.0", () => {
    expect(calculateSimilarity("hello world", "hello world")).toBe(1.0);
  });

  test("similar strings have high similarity", () => {
    const sim = calculateSimilarity("function authenticate()", "function autenticate()");
    expect(sim).toBeGreaterThan(0.8);
  });

  test("very different strings have low similarity", () => {
    const sim = calculateSimilarity("abc", "xyzxyzxyz");
    expect(sim).toBeLessThan(0.5);
  });

  test("empty strings return 1.0", () => {
    expect(calculateSimilarity("", "")).toBe(1.0);
  });
});

describe("findFuzzyMatch", () => {
  test("finds exact match with threshold 1.0", () => {
    const content = "function hello() {\n  return 1;\n}\nfunction world() {}";
    const result = findFuzzyMatch(content, "function hello()", 1.0);
    expect(result).not.toBeNull();
    expect(result!.match).toContain("function hello()");
  });

  test("finds similar match with lower threshold", () => {
    const content = "function authenticate() {\n  return true;\n}";
    const result = findFuzzyMatch(content, "function autenticate()", 0.7);
    expect(result).not.toBeNull();
  });

  test("returns null when no match meets threshold", () => {
    const content = "function foo() { return 1; }";
    const result = findFuzzyMatch(content, "class SomethingElse", 0.9);
    expect(result).toBeNull();
  });

  test("handles empty content", () => {
    const result = findFuzzyMatch("", "test", 0.8);
    expect(result).toBeNull();
  });
});

describe("findNearestLine", () => {
  test("finds line with most matching words", () => {
    const content = "line with some words\nanother line with different content\nauthenticate user login password";
    const result = findNearestLine(content, "authenticate user login");
    expect(result).not.toBeNull();
    expect(result!.line).toBe(3);
  });

  test("returns null for search with too few significant words", () => {
    const content = "hello world";
    const result = findNearestLine(content, "hi");
    expect(result).toBeNull();
  });

  test("returns null for empty content", () => {
    const result = findNearestLine("", "some search query");
    expect(result).toBeNull();
  });
});

describe("applyEdit", () => {
  const testFilePath = "/tmp/test-apply-edit.ts";

  beforeEach(() => {
    jest.spyOn(fs, "copyFileSync").mockImplementation(() => {});
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("exact match replaces correctly", () => {
    const content = "const x = 1;\nconst y = 2;\nconst z = 3;";
    const result = applyEdit(content, {
      searchBlock: "const y = 2;",
      replaceBlock: "const y = 42;",
    }, testFilePath, 0);

    expect(result.success).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.details).toContain("const y = 42;");
    expect(result.details).not.toContain("const y = 2;");
  });

  test("allowMultiple replaces all occurrences", () => {
    const content = "const x = 1;\nconst x = 2;";
    const result = applyEdit(content, {
      searchBlock: "const x =",
      replaceBlock: "const y =",
      allowMultiple: true,
    }, testFilePath, 0);

    expect(result.success).toBe(true);
    expect(result.matched).toBe(2);
    expect(result.replaced).toBe(2);
  });

  test("whitespace normalization fallback works", () => {
    const content = "function  hello() {\n  return  1;\n}";
    const result = applyEdit(content, {
      searchBlock: "function hello() {\n return 1;\n}",
      replaceBlock: "function hello() {\n  return 42;\n}",
    }, testFilePath, 0);

    expect(result.success).toBe(true);
  });

  test("fuzzy match fallback works for similar content", () => {
    const content = "function authenticateUser() {\n  return token;\n}";
    const result = applyEdit(content, {
      searchBlock: "function autenticateUser() {\n  return token;\n}",
      replaceBlock: "function authenticateUser() {\n  return jwt;\n}",
      fuzzyThreshold: 0.7,
    }, testFilePath, 0);

    expect(result.success).toBe(true);
  });

  test("returns error for non-matching content", () => {
    const content = "something completely different";
    const result = applyEdit(content, {
      searchBlock: "this pattern does not exist anywhere",
      replaceBlock: "replacement",
    }, testFilePath, 0);

    expect(result.success).toBe(false);
    expect(result.error).toContain("DIFF_MISMATCH");
  });
});
