import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDashboardData, findKumaDb } from "./db.js";

import fs from "node:fs";

const api = new Hono();
api.use("/*", cors());

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

/** GET /api/dashboard — all dashboard data */
api.get("/dashboard", (c) => {
  try {
    const data = getDashboardData();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** POST /api/reset-db — clear kuma.db database */
api.post("/reset-db", (c) => {
  try {
    const dbPath = findKumaDb();
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    return c.json({ ok: true, message: "Kuma DB reset successfully" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/** POST /api/stop-server — shut down studio server */
api.post("/stop-server", (c) => {
  setTimeout(() => process.exit(0), 500);
  return c.json({ ok: true, message: "Kuma Studio server shutting down" });
});

export default api;
