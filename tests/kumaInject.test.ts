// ============================================================
// KUMA INJECT TESTS — Shadow Memory (Roadmap F2/F3/F4/F5)
// ============================================================

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock pathValidator so getProjectRoot() points to a temp dir
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-inject-test-"));

jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: () => tmpRoot,
  getKumaDir: () => path.join(tmpRoot, ".kuma"),
  validateFilePath: (p: string) => ({ valid: true, resolvedPath: p }),
  normalizeScope: (raw: string) => raw,
  normalizeNodeId: (type: string, raw: string) => `${type}::${raw}`,
}));

const {
  hashFileContent,
  isGotchaFresh,
  getFreshGotchasForFile,
  formatFileTrace,
  getRelevantContext,
  parseHookInput,
  buildHookResponse,
} = await import("../src/engine/kumaInject.js");

// ============================================================
// F3 — CONTENT HASH
// ============================================================

describe("hashFileContent (F3)", () => {
  test("hash is stable and changes when file content changes", () => {
    const fp = path.join(tmpRoot, "src", "foo.ts");
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "export const a = 1;", "utf-8");

    const h1 = hashFileContent("src/foo.ts");
    expect(h1).toBeTruthy();
    expect(hashFileContent("src/foo.ts")).toBe(h1);

    fs.writeFileSync(fp, "export const a = 2;", "utf-8");
    expect(hashFileContent("src/foo.ts")).not.toBe(h1);
  });

  test("returns null for missing files", () => {
    expect(hashFileContent("src/does-not-exist.ts")).toBeNull();
  });
});

describe("isGotchaFresh (F3)", () => {
  test("null hash (legacy/unknown) → fresh, not dropped prematurely", () => {
    expect(isGotchaFresh(null, "abc")).toBe(true);
    expect(isGotchaFresh(undefined, "abc")).toBe(true);
  });

  test("matching hash → fresh", () => {
    expect(isGotchaFresh("abc", "abc")).toBe(true);
  });

  test("different hash (file changed) → stale → excluded from injection", () => {
    expect(isGotchaFresh("abc", "def")).toBe(false);
  });

  test("missing file → not treated as stale (handled by self-heal)", () => {
    expect(isGotchaFresh("abc", null)).toBe(true);
  });
});

describe("getFreshGotchasForFile (F3 — DB + staleness filter)", () => {
  test("without a DB → [] without error", async () => {
    expect(await getFreshGotchasForFile("src/foo.ts", 5)).toEqual([]);
  });

  test("only FRESH gotchas surface; stale filtered; legacy stays fresh", async () => {
    const { getDb, flushDb } = await import("../src/engine/kumaDb.js");
    const db = await getDb();
    // Migration pattern (same as production): add the content_hash column if missing
    const gotchaInfo = db.exec("PRAGMA table_info(known_gotchas)");
    const gotchaCols = (gotchaInfo[0]?.values ?? []).map((v: unknown[]) => String(v[1]));
    if (!gotchaCols.includes("content_hash")) {
      db.run(`ALTER TABLE known_gotchas ADD COLUMN content_hash TEXT`);
    }

    const fp = path.join(tmpRoot, "src", "foo.ts");
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "export const a = 1;", "utf-8");
    const h = hashFileContent("src/foo.ts");

    // 1. Fresh (matching hash)
    db.run(
      `INSERT INTO known_gotchas (file_path, description, severity, content_hash) VALUES (?, ?, 'high', ?)`,
      ["src/foo.ts", "Function X drops data when Y", h]
    );
    // 2. Stale (different hash — file changed since it was recorded)
    db.run(
      `INSERT INTO known_gotchas (file_path, description, severity, content_hash) VALUES (?, ?, 'critical', ?)`,
      ["src/foo.ts", "NEVER use the old pattern", "STALEHASH"]
    );
    // 3. Legacy (no hash → treated as fresh)
    db.run(
      `INSERT INTO known_gotchas (file_path, description, severity, content_hash) VALUES (?, ?, 'medium', NULL)`,
      ["src/foo.ts", "Legacy gotcha without a hash"]
    );
    flushDb(db); // synchronous — ensures .kuma/kuma.db exists immediately

    const gotchas = await getFreshGotchasForFile("src/foo.ts", 10);
    const descriptions = gotchas.map((g) => g.description);

    expect(descriptions).not.toContain("NEVER use the old pattern"); // stale filtered out
    expect(descriptions).toContain("Function X drops data when Y");
    expect(descriptions).toContain("Legacy gotcha without a hash");
    // Severity order: high before medium
    expect(gotchas[0].severity).toBe("high");

    // Change file content → the previously fresh gotcha becomes stale
    fs.writeFileSync(fp, "export const a = 2;", "utf-8");
    const after = await getFreshGotchasForFile("src/foo.ts", 10);
    expect(after.map((g) => g.description)).not.toContain("Function X drops data when Y");
  });
});

// ============================================================
// F5 — CROSS-SESSION TRACE
// ============================================================

describe("formatFileTrace (F5)", () => {
  test("concise 'why is this file written this way' narrative", () => {
    const out = formatFileTrace(
      [
        { changeType: "modified", filePath: "src/foo.ts", symbol: null, goal: "Fix auth flow", createdAt: 1700000000 },
        { changeType: "created", filePath: "src/foo.ts", symbol: null, goal: "Init session", createdAt: 1600000000 },
      ],
      "src/foo.ts"
    );
    expect(out).toContain("Why is foo.ts written this way?");
    expect(out).toContain("2 change(s)");
    expect(out).toContain("Fix auth flow");
    expect(out).toContain("created");
  });

  test("empty entries → empty string", () => {
    expect(formatFileTrace([], "src/foo.ts")).toBe("");
  });
});

// ============================================================
// F2/F4 — INJECT COMPOSITION
// ============================================================

describe("getRelevantContext (F2/F4)", () => {
  test("no data → empty string (anti-noise, inject nothing)", async () => {
    const ctx = await getRelevantContext("src/nonexistent.ts", "fix auth");
    expect(ctx).toBe("");
  });
});

// ============================================================
// F2 — CLAUDE CODE HOOK PROTOCOL
// ============================================================

describe("parseHookInput (F2)", () => {
  test("Edit tool → file_path", () => {
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts", old_string: "x", new_string: "y" },
    });
    expect(parseHookInput(input).filePaths).toEqual(["src/a.ts"]);
  });

  test("MultiEdit → single file_path", () => {
    const input = JSON.stringify({
      tool_name: "MultiEdit",
      tool_input: { file_path: "src/b.ts", edits: [{ old_string: "a", new_string: "b" }] },
    });
    expect(parseHookInput(input).filePaths).toEqual(["src/b.ts"]);
  });

  test("Write → new_file_path", () => {
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { new_file_path: "src/new.ts", content: "..." },
    });
    expect(parseHookInput(input).filePaths).toEqual(["src/new.ts"]);
  });

  test("invalid / no path → []", () => {
    expect(parseHookInput("not json").filePaths).toEqual([]);
    expect(parseHookInput("{}").filePaths).toEqual([]);
  });
});

describe("buildHookResponse (F2)", () => {
  test("empty context → {} (no injection)", () => {
    expect(buildHookResponse("")).toBe("{}");
    expect(buildHookResponse("   ")).toBe("{}");
  });

  test("with content → additionalContext per PreToolUse protocol", () => {
    const res = JSON.parse(buildHookResponse("⚠️ ACTIVE GOTCHAS"));
    expect(res.hookSpecificOutput.hookSpecificOutput.additionalContext).toContain("ACTIVE GOTCHAS");
  });
});
