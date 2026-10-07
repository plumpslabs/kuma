// ============================================================
// NO-ORPHAN GUARANTEE — every node has a thread, every edge lands
// ============================================================

import { addEdge, pruneOrphans, recordDomainFlow } from "../src/engine/kumaGraph.js";
import { getDb } from "../src/engine/kumaDb.js";

const TAG = `noorphan-${Date.now()}`;

async function countOrphans(): Promise<number> {
  const db = await getDb();
  const s = db.prepare(
    `SELECT COUNT(*) as c FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)`
  );
  s.step();
  const n = Number((s.getAsObject() as { c: number }).c) || 0;
  s.free();
  return n;
}

describe("no-orphan guarantee", () => {
  test("dangling edges + edgeless map nodes are pruned (knowledge untouched)", async () => {
    const ghostFile = `file::${TAG}/ghost.ts`;
    const ghostFn = `function::${TAG}/ghost.ts::ghostFn`;
    // Insert DIRECTLY (bypassing upsertNode's auto-link) to simulate legacy
    // rows written before the no-orphan guarantee existed.
    const db = await getDb();
    const old = Math.floor(Date.now() / 1000) - 7200;
    db.run(`INSERT INTO nodes (id, type, name, file_path, metadata, updated_at) VALUES (?, 'file', ?, ?, '{}', ?)`, [ghostFile, `${TAG}/ghost.ts`, `${TAG}/ghost.ts`, old]);
    db.run(`INSERT INTO nodes (id, type, name, file_path, metadata, updated_at) VALUES (?, 'function', 'ghostFn', ?, '{}', ?)`, [ghostFn, `${TAG}/ghost.ts`, old]);
    // Dangling: target was never created.
    await addEdge({ sourceId: ghostFile, targetId: `function::${TAG}/nowhere.ts::nope`, type: "calls" });

    // dryRun first: reports without touching. (ghostFile itself is NOT
    // orphan — its dangling edge still counts as a thread for the source;
    // only ghostFn is edgeless. The dangling edge is reported separately.)
    const dry = await pruneOrphans({ olderThanSec: -1, dryRun: true });
    expect(dry.orphanNodes).toBeGreaterThanOrEqual(1);
    expect(dry.danglingEdges).toBeGreaterThanOrEqual(1);

    // Age-gate: a FRESH orphan survives (in-flight write protection).
    const freshId = `file::${TAG}/fresh.ts`;
    db.run(`INSERT INTO nodes (id, type, name, file_path, metadata, updated_at) VALUES (?, 'file', ?, ?, '{}', strftime('%s','now'))`, [freshId, `${TAG}/fresh.ts`, `${TAG}/fresh.ts`]);
    await pruneOrphans({ olderThanSec: 3600 });
    const chk = db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE id = ?`);
    chk.bind([freshId]);
    chk.step();
    const stillThere = Number((chk.getAsObject() as { c: number }).c) || 0;
    chk.free();
    expect(stillThere).toBe(1);

    // Aged-out: orphans removed. (Dangling edges carry no age gate — an
    // edge to nowhere is never in-flight — so the gate prune above already
    // took them; this run must find none left.)
    const aged = await pruneOrphans({ olderThanSec: -1 });
    expect(aged.orphanNodes).toBeGreaterThanOrEqual(1);
    expect(aged.danglingEdges).toBe(0);

    // Fixtures gone, pre-existing orphans untouched by THIS test's count math.
    const db2 = await getDb();
    const s = db2.prepare(`SELECT COUNT(*) as c FROM nodes WHERE id LIKE ?`);
    s.bind([`%${TAG}%`]);
    s.step();
    const left = Number((s.getAsObject() as { c: number }).c) || 0;
    s.free();
    expect(left).toBe(0);
  });

  test("empty-hop domain flow refuses instead of orphaning an anchor", async () => {
    const res = await recordDomainFlow({ domain: `${TAG}-empty`, hops: [] });
    expect(res).toEqual({ nodeCount: 0, edgeCount: 0 });
    const db = await getDb();
    const s = db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE id = ?`);
    s.bind([`feature_domain::${TAG}-empty`]);
    s.step();
    const n = Number((s.getAsObject() as { c: number }).c) || 0;
    s.free();
    expect(n).toBe(0);
  });

  test("global orphan count does not grow on prune (idempotent cure)", async () => {
    const before = await countOrphans();
    // Age out everything prunable, twice — second run must find nothing new.
    await pruneOrphans({ olderThanSec: -1 });
    const mid = await countOrphans();
    const again = await pruneOrphans({ olderThanSec: -1 });
    expect(again.orphanNodes).toBe(0);
    expect(again.danglingEdges).toBe(0);
    expect(mid).toBeLessThanOrEqual(before);
    expect(await countOrphans()).toBe(mid);
  });
});
