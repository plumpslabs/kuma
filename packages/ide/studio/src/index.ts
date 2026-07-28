#!/usr/bin/env bun
// ============================================================
// KUMA STUDIO — Web-Based Knowledge Graph Visualizer
// ============================================================
//
// Usage:  cd /your-project && bun run src/index.ts
//         → Opens browser at http://localhost:3322
//
// Features:
//  - Interactive knowledge graph (drag, zoom, click)
//  - Gotchas dashboard with severity colors
//  - Trajectory timeline
//  - Health score chart
//  - Auto-detect .kuma/kuma.db in project tree
//

import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import api from "./api.js";
import { findKumaDb } from "./db.js";

// CLI arg parsing
const args = process.argv.slice(2);
const PORT = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || '3322', 10);
const customDir = args.find((a) => a.startsWith('--dir='))?.split('=')[1];
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.error(`♢ Kuma Studio — Usage:
  bun run src/index.ts [options]

Options:
  --port=PORT   Server port (default: 3322)
  --dir=PATH    Project directory (default: auto-detect from cwd)
  --help, -h    Show this help
  `);
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// If custom dir is specified, change cwd
if (customDir) {
  process.chdir(customDir);
}

// Serve static HTML
import { Hono } from "hono";
const app = new Hono();
app.route("/api", api);

// Serve the frontend
const htmlPath = join(__dirname, "..", "public", "index.html");
let htmlCache: string | null = null;
try {
  htmlCache = readFileSync(htmlPath, "utf-8");
} catch {
  // Will be handled on request
}

app.get("/", (c) => {
  if (!htmlCache) {
    return c.text("index.html not found. Run from packages/ide/studio/", 500);
  }
  return c.html(htmlCache);
});

// Start server
serve({ fetch: app.fetch, port: PORT }, (info) => {
  const dbPath = findKumaDb();
  const projectName = dbPath
    ? dbPath.replace("/.kuma/kuma.db", "").split("/").pop()
    : "unknown";

  console.error(`♢ Kuma Studio`);
  console.error(`  Project: ${projectName}`);
  console.error(`  DB:      ${dbPath || "not found"}`);
  console.error(`  Server:  http://localhost:${PORT}`);
  console.error(``);

  // Auto-open browser
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true });
});
