// ============================================================
// ISSUE #38 — Daemon mode (scheduled sensors outside task lifecycle)
// ============================================================

import { daemonStop, daemonStatus, daemonTick } from "../src/engine/kumaDaemon.js";

describe("issue #38 daemon", () => {
  test("stop with no daemon → honest no-op message", async () => {
    // Use a tmp root so the real dev pid file is never touched.
    const root = `/tmp/kuma-daemon-test-${Date.now()}`;
    const { default: fs } = await import("node:fs");
    fs.mkdirSync(`${root}/.kuma`, { recursive: true });
    expect(await daemonStop(root)).toContain("not running");
    expect(await daemonStatus(root)).toContain("stopped");
  });

  test("tick runs all three sensors and reports", async () => {
    const res = await daemonTick();
    expect(typeof res).toBe("string");
    expect(res).toContain("map:");
    expect(res).toContain("briefs:");
    expect(res).toContain("drift:");
  }, 120000);
});
