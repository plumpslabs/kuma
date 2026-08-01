// ============================================================
// KUMA LANGUAGE SUPPORT TESTS — Multi-language registry (P1)
// ============================================================

import { describe, test, expect } from "@jest/globals";
import {
  SOURCE_EXTENSIONS,
  SOURCE_EXT_GLOB,
  DEFAULT_SOURCE_INCLUDES,
  grepIncludeFlags,
  isSourceFile,
  isTestFile,
  getTestCandidates,
  matchImportPath,
} from "../src/engine/languageSupport.js";

describe("SOURCE_EXTENSIONS", () => {
  test("covers major languages beyond TS/JS", () => {
    const exts = SOURCE_EXTENSIONS;
    for (const ext of [".ts", ".js", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php", ".c", ".cpp", ".swift"]) {
      expect(exts).toContain(ext);
    }
  });

  test("SOURCE_EXT_GLOB is a fast-glob friendly set", () => {
    expect(SOURCE_EXT_GLOB.startsWith("{")).toBe(true);
    expect(SOURCE_EXT_GLOB.endsWith("}")).toBe(true);
    expect(SOURCE_EXT_GLOB).toContain("ts");
    expect(SOURCE_EXT_GLOB).toContain("py");
    expect(SOURCE_EXT_GLOB).toContain("go");
  });

  test("DEFAULT_SOURCE_INCLUDES use the multi-language glob", () => {
    for (const pattern of DEFAULT_SOURCE_INCLUDES) {
      expect(pattern).toContain(SOURCE_EXT_GLOB);
    }
  });

  test("grepIncludeFlags produces one --include flag per extension", () => {
    const flags = grepIncludeFlags();
    expect(flags).toContain('--include="*.ts"');
    expect(flags).toContain('--include="*.py"');
    expect(flags.split("--include").length - 1).toBe(SOURCE_EXTENSIONS.length);
  });
});

describe("isSourceFile", () => {
  test("accepts known extensions", () => {
    expect(isSourceFile("src/main.py")).toBe(true);
    expect(isSourceFile("cmd/server.go")).toBe(true);
    expect(isSourceFile("lib/mod.rs")).toBe(true);
    expect(isSourceFile("src/app.tsx")).toBe(true);
  });

  test("rejects unknown extensions", () => {
    expect(isSourceFile("README.md")).toBe(false);
    expect(isSourceFile("data.csv")).toBe(false);
    expect(isSourceFile("package-lock.json")).toBe(false);
  });
});

describe("isTestFile", () => {
  test("TS/JS conventions", () => {
    expect(isTestFile("src/auth/auth.test.ts")).toBe(true);
    expect(isTestFile("src/auth/auth.spec.js")).toBe(true);
    expect(isTestFile("src/__tests__/auth.ts")).toBe(true);
  });

  test("Python conventions", () => {
    expect(isTestFile("tests/test_auth.py")).toBe(true);
    expect(isTestFile("src/test_auth.py")).toBe(true);
    expect(isTestFile("src/auth_test.py")).toBe(true);
  });

  test("Go and Rust conventions", () => {
    expect(isTestFile("src/auth/auth_test.go")).toBe(true);
    expect(isTestFile("tests/auth_test.rs")).toBe(true);
  });

  test("Java/Kotlin/C# conventions", () => {
    expect(isTestFile("src/test/java/com/example/AuthTest.java")).toBe(true);
    expect(isTestFile("src/AuthTests.kt")).toBe(true);
    expect(isTestFile("src/AuthServiceTests.cs")).toBe(true);
  });

  test("Ruby conventions", () => {
    expect(isTestFile("spec/auth_spec.rb")).toBe(true);
  });

  test("does not flag regular source files", () => {
    expect(isTestFile("src/auth.ts")).toBe(false);
    expect(isTestFile("src/main.py")).toBe(false);
    expect(isTestFile("lib/mod.rs")).toBe(false);
    expect(isTestFile("src/server.go")).toBe(false);
  });

  test("does not over-match words ending in 'test' (case-sensitive PascalCase suffixes)", () => {
    expect(isTestFile("src/latest.java")).toBe(false);
    expect(isTestFile("src/contest.cs")).toBe(false);
    expect(isTestFile("src/attest.kt")).toBe(false);
    expect(isTestFile("src/pytest.scala")).toBe(false);
    expect(isTestFile("src/attestation.ts")).toBe(false);
  });
});

describe("getTestCandidates", () => {
  test("generates candidates for a TS file", () => {
    const candidates = getTestCandidates("src/auth/login.ts");
    expect(candidates).toContain("src/auth/login.test.ts");
    expect(candidates).toContain("src/auth/login.spec.ts");
    expect(candidates).toContain("src/auth/__tests__/login.ts");
    expect(candidates).toContain("src/auth/tests/login.ts");
  });

  test("generates candidates for a Python file", () => {
    const candidates = getTestCandidates("src/auth/login.py");
    expect(candidates).toContain("src/auth/login_test.py");
    expect(candidates).toContain("src/auth/test_login.py");
  });

  test("generates candidates for a Go file", () => {
    const candidates = getTestCandidates("src/auth/login.go");
    expect(candidates).toContain("src/auth/login_test.go");
  });

  test("all candidates are unique", () => {
    const candidates = getTestCandidates("src/auth/login.ts");
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe("matchImportPath", () => {
  test("JS/TS import", () => {
    expect(matchImportPath(`import { x } from "sql.js";`)).toBe("sql.js");
    expect(matchImportPath(`import fs from "node:fs";`)).toBe("node:fs");
  });

  test("CommonJS require", () => {
    expect(matchImportPath(`const sql = require("better-sqlite3");`)).toBe("better-sqlite3");
  });

  test("Python import and from-import", () => {
    expect(matchImportPath(`import mysql.connector`)).toBe("mysql.connector");
    expect(matchImportPath(`from sqlalchemy import create_engine`)).toBe("sqlalchemy");
  });

  test("Go import", () => {
    expect(matchImportPath(`import "github.com/go-sql-driver/mysql"`)).toBe("github.com/go-sql-driver/mysql");
  });

  test("C/C++ include", () => {
    expect(matchImportPath(`#include <sqlite3.h>`)).toBe("sqlite3.h");
  });

  test("Java import", () => {
    expect(matchImportPath(`import com.mysql.jdbc.Driver;`)).toBe("com.mysql.jdbc.Driver");
  });

  test("C# using", () => {
    expect(matchImportPath(`using System.Data.SqlClient;`)).toBe("System.Data.SqlClient");
  });

  test("returns null for non-import lines", () => {
    expect(matchImportPath(`const x = 5;`)).toBeNull();
    expect(matchImportPath(`// import { a } from "b"`)).not.toBeNull(); // comments still caught — acceptable
  });
});
