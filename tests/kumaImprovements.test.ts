// ============================================================
// KUMA IMPROVEMENTS TESTS — Roadmap I1/I2/I3/I4/I8
// ============================================================
// I1: gotcha lifecycle auto-resolve · I2: command-trigger gotchas
// I3: loop auto-capture · I4: injection metrics · I8: flow derived cache

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-improve-test-"));

jest.unstable_mockModule("../src/utils/pathValidator.js", () => ({
  getProjectRoot: () => tmpRoot,
  getKumaDir: () => path.join(tmpRoot, ".kuma"),
  validateFilePath: (p: string) => ({ valid: true, resolvedPath: p }),
  normalizeScope: (raw: string) => raw,
  normalizeNodeId: (type: string, raw: string) => `${type}::${raw}`,
}));

const { getDb, flushDb } = await import("../src/engine/kumaDb.js");
const {
  resolveGotchasForScope,
  getActiveGotchasForCommand,
  recordInjection,
} = await import("../src/engine/kumaGotchas.js");
const { hashFileContent, trackFileEditLoop } = await import("../src/engine/kumaInject.js");
const { deriveHopsFromImports } = await import("../src/engine/kumaFlowCache.js");

/** Ensures the known_gotchas + injections tables exist with all columns. */
async function ensureSchema(): Promise<void> {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS known_gotchas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    workaround TEXT,
    added_by TEXT DEFAULT 'agent',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    content_hash TEXT,
    trigger_command TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_verified_at INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS injections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    command TEXT,
    kind TEXT NOT NULL DEFAULT 'edit',
    saved_ms INTEGER NOT NULL DEFAULT 5000,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);
  flushDb(db);
}

