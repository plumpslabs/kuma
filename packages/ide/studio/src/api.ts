import { Hono } from "hono";
import { getDashboardData, getNodeDetail, findKumaDb } from "./db.js";

import fs from "node:fs";

const api = new Hono();

// ============================================================
// HARDENING (GAP 3): CORS restricted to localhost only.
// Any cross-origin page (e.g. a malicious website) that tries to
// reach localhost:3322 will be rejected unless it originates from
// localhost / 127.0.0.1. Destructive endpoints additionally
// require an explicit `?confirm=1` param.
// ============================================================

const LOCALHOST_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return false; // No Origin header → treat as non-browser (curl etc.) — allow, but confirm params still apply
  return LOCALHOST_ORIGINS.test(origin);
}

api.use("/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (origin && !isLocalhostOrigin(origin)) {
    return c.json({ error: "Forbidden: cross-origin requests are not allowed." }, 403);
  }
  // Only reflect CORS headers for localhost origins
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type");
  }
  await next();
});

/** Guard for destructive endpoints — require ?confirm=1.
 * Returns a Hono Response to short-circuit with, or null when allowed. */
function confirmGuard(c: any): Response | null {
  const confirm = c.req.query("confirm");
  if (confirm !== "1") {
    return c.json({ ok: false, error: "Confirmation required: pass ?confirm=1" }, 400);
  }
  return null;
}

/** GET /api/status — check if DB exists */
api.get("/status", (c) => {
  const dbPath = findKumaDb();
  let dbSize = "0 KB";
  if (dbPath && fs.existsSync(dbPath)) {
    const bytes = fs.statSync(dbPath).size;
    dbSize = bytes > 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(2) + " MB" : (bytes / 1024).toFixed(1) + " KB";
  }
  return c.json({
    ok: !!dbPath,
    dbPath,
    dbSize,
    project: dbPath ? dbPath.replace("/.kuma/kuma.db", "").split("/").pop() : null,
  });
});

/** GET /api/dashboard — all dashboard data (efficiency + staleness included) */
api.get("/dashboard", async (c) => {
  try {
    const data = await getDashboardData();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** GET /api/node/:id — full node detail (outgoing, incoming, gotchas) */
api.get("/node/:id", async (c) => {
  try {
    const nodeId = c.req.param("id");
    const detail = await getNodeDetail(nodeId);
    if (!detail) return c.json({ error: "Node not found" }, 404);
    return c.json(detail);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** POST /api/reset-db?confirm=1 — clear kuma.db database (requires confirmation) */
api.post("/reset-db", (c) => {
  const blocked = confirmGuard(c);
  if (blocked) return blocked;
  try {
    const dbPath = findKumaDb();
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    return c.json({ ok: true, message: "Kuma DB reset successfully" });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});

/** POST /api/stop-server?confirm=1 — shut down studio server (requires confirmation) */
api.post("/stop-server", (c) => {
  const blocked = confirmGuard(c);
  if (blocked) return blocked;
  setTimeout(() => process.exit(0), 500);
  return c.json({ ok: true, message: "Kuma Studio server shutting down" });
});

export default api;
