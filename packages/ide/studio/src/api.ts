import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDashboardData, findKumaDb } from "./db.js";

const api = new Hono();
api.use("/*", cors());

/** GET /api/status — check if DB exists */
api.get("/status", (c) => {
  const dbPath = findKumaDb();
  return c.json({
    ok: !!dbPath,
    dbPath,
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

export default api;