function writeFile(rel: string, content: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

// ============================================================
// I1 — GOTCHA LIFECYCLE AUTO-RESOLVE
// ============================================================

describe("resolveGotchasForScope (I1)", () => {
  beforeEach(async () => {
    const db = await getDb();
    db.run("DELETE FROM known_gotchas");
    flushDb(db);
  });

  test("marks gotchas RESOLVED only when the file changed since recording", async () => {
    await ensureSchema();
    const db = await getDb();
    const fp = writeFile("src/foo.ts", "export const a = 1;\n");
    const h = hashFileContent("src/foo.ts");

    db.run(`INSERT INTO known_gotchas (file_path, description, severity, content_hash) VALUES (?, ?, 'high', ?)`,
      ["src/foo.ts", "matching hash — still fresh", h]);
    db.run(`INSERT INTO known_gotchas (file_path, description, severity, content_hash) VALUES (?, ?, 'critical', ?)`,
      ["src/foo.ts", "stale hash — file changed", "OLDHASH"]);
    db.run(`INSERT INTO known_gotchas (file_path, description, severity, content_hash) VALUES (?, ?, 'medium', NULL)`,
      ["src/foo.ts", "no hash — untracked"]);
    flushDb(db);

    // Change the file → the previously matching gotcha now has a stale hash
    writeFile("src/foo.ts", "export const a = 2;\n");

    const { resolved } = await resolveGotchasForScope("foo");
    expect(resolved).toBe(2); // matching-hash gotcha + stale-hash gotcha

    const stmt = db.prepare(`SELECT description, status FROM known_gotchas ORDER BY id`);
    const rows: Array<{ description: string; status: string }> = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();

    const byDesc = Object.fromEntries(rows.map((r) => [r.description, r.status]));
    expect(byDesc["matching hash — still fresh"]).toBe("resolved");
    expect(byDesc["stale hash — file changed"]).toBe("resolved");
    expect(byDesc["no hash — untracked"]).toBe("active"); // untouched
  });

  test("no-op when no files match the scope", async () => {
    await ensureSchema();
    const { resolved } = await resolveGotchasForScope("definitely-not-a-scope");
    expect(resolved).toBe(0);
  });
});

// ============================================================
// I2 — COMMAND-TRIGGER GOTCHAS
// ============================================================

describe("getActiveGotchasForCommand (I2)", () => {
  beforeEach(async () => {
    const db = await getDb();
    db.run("DELETE FROM known_gotchas");
    flushDb(db);
  });

  test("matches trigger_command against the running command (case-insensitive)", async () => {
    await ensureSchema();
    const db = await getDb();
    db.run(`INSERT INTO known_gotchas (file_path, description, severity, trigger_command) VALUES (?, ?, 'high', ?)`,
      ["scripts/seed.ts", "seed wipes prod DB — use --dry-run first", "npm run seed"]);
    db.run(`INSERT INTO known_gotchas (file_path, description, severity, trigger_command, status) VALUES (?, ?, 'medium', ?, 'resolved')`,
      ["scripts/migrate.ts", "resolved — no longer relevant", "npm run migrate"]);
    flushDb(db);

    const hit = await getActiveGotchasForCommand("pnpm run seed -- --env=staging");
    expect(hit.length).toBe(1);
    expect(hit[0].description).toContain("seed wipes prod DB");

    // resolved gotchas never match
    const miss = await getActiveGotchasForCommand("npm run migrate");
    expect(miss.length).toBe(0);

    // unrelated command → no match
    expect((await getActiveGotchasForCommand("npm run build")).length).toBe(0);
  });
});

// ============================================================
// I4 — INJECTION METRICS
// ============================================================

describe("recordInjection (I4)", () => {
  test("appends to the JSONL injection log (no shared-DB race)", async () => {
    await recordInjection({ filePath: "src/auth.ts", kind: "edit" });
    await recordInjection({ command: "npm run seed", kind: "command" });

    const logFile = path.join(tmpRoot, ".kuma", "injections.jsonl");
    expect(fs.existsSync(logFile)).toBe(true);
    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    expect(first.filePath).toBe("src/auth.ts");
    expect(first.savedMs).toBeGreaterThan(0);
  });
});

// ============================================================
// I3 — LOOP AUTO-CAPTURE
// ============================================================

describe("trackFileEditLoop (I3)", () => {
  test("counts edits and auto-records a gotcha at the threshold", async () => {
    await ensureSchema();
    const fp = "src/flaky.ts";
    writeFile(fp, "export const x = 1;\n");

    const c1 = await trackFileEditLoop(fp);
    const c2 = await trackFileEditLoop(fp);
    const c3 = await trackFileEditLoop(fp);
    const c4 = await trackFileEditLoop(fp);
    expect(c1).toBe(1);
    expect(c4).toBe(4); // threshold crossed

    const db = await getDb();
    const res = db.exec(`SELECT description FROM known_gotchas WHERE file_path = ?`, [fp]);
    const gotchas = res[0]?.values?.map((v) => String(v[0])) ?? [];
    expect(gotchas.some((g) => g.includes("fragile area, rework likely"))).toBe(true);

    // No duplicate on the 5th call (gotchaRecorded flag)
    await trackFileEditLoop(fp);
    const res2 = db.exec(`SELECT COUNT(*) FROM known_gotchas WHERE file_path = ?`, [fp]);
    expect(Number(res2[0].values[0][0])).toBe(1);
  });
});

// ============================================================
// I8 — FLOW DERIVED CACHE (re-derive via imports)
// ============================================================

describe("deriveHopsFromImports (I8)", () => {
  test("builds hops by following import statements", () => {
    writeFile("src/flow/a.ts", 'import { b } from "./b";\nimport { c } from "./c";\nexport const a = [b, c];\n');
    writeFile("src/flow/b.ts", "export const b = 1;\n");
    writeFile("src/flow/c.ts", "export const c = 2;\n");

    const hops = deriveHopsFromImports("src/flow/a.ts");
    expect(hops.length).toBe(2);
    const targets = hops.map((h) => h.to).sort();
    expect(targets).toEqual(["b.ts", "c.ts"]);
    expect(hops[0].from).toBe("a.ts");
    expect(hops[0].relation).toBe("imports");
  });

  test("returns [] for a file with no imports", () => {
    writeFile("src/flow/solo.ts", "export const solo = 1;\n");
    expect(deriveHopsFromImports("src/flow/solo.ts")).toEqual([]);
  });

  test("returns [] for a missing file", () => {
    expect(deriveHopsFromImports("src/flow/missing.ts")).toEqual([]);
  });
});
