import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ============================================================
// KUMA MCP SERVER — Model Context Protocol for Kuma Dashboard
// ============================================================
//
// Tools: kuma_dashboard, kuma_gotchas, kuma_graph, kuma_health
// Communicates over stdio JSON-RPC.
//

function findKumaDb(startDir?: string): string | null {
  let current = startDir ? resolve(startDir) : process.cwd();
  for (let i = 0; i < 20; i++) {
    const candidate = join(current, ".kuma", "kuma.db");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function queryKuma(sql: string): string {
  const dbPath = findKumaDb();
  if (!dbPath) {
    throw new Error("No `.kuma/kuma.db` found in project tree.");
  }
  return execSync(`sqlite3 "${dbPath}" "${sql}"`, {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    timeout: 5000,
  }).trim();
}

const server = new McpServer({ name: "kuma-dashboard", version: "0.1.0" });

// Tool: kuma_dashboard
server.registerTool(
  "kuma_dashboard",
  { description: "Show Kuma dashboard — knowledge graph stats, gotcha count, health score" },
  async () => {
    try {
      const data = queryKuma(
        "SELECT json_object(" +
        "'node_count', (SELECT COUNT(*) FROM nodes), " +
        "'edge_count', (SELECT COUNT(*) FROM edges), " +
        "'gotcha_count', (SELECT COUNT(*) FROM known_gotchas), " +
        "'trajectory_count', (SELECT COUNT(*) FROM trajectories), " +
        "'skill_count', (SELECT COUNT(*) FROM distilled_skills), " +
        "'health_score', COALESCE((SELECT score FROM health_snapshots ORDER BY created_at DESC LIMIT 1), 0)" +
        ")"
      );
      return { content: [{ type: "text" as const, text: `📊 **Kuma Dashboard**\n\n\`\`\`json\n${data}\n\`\`\`` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// Tool: kuma_gotchas
server.registerTool(
  "kuma_gotchas",
  {
    description: "Show known gotchas with optional severity filter",
    inputSchema: fromJsonSchema({
      type: "object",
      properties: {
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Filter by severity" },
      },
      required: [],
    }),
  },
  async (args: any) => {
    try {
      const where = args.severity ? `WHERE severity = '${args.severity}'` : "";
      const data = queryKuma(
        `SELECT json_group_array(json_object('id',id,'file_path',file_path,'description',description,'severity',severity,'workaround',workaround)) FROM known_gotchas ${where} ORDER BY severity DESC`
      );
      return { content: [{ type: "text" as const, text: `⚠️ **Gotchas**\n\n\`\`\`json\n${data}\n\`\`\`` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// Tool: kuma_graph
server.registerTool(
  "kuma_graph",
  {
    description: "Show knowledge graph nodes with Mermaid diagram",
    inputSchema: fromJsonSchema({
      type: "object",
      properties: {
        maxNodes: { type: "number", minimum: 1, maximum: 50, description: "Max nodes (default 20)" },
      },
      required: [],
    }),
  },
  async (args: any) => {
    try {
      const limit = Math.min(args.maxNodes ?? 20, 50);
      const nodes = queryKuma(
        `      SELECT json_group_array(json_object('id',id,'name',name,'type',type)) FROM (SELECT id,name,type FROM nodes ORDER BY created_at DESC LIMIT ${limit})`
      );
      const parsed = JSON.parse(nodes) as Array<{ id: string; name: string; type: string }>;
      const lines = ["```mermaid", "flowchart TD"];
      if (parsed.length === 0) {
        lines.push("  Start[Empty Graph — No nodes found]");
      } else {
        for (const n of parsed) {
          if (!n || !n.name) continue;
          const safe = n.name.replace(/[^a-zA-Z0-9_]/g, "_");
          lines.push(`  n${n.id}${n.type === "function" || n.type === "class" ? `[${safe}]` : `(${safe})`}`);
        }
      }
      lines.push("```");
      return { content: [{ type: "text" as const, text: `🔗 **Knowledge Graph**\n\n${lines.join("\n")}\n\n\`\`\`json\n${nodes}\n\`\`\`` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// Tool: kuma_health
server.registerTool(
  "kuma_health",
  { description: "Show project health score history" },
  async () => {
    try {
      const data = queryKuma(
        "SELECT json_group_array(json_object('score',score,'summary',summary,'risk_level',risk_level,'created_at',created_at)) FROM health_snapshots ORDER BY created_at DESC LIMIT 5"
      );
      return { content: [{ type: "text" as const, text: `🏥 **Health**\n\n\`\`\`json\n${data}\n\`\`\`` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

async function main() {
  console.error("🏥 Kuma MCP Server starting...");
  const dbPath = findKumaDb();
  if (dbPath) {
    console.error(`✅ Found .kuma/kuma.db at: ${dbPath}`);
  } else {
    console.error("⚠️ No .kuma/kuma.db found. Tools will show errors until DB is found.");
  }
  await serveStdio(() => server);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
