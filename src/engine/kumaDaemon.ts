// ============================================================
// KUMA DAEMON — Issue #38 (scheduled sensors outside task lifecycle)
// ============================================================
// Persistent per-workspace service: every INTERVAL it runs the continuous
// sensors (incremental map sync, brief refresh, drift scan) and writes a
// status report to .kuma/daemon-status.json. Managed via:
//   kuma daemon start [--interval-ms N] | stop | status
// Design: single detached node process + pid file. Second `start` is a
// no-op when alive (no duplicate daemons). All work is read-mostly;
// the only write is the status JSON + normal graph sync.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";

const PID_FILE = ".kuma/daemon.pid";
const STATUS_FILE = ".kuma/daemon-status.json";
const LOG_FILE = ".kuma/daemon.log";

export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  lastRunAt: number | null;
  lastResult: string | null;
  intervalMs: number;
}

function paths(root?: string): { pid: string; status: string; log: string } {
  const r = root || getProjectRoot();
  return {
    pid: path.join(r, PID_FILE),
    status: path.join(r, STATUS_FILE),
    log: path.join(r, LOG_FILE),
  };
}

function readPid(root?: string): number | null {
  try {
    const fp = paths(root).pid;
    if (!fs.existsSync(fp)) return null;
    const pid = Number(fs.readFileSync(fp, "utf-8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The sensor tick: map sync + briefs + drift scan → status JSON. */
export async function daemonTick(root?: string): Promise<string> {
  const r = root || getProjectRoot();
  const p = paths(r);
  const notes: string[] = [];
  // Issue #42: backbone first — daemon start on an empty map builds edges
  // from second zero instead of leaving cold start empty.
  try {
    const { ensureBackbone, formatBackbone } = await import("./mapBackbone.js");
    const bb = await ensureBackbone();
    if (bb) notes.push(formatBackbone(bb));
  } catch {}
  try {
    const { syncModifiedFiles } = await import("./kumaCodeScanner.js");
    const scan = await syncModifiedFiles(50);
    notes.push(`map: ${scan.filesScanned}f/${scan.nodeCount}n/${scan.edgeCount}e`);
  } catch (err) {
    notes.push(`map: skipped (${err})`);
  }
  try {
    const { refreshPackageBriefs } = await import("./packageBriefs.js");
    const { count } = await refreshPackageBriefs();
    notes.push(`briefs: ${count}`);
  } catch {
    notes.push("briefs: skipped");
  }
  try {
    const { detectDrift } = await import("./kumaDriftDetector.js");
    const records = await detectDrift();
    const stale = records.filter((x) => x.severity === "stale" || x.severity === "missing").length;
    notes.push(`drift: ${stale}/${records.length} stale`);
  } catch {
    notes.push("drift: skipped");
  }
  try {
    const { clearDirty } = await import("./cacheFreshness.js");
    clearDirty();
  } catch {}
  const status = {
    lastRunAt: Date.now(),
    lastResult: notes.join(" · "),
  };
  try {
    let prev: Record<string, unknown> = {};
    if (fs.existsSync(p.status)) prev = JSON.parse(fs.readFileSync(p.status, "utf-8"));
    fs.writeFileSync(p.status, JSON.stringify({ ...prev, ...status }, null, 2), "utf-8");
  } catch {}
  return notes.join(" · ");
}

async function runLoop(intervalMs: number): Promise<never> {
  const r = getProjectRoot();
  const p = paths(r);
  const log = (msg: string): void => {
    try {
      fs.appendFileSync(p.log, `${new Date().toISOString()} ${msg}\n`, "utf-8");
    } catch {}
  };
  log(`daemon started (interval ${intervalMs}ms)`);
  for (;;) {
    try {
      const res = await daemonTick(r);
      log(`tick: ${res}`);
    } catch (err) {
      log(`tick failed: ${err}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Start the daemon (no-op when already alive). Returns human message. */
export async function daemonStart(intervalMs = DEFAULT_INTERVAL_MS, root?: string): Promise<string> {
  const r = root || getProjectRoot();
  const p = paths(r);
  const existing = readPid(r);
  if (existing && isAlive(existing)) {
    return `🐻 Daemon already running (pid ${existing}). Use \`kuma daemon stop\` first.`;
  }
  const entry = process.argv[1];
  const child = spawn(process.execPath, [entry, "daemon", "run", String(intervalMs)], {
    cwd: r,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  try {
    fs.writeFileSync(p.pid, String(child.pid), "utf-8");
    fs.writeFileSync(
      p.status,
      JSON.stringify({ running: true, pid: child.pid, startedAt: Date.now(), lastRunAt: null, lastResult: null, intervalMs }, null, 2),
      "utf-8",
    );
  } catch {}
  return `🐻 Daemon started (pid ${child.pid}, every ${Math.round(intervalMs / 60000)}m). Status: .kuma/daemon-status.json`;
}

/** Stop the daemon. Returns human message. */
export async function daemonStop(root?: string): Promise<string> {
  const r = root || getProjectRoot();
  const p = paths(r);
  const pid = readPid(r);
  if (!pid) return "🐻 Daemon not running (no pid file).";
  if (!isAlive(pid)) {
    try { fs.rmSync(p.pid, { force: true }); } catch {}
    return "🐻 Daemon pid file was stale — cleaned up (process already gone).";
  }
  try {
    process.kill(pid, "SIGTERM");
    try { fs.rmSync(p.pid, { force: true }); } catch {}
    return `🐻 Daemon stopped (was pid ${pid}).`;
  } catch (err) {
    return `🐻 Could not stop daemon pid ${pid}: ${err}`;
  }
}

/** Daemon status (human message). */
export async function daemonStatus(root?: string): Promise<string> {
  const r = root || getProjectRoot();
  const p = paths(r);
  const pid = readPid(r);
  let status: DaemonStatus = { running: false, pid: null, startedAt: null, lastRunAt: null, lastResult: null, intervalMs: DEFAULT_INTERVAL_MS };
  try {
    if (fs.existsSync(p.status)) status = { ...status, ...JSON.parse(fs.readFileSync(p.status, "utf-8")) };
  } catch {}
  const alive = pid !== null && isAlive(pid);
  status.running = alive;
  status.pid = alive ? pid : null;
  if (!alive) {
    return `🐻 Daemon: stopped.${status.lastRunAt ? ` Last tick ${new Date(status.lastRunAt).toISOString()}: ${status.lastResult || "n/a"}` : " Never ran."} Start with \`kuma daemon start\`.`;
  }
  return `🐻 Daemon: running (pid ${pid}).${status.lastRunAt ? ` Last tick ${new Date(status.lastRunAt).toISOString()}: ${status.lastResult || "n/a"}` : " Warming up…"}`;
}

/** Entry for the detached child: `kuma daemon run <intervalMs>`. */
export async function daemonRunChild(intervalMs: number): Promise<void> {
  const ms = Number.isFinite(intervalMs) && intervalMs >= 30_000 ? intervalMs : DEFAULT_INTERVAL_MS;
  await runLoop(ms);
}
