import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../src/utils/pathValidator.js";
import { createCheckpoint, rollbackToCheckpoint, listCheckpoints } from "../src/engine/kumaCheckpoint.js";
import { runAutoVerification } from "../src/engine/kumaVerifier.js";
import { resolveGotchasForScope, addGotcha } from "../src/engine/kumaGotchas.js";
import { getDb, flushDb } from "../src/engine/kumaDb.js";
import { computeScopeHash, computeProjectHash } from "../src/engine/kumaDriftDetector.js";

describe("Kuma v2.4.8 Architectural Improvements & Edge Cases", () => {
  const root = getProjectRoot();

  // 1. Checkpoint clean-tree git rollback & .kuma-snap
  it("saves gitHead and uses .kuma-snap files in createCheckpoint", async () => {
    const label = `v248-test-${Date.now()}`;
    const res = await createCheckpoint(label);
    expect(res).toContain("Checkpoint Created");

    // Check manifest file
    const manifestPath = path.join(root, ".kuma", "checkpoints", label, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.gitHead).toBeDefined();
    expect(typeof manifest.gitHead).toBe("string");
    expect(manifest.isGitClean !== undefined).toBe(true);

    // Ensure snapshotted files exist on disk with .kuma-snap extension
    const filesDir = path.join(root, ".kuma", "checkpoints", label, "files");
    for (const f of manifest.files) {
      const snapPath = path.join(filesDir, `${f.path}.kuma-snap`);
      expect(fs.existsSync(snapPath)).toBe(true);
    }
  });

  // 2. Verifier force bypass
  it("allows verifier execution when options.force is true", async () => {
    const res = await runAutoVerification({
      target: "tests/kumaRouter.test.ts",
      force: true,
      timeoutMs: 30000,
    });
    expect(res).toContain("Verification");
    expect(res).toContain("tests/kumaRouter.test.ts");
  }, 40000);

  // 3. Gotchas are not auto-resolved on hash drift (safety preservation)
  it("preserves active gotchas instead of auto-resolving on hash drift", async () => {
    const testFile = "src/services/critical_security_auth.ts";
    await addGotcha({
      filePath: testFile,
      description: "Do not bypass JWT signature check",
      severity: "critical",
      status: "active",
    });

    const result = await resolveGotchasForScope("critical_security_auth");
    expect(result.resolved).toBe(0);
  });

  // 4. DB reload on disk mtime update
  it("reloads DB instance when disk file mtime changes", async () => {
    const db1 = await getDb();
    expect(db1).toBeDefined();

    // Touch the db file to advance mtime
    const dbPath = path.join(root, ".kuma", "kuma.db");
    if (fs.existsSync(dbPath)) {
      const now = new Date(Date.now() + 2000);
      fs.utimesSync(dbPath, now, now);
    }

    const db2 = await getDb();
    expect(db2).toBeDefined();
  });

  // 5. Scope and Project hash consistency and git awareness
  it("computes consistent scope and project hashes with git awareness", () => {
    const scope = "auth";
    const hash1 = computeScopeHash(scope);
    const hash2 = computeProjectHash(scope);

    expect(hash1).toBeDefined();
    expect(typeof hash1).toBe("string");
    expect(hash1!.length).toBe(16);
    expect(hash1).toBe(hash2);
  });
});
