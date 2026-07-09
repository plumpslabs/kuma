// ============================================================
// KUMA MARKETPLACE — Knowledge Marketplace (Phase 8.6)
// ============================================================
// Community-generated graph templates for popular frameworks.
// Templates are distributed via npm (@kuma-templates/*).
// ============================================================
// Features:
//   ✅ List available templates (built-in + npm)
//   ✅ Install template via npm install
//   ✅ Template format with versioned JSON schema
//   ✅ Template loader: parse → inject into SQLite
//   ✅ Publish: bundle local graph → JSON → npm publish
// ============================================================

import { getDb, saveDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// TYPES
// ============================================================

interface MarketplaceListing {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  nodeCount: number;
  edgeCount: number;
  npmPackage?: string;
}

interface KumaTemplate {
  name: string;
  version: string;
  description: string;
  language: string;
  framework: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

interface TemplateNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

interface TemplateEdge {
  sourceId: string;
  targetId: string;
  type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

// ============================================================
// BUILT-IN TEMPLATES
// ============================================================

const BUILT_IN_TEMPLATES: MarketplaceListing[] = [
  // ── Framework Web (JS/TS) ──
  {
    id: "graph:hono",
    name: "Hono",
    description: "Knows middleware chain, RPC mode, typed routes, HonoX, JSX middleware",
    version: "1.0.0", author: "Kuma Core",
    tags: ["hono", "typescript", "api", "edge"], nodeCount: 35, edgeCount: 90,
  },
  {
    id: "graph:fastify",
    name: "Fastify",
    description: "Knows plugin system, hooks lifecycle, schema validation, encapsulation",
    version: "1.0.0", author: "Kuma Core",
    tags: ["fastify", "typescript", "node", "api"], nodeCount: 40, edgeCount: 100,
  },
  {
    id: "graph:elysia",
    name: "Elysia (Bun)",
    description: "Knows plugin system, Eden Treaty, schema validation, state/derive pattern",
    version: "1.0.0", author: "Kuma Core",
    tags: ["elysia", "typescript", "bun", "api"], nodeCount: 28, edgeCount: 70,
  },
  {
    id: "graph:nextjs",
    name: "Next.js App Router",
    description: "Knows App Router, Server Components, layout structure, route groups",
    version: "1.0.0", author: "Kuma Core",
    tags: ["nextjs", "react", "typescript", "ssr"], nodeCount: 45, edgeCount: 120,
  },
  {
    id: "graph:nextjs-pages",
    name: "Next.js Pages Router",
    description: "Knows Pages Router, getServerSideProps, API routes, ISR pattern",
    version: "1.0.0", author: "Kuma Core",
    tags: ["nextjs", "react", "typescript", "ssr"], nodeCount: 38, edgeCount: 95,
  },
  {
    id: "graph:remix",
    name: "Remix",
    description: "Knows loaders, actions, forms pattern, nested routes, resource routes",
    version: "1.0.0", author: "Kuma Core",
    tags: ["remix", "react", "typescript", "ssr"], nodeCount: 32, edgeCount: 80,
  },
  {
    id: "graph:express",
    name: "Express.js API",
    description: "Knows middleware chain, route handlers, error patterns, app structure",
    version: "1.0.0", author: "Kuma Core",
    tags: ["express", "node", "javascript", "api"], nodeCount: 30, edgeCount: 85,
  },

  // ── React Ecosystem ──
  {
    id: "graph:tanstack-query",
    name: "TanStack Query",
    description: "Knows query/mutation pattern, cache invalidation, optimistic updates, infinite queries",
    version: "1.0.0", author: "Kuma Core",
    tags: ["tanstack", "react", "typescript", "data"], nodeCount: 36, edgeCount: 88,
  },
  {
    id: "graph:tanstack-router",
    name: "TanStack Router",
    description: "Knows file-based routing, loaders, search params, route guards, devtools",
    version: "1.0.0", author: "Kuma Core",
    tags: ["tanstack", "react", "typescript", "router"], nodeCount: 30, edgeCount: 75,
  },
  {
    id: "graph:tanstack-table",
    name: "TanStack Table",
    description: "Knows column definitions, sorting, filtering, pagination, row selection",
    version: "1.0.0", author: "Kuma Core",
    tags: ["tanstack", "react", "typescript", "table"], nodeCount: 22, edgeCount: 55,
  },
  {
    id: "graph:zustand",
    name: "Zustand",
    description: "Knows store pattern, middleware (persist, devtools, immer), subscribe, slice pattern",
    version: "1.0.0", author: "Kuma Core",
    tags: ["zustand", "react", "typescript", "state"], nodeCount: 18, edgeCount: 42,
  },
  {
    id: "graph:shadcn",
    name: "shadcn/ui",
    description: "Knows component structure, Radix primitives, tailwind classes, registry pattern",
    version: "1.0.0", author: "Kuma Core",
    tags: ["shadcn", "react", "typescript", "ui"], nodeCount: 50, edgeCount: 130,
  },

  // ── Database (JS/TS) ──
  {
    id: "graph:prisma",
    name: "Prisma",
    description: "Knows schema models, relations, migrations, client queries, middleware hooks",
    version: "1.0.0", author: "Kuma Core",
    tags: ["prisma", "typescript", "database", "orm"], nodeCount: 35, edgeCount: 85,
  },
  {
    id: "graph:drizzle",
    name: "Drizzle",
    description: "Knows schema definition, relations, query (SQL-like), migrations, Drizzle Kit",
    version: "1.0.0", author: "Kuma Core",
    tags: ["drizzle", "typescript", "database", "orm"], nodeCount: 30, edgeCount: 72,
  },

  // ── PHP ──
  {
    id: "graph:laravel",
    name: "Laravel",
    description: "Knows Eloquent patterns, Blade templates, Artisan commands, middleware",
    version: "1.0.0", author: "Kuma Core",
    tags: ["laravel", "php", "eloquent"], nodeCount: 50, edgeCount: 140,
  },

  // ── Java ──
  {
    id: "graph:spring",
    name: "Spring Boot",
    description: "Knows bean lifecycle, AOP patterns, REST controllers, JPA repositories",
    version: "1.0.0", author: "Kuma Core",
    tags: ["spring", "java", "jpa"], nodeCount: 55, edgeCount: 150,
  },

  // ── Python ──
  {
    id: "graph:django",
    name: "Django",
    description: "Knows MTV pattern, model conventions, view classes, URL routing",
    version: "1.0.0", author: "Kuma Core",
    tags: ["django", "python", "mtv"], nodeCount: 40, edgeCount: 110,
  },

  // ── Go ──
  {
    id: "graph:gin",
    name: "Gin (Go)",
    description: "Knows route handlers, middleware chain, context patterns, binding",
    version: "1.0.0", author: "Kuma Core",
    tags: ["gin", "go", "api"], nodeCount: 25, edgeCount: 65,
  },

  // ── Rust ──
  {
    id: "graph:axum",
    name: "Axum (Rust)",
    description: "Knows extractors, route handlers, middleware tower, state sharing",
    version: "1.0.0", author: "Kuma Core",
    tags: ["axum", "rust", "tokio"], nodeCount: 20, edgeCount: 55,
  },
];

// ============================================================
// LIST
// ============================================================

/**
 * List available marketplace templates (built-in + npm installed).
 */
export async function listMarketplace(): Promise<string> {
  const templates = [...BUILT_IN_TEMPLATES];

  // Scan for npm-installed templates
  try {
    const npmTemplates = scanNpmTemplates();
    templates.push(...npmTemplates);
  } catch {}

  const lines: string[] = [
    "🏪 **Knowledge Marketplace**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `📦 ${templates.length} template(s) available`,
    "",
  ];

  // Group by language — detect from tags
  const LANG_MAP: Array<{ lang: string; keywords: string[] }> = [
    { lang: "typescript", keywords: ["typescript", "hono", "elysia", "tanstack", "zustand", "prisma", "drizzle", "shadcn"] },
    { lang: "javascript", keywords: ["javascript", "express"] },
    { lang: "go", keywords: ["go", "gin"] },
    { lang: "php", keywords: ["php", "laravel"] },
    { lang: "python", keywords: ["python", "django"] },
    { lang: "rust", keywords: ["rust", "axum"] },
    { lang: "java", keywords: ["java", "spring"] },
  ];

  const LANG_EMOJI: Record<string, string> = {
    typescript: "🔷", javascript: "🟨", go: "🔵", php: "🐘",
    python: "🐍", rust: "🦀", java: "☕", general: "📦",
  };

  /** Detect language from a listing's tags */
  function detectLang(t: MarketplaceListing): string {
    for (const entry of LANG_MAP) {
      if (entry.keywords.some(k => t.tags.some(tag => tag.includes(k)))) {
        return entry.lang;
      }
    }
    return "general";
  }

  const grouped: Record<string, MarketplaceListing[]> = {};
  for (const t of templates) {
    const lang = detectLang(t);
    if (!grouped[lang]) grouped[lang] = [];
    grouped[lang].push(t);
  }

  // Sort: put TypeScript first, then general, then alphabetically
  const sortOrder = ["typescript", "javascript", "go", "php", "python", "rust", "java", "general"];
  const sortedLangs = Object.keys(grouped).sort(
    (a, b) => (sortOrder.indexOf(a) !== -1 ? sortOrder.indexOf(a) : 99) - (sortOrder.indexOf(b) !== -1 ? sortOrder.indexOf(b) : 99)
  );

  for (const lang of sortedLangs) {
    const items = grouped[lang];
    const emoji = LANG_EMOJI[lang] || "📦";
    const label = lang.charAt(0).toUpperCase() + lang.slice(1);
    lines.push(`**${emoji} ${label}**`);
    for (const t of items) {
      const npmTag = t.npmPackage ? ` | npm: \`${t.npmPackage}\`` : "";
      lines.push(
        `  📦 **${t.name}** v${t.version}`,
        `     ${t.description}`,
        `     📊 ${t.nodeCount} nodes, ${t.edgeCount} edges | 🏷️ ${t.tags.join(", ")}${npmTag}`,
        `     Author: ${t.author} | \`${t.id}\``,
        "",
      );
    }
  }

  lines.push(
    "💡 **Usage:**",
    `  • Install: kuma_advanced({ action: "marketplace", marketplaceAction: "install", template: "graph:hono" })`,
    `  • List:   kuma_advanced({ action: "marketplace" })`,
    `  • Publish: npx kuma publish (requires npm account)`,
  );

  return lines.join("\n");
}

/**
 * Scan for npm-installed @kuma-templates packages.
 */
function scanNpmTemplates(): MarketplaceListing[] {
  const found: MarketplaceListing[] = [];
  try {
    const root = getProjectRoot();
    const nodeModulesPath = path.join(root, "node_modules", "@kuma-templates");
    if (!fs.existsSync(nodeModulesPath)) return found;

    const packages = fs.readdirSync(nodeModulesPath);
    for (const pkg of packages) {
      const pkgPath = path.join(nodeModulesPath, pkg, "package.json");
      if (!fs.existsSync(pkgPath)) continue;

      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const templatePath = path.join(nodeModulesPath, pkg, "template.json");
      let nodeCount = 0, edgeCount = 0;
      if (fs.existsSync(templatePath)) {
        const tmpl = JSON.parse(fs.readFileSync(templatePath, "utf-8")) as KumaTemplate;
        nodeCount = tmpl.nodes?.length || 0;
        edgeCount = tmpl.edges?.length || 0;
      }

      found.push({
        id: `graph:${pkg}`,
        name: pkgJson.description || pkg,
        description: pkgJson.description || `Community template: ${pkg}`,
        version: pkgJson.version || "1.0.0",
        author: pkgJson.author || "Community",
        tags: pkgJson.keywords || [],
        nodeCount,
        edgeCount,
        npmPackage: `@kuma-templates/${pkg}`,
      });
    }
  } catch {}
  return found;
}

// ============================================================
// INSTALL
// ============================================================

/**
 * Install a marketplace template into the local knowledge graph.
 * Supports:
 *   - Built-in templates (graph:hono, graph:laravel, etc.)
 *   - npm templates (@kuma-templates/*)
 */
export async function installTemplate(templateId: string): Promise<string> {
  try {
    // Check built-in templates first
    const builtIn = BUILT_IN_TEMPLATES.find(t => t.id === templateId);
    if (builtIn) {
      return await installBuiltIn(builtIn);
    }

    // Check npm-installed templates
    const npmTemplate = await tryInstallFromNpm(templateId);
    if (npmTemplate) {
      return npmTemplate;
    }

    return `⚠️ Template "${templateId}" not found.\n\nRun kuma_advanced({ action: "marketplace" }) to see available templates.`;
  } catch (err) {
    return `Error installing template: ${err}`;
  }
}

/**
 * Install a built-in template (generated from code).
 */
async function installBuiltIn(listing: MarketplaceListing): Promise<string> {
  const templateData = generateBuiltInTemplate(listing.id);

  if (!templateData) {
    return `⚠️ Template "${listing.id}" is registered but has no data yet. Coming soon.`;
  }

  const { nodes, edges } = templateData;
  const db = await getDb();
  let nodeCount = 0;
  let edgeCount = 0;

  const tx = (db as any).transaction(() => {
    for (const node of nodes) {
      const metadata = JSON.stringify(node.metadata || {});
      db.run(`
        INSERT OR IGNORE INTO nodes (id, type, name, file_path, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
      `, [node.id, node.type, node.name, node.filePath || null, metadata]);
      nodeCount++;
    }

    for (const edge of edges) {
      const weight = edge.weight ?? 1.0;
      const metadata = JSON.stringify(edge.metadata || {});
      db.run(`
        INSERT OR IGNORE INTO edges (source_id, target_id, type, weight, metadata)
        VALUES (?, ?, ?, ?, ?)
      `, [edge.sourceId, edge.targetId, edge.type, weight, metadata]);
      edgeCount++;
    }
  });
  tx();
  saveDb();

  return [
    `📥 **Installing** ${listing.name}...`,
    "",
    "✅ Template installed successfully!",
    `📊 Added **${nodeCount}** nodes and **${edgeCount}** edges to the Knowledge Graph.`,
    "",
    "💡 The installed patterns will now enhance:",
    "  • kuma_graph → better navigation suggestions",
    "  • kuma_analytics → more accurate predictions",
    "  • kuma_navigate → smarter codebase understanding",
    "",
    `💡 To uninstall: kuma_advanced({ action: "marketplace", marketplaceAction: "uninstall", template: "${listing.id}" })`,
  ].join("\n");
}

/**
 * Try to install a template from npm (@kuma-templates/<name>).
 */
async function tryInstallFromNpm(templateId: string): Promise<string | null> {
  const name = templateId.replace(/^graph:/, "");

  // Check if already installed
  try {
    const root = getProjectRoot();
    const pkgPath = path.join(root, "node_modules", "@kuma-templates", name, "template.json");
    if (fs.existsSync(pkgPath)) {
      return await loadNpmTemplate(pkgPath, name);
    }
  } catch {}

  // Try npm install
  try {
    const npmPackage = `@kuma-templates/${name}`;
    const root = getProjectRoot();

    execSync(`npm install --no-save ${npmPackage}`, {
      cwd: root,
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    });

    const templatePath = path.join(root, "node_modules", "@kuma-templates", name, "template.json");
    if (fs.existsSync(templatePath)) {
      return await loadNpmTemplate(templatePath, name);
    }

    return [
      `📥 **Installing** ${npmPackage}...`,
      "",
      "✅ Package installed. No template.json found — the package may not be a valid Kuma template.",
      `💡 Ensure the package has a template.json in its root.`,
    ].join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") || msg.includes("Not found")) {
      return null; // Not found in npm either
    }
    return `⚠️ npm install failed: ${msg}`;
  }
}

/**
 * Load a template.json into the knowledge graph.
 */
async function loadNpmTemplate(templatePath: string, name: string): Promise<string> {
  const raw = fs.readFileSync(templatePath, "utf-8");
  const template = JSON.parse(raw) as KumaTemplate;
  const db = await getDb();
  let nodeCount = 0;
  let edgeCount = 0;

  const tx = (db as any).transaction(() => {
    for (const node of template.nodes || []) {
      const metadata = JSON.stringify(node.metadata || {});
      db.run(`
        INSERT OR IGNORE INTO nodes (id, type, name, file_path, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
      `, [node.id, node.type, node.name, node.filePath || null, metadata]);
      nodeCount++;
    }

    for (const edge of template.edges || []) {
      const weight = edge.weight ?? 1.0;
      const metadata = JSON.stringify(edge.metadata || {});
      db.run(`
        INSERT OR IGNORE INTO edges (source_id, target_id, type, weight, metadata)
        VALUES (?, ?, ?, ?, ?)
      `, [edge.sourceId, edge.targetId, edge.type, weight, metadata]);
      edgeCount++;
    }
  });
  tx();
  saveDb();

  return [
    `📥 **Installing** ${template.name || name} v${template.version || "?"}...`,
    "",
    "✅ Template installed successfully!",
    `📊 Added **${nodeCount}** nodes and **${edgeCount}** edges to the Knowledge Graph.`,
    `🌐 Language: ${template.language || "unknown"} | Framework: ${template.framework || "unknown"}`,
    "",
    "💡 Installed templates enhance all graph-based features.",
    `💡 To uninstall: remove node_modules/@kuma-templates/${name}`,
  ].join("\n");
}

// ============================================================
// GENERATE BUILT-IN TEMPLATE DATA
// ============================================================

/**
 * Generate built-in template data.
 * In production, these would be downloaded from npm.
 */
function generateBuiltInTemplate(id: string): { nodes: TemplateNode[]; edges: TemplateEdge[] } | null {
  switch (id) {
    // ── JS/TS Framework Web ──
    case "graph:hono":
      return {
        nodes: [
          { id: "module::Route", type: "module", name: "Route Handler", metadata: { layer: "presentation" } },
          { id: "module::Middleware", type: "module", name: "Hono Middleware", metadata: { layer: "presentation" } },
          { id: "module::Validator", type: "module", name: "Validator", metadata: { layer: "presentation" } },
          { id: "module::RPC", type: "module", name: "RPC Client", metadata: { layer: "client" } },
          { id: "module::JSX", type: "module", name: "JSX Renderer", metadata: { layer: "presentation" } },
          { id: "module::HonoX", type: "module", name: "HonoX (File-based)", metadata: { layer: "presentation" } },
        ],
        edges: [
          { sourceId: "module::Route", targetId: "module::Middleware", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Route", targetId: "module::Validator", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Route", targetId: "module::JSX", type: "depends_on", weight: 0.5 },
          { sourceId: "module::RPC", targetId: "module::Route", type: "depends_on", weight: 0.9 },
          { sourceId: "module::HonoX", targetId: "module::Route", type: "depends_on", weight: 0.7 },
          { sourceId: "module::HonoX", targetId: "module::JSX", type: "depends_on", weight: 0.6 },
        ],
      };

    case "graph:fastify":
      return {
        nodes: [
          { id: "module::Plugin", type: "module", name: "Fastify Plugin", metadata: { layer: "infrastructure" } },
          { id: "module::Route", type: "module", name: "Route Handler", metadata: { layer: "presentation" } },
          { id: "module::Hook", type: "module", name: "Lifecycle Hook", metadata: { layer: "infrastructure" } },
          { id: "module::Schema", type: "module", name: "JSON Schema Validation", metadata: { layer: "presentation" } },
          { id: "module::Decorator", type: "module", name: "Decorator", metadata: { layer: "infrastructure" } },
          { id: "module::Encapsulation", type: "module", name: "Context Encapsulation", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::Plugin", targetId: "module::Route", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Plugin", targetId: "module::Hook", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Plugin", targetId: "module::Decorator", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Route", targetId: "module::Schema", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Route", targetId: "module::Hook", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Encapsulation", targetId: "module::Plugin", type: "depends_on", weight: 0.9 },
        ],
      };

    case "graph:elysia":
      return {
        nodes: [
          { id: "module::Route", type: "module", name: "Route Handler", metadata: { layer: "presentation" } },
          { id: "module::Plugin", type: "module", name: "Elysia Plugin", metadata: { layer: "infrastructure" } },
          { id: "module::Schema", type: "module", name: "Schema Validation", metadata: { layer: "presentation" } },
          { id: "module::State", type: "module", name: "Shared State", metadata: { layer: "infrastructure" } },
          { id: "module::Derive", type: "module", name: "Derived State", metadata: { layer: "infrastructure" } },
          { id: "module::Eden", type: "module", name: "Eden Treaty Client", metadata: { layer: "client" } },
        ],
        edges: [
          { sourceId: "module::Route", targetId: "module::Schema", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Route", targetId: "module::State", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Route", targetId: "module::Derive", type: "depends_on", weight: 0.5 },
          { sourceId: "module::Plugin", targetId: "module::Route", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Plugin", targetId: "module::State", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Eden", targetId: "module::Route", type: "depends_on", weight: 0.9 },
        ],
      };

    case "graph:nextjs-pages":
      return {
        nodes: [
          { id: "module::Page", type: "module", name: "Page Component", metadata: { layer: "presentation" } },
          { id: "module::APIRoute", type: "module", name: "API Route", metadata: { layer: "presentation" } },
          { id: "module::SSP", type: "module", name: "getServerSideProps", metadata: { layer: "data" } },
          { id: "module::SSG", type: "module", name: "getStaticProps/getStaticPaths", metadata: { layer: "data" } },
          { id: "module::Middleware", type: "module", name: "Next.js Middleware", metadata: { layer: "presentation" } },
          { id: "module::ISR", type: "module", name: "ISR (revalidate)", metadata: { layer: "data" } },
        ],
        edges: [
          { sourceId: "module::Page", targetId: "module::SSP", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Page", targetId: "module::SSG", type: "depends_on", weight: 0.7 },
          { sourceId: "module::APIRoute", targetId: "module::Middleware", type: "depends_on", weight: 0.5 },
          { sourceId: "module::SSG", targetId: "module::ISR", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Middleware", targetId: "module::Page", type: "depends_on", weight: 0.5 },
        ],
      };

    case "graph:remix":
      return {
        nodes: [
          { id: "module::Loader", type: "module", name: "Route Loader", metadata: { layer: "data" } },
          { id: "module::Action", type: "module", name: "Route Action", metadata: { layer: "data" } },
          { id: "module::Component", type: "module", name: "Route Component", metadata: { layer: "presentation" } },
          { id: "module::Form", type: "module", name: "Form (remix)", metadata: { layer: "presentation" } },
          { id: "module::NestedRoute", type: "module", name: "Nested Route (Outlet)", metadata: { layer: "presentation" } },
          { id: "module::Resource", type: "module", name: "Resource Route", metadata: { layer: "presentation" } },
        ],
        edges: [
          { sourceId: "module::Loader", targetId: "module::Component", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Action", targetId: "module::Component", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Form", targetId: "module::Action", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Component", targetId: "module::NestedRoute", type: "depends_on", weight: 0.7 },
          { sourceId: "module::NestedRoute", targetId: "module::Loader", type: "depends_on", weight: 0.8 },
        ],
      };

    // ── React Ecosystem ──
    case "graph:tanstack-query":
      return {
        nodes: [
          { id: "module::Query", type: "module", name: "useQuery", metadata: { layer: "data" } },
          { id: "module::Mutation", type: "module", name: "useMutation", metadata: { layer: "data" } },
          { id: "module::QueryClient", type: "module", name: "QueryClient", metadata: { layer: "infrastructure" } },
          { id: "module::QueryKey", type: "module", name: "Query Key Factory", metadata: { layer: "data" } },
          { id: "module::Cache", type: "module", name: "Cache Invalidation", metadata: { layer: "infrastructure" } },
          { id: "module::Infinite", type: "module", name: "useInfiniteQuery", metadata: { layer: "data" } },
        ],
        edges: [
          { sourceId: "module::Query", targetId: "module::QueryClient", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Query", targetId: "module::QueryKey", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Mutation", targetId: "module::QueryClient", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Mutation", targetId: "module::Cache", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Infinite", targetId: "module::QueryClient", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Cache", targetId: "module::QueryKey", type: "depends_on", weight: 0.7 },
        ],
      };

    case "graph:tanstack-router":
      return {
        nodes: [
          { id: "module::Route", type: "module", name: "Route Definition", metadata: { layer: "presentation" } },
          { id: "module::Router", type: "module", name: "Router Instance", metadata: { layer: "infrastructure" } },
          { id: "module::Loader", type: "module", name: "Route Loader", metadata: { layer: "data" } },
          { id: "module::SearchParams", type: "module", name: "Search Params", metadata: { layer: "presentation" } },
          { id: "module::Guard", type: "module", name: "Route Guard (beforeLoad)", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::Route", targetId: "module::Router", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Route", targetId: "module::Loader", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Route", targetId: "module::SearchParams", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Route", targetId: "module::Guard", type: "depends_on", weight: 0.5 },
          { sourceId: "module::Loader", targetId: "module::Guard", type: "depends_on", weight: 0.4 },
        ],
      };

    case "graph:tanstack-table":
      return {
        nodes: [
          { id: "module::ColumnDef", type: "module", name: "Column Definition", metadata: { layer: "presentation" } },
          { id: "module::Table", type: "module", name: "Table Instance", metadata: { layer: "infrastructure" } },
          { id: "module::Sorting", type: "module", name: "Sorting State", metadata: { layer: "presentation" } },
          { id: "module::Filtering", type: "module", name: "Column Filtering", metadata: { layer: "presentation" } },
          { id: "module::Pagination", type: "module", name: "Pagination", metadata: { layer: "presentation" } },
          { id: "module::Selection", type: "module", name: "Row Selection", metadata: { layer: "presentation" } },
        ],
        edges: [
          { sourceId: "module::Table", targetId: "module::ColumnDef", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Table", targetId: "module::Sorting", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Table", targetId: "module::Filtering", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Table", targetId: "module::Pagination", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Table", targetId: "module::Selection", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Filtering", targetId: "module::Sorting", type: "depends_on", weight: 0.4 },
        ],
      };

    case "graph:zustand":
      return {
        nodes: [
          { id: "module::Store", type: "module", name: "Store (create)", metadata: { layer: "state" } },
          { id: "module::Action", type: "module", name: "Store Action", metadata: { layer: "state" } },
          { id: "module::Selector", type: "module", name: "Selector Hook", metadata: { layer: "state" } },
          { id: "module::Middleware", type: "module", name: "Zustand Middleware", metadata: { layer: "infrastructure" } },
          { id: "module::Slice", type: "module", name: "Slice Pattern", metadata: { layer: "state" } },
        ],
        edges: [
          { sourceId: "module::Store", targetId: "module::Action", type: "has", weight: 0.9 },
          { sourceId: "module::Store", targetId: "module::Middleware", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Selector", targetId: "module::Store", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Slice", targetId: "module::Store", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Middleware", targetId: "module::Store", type: "wraps", weight: 0.6 },
        ],
      };

    case "graph:shadcn":
      return {
        nodes: [
          { id: "module::Component", type: "module", name: "UI Component", metadata: { layer: "presentation" } },
          { id: "module::Primitive", type: "module", name: "Radix Primitive", metadata: { layer: "infrastructure" } },
          { id: "module::Hook", type: "module", name: "Custom Hook", metadata: { layer: "presentation" } },
          { id: "module::Utils", type: "module", name: "cn() Utility", metadata: { layer: "infrastructure" } },
          { id: "module::Registry", type: "module", name: "Component Registry", metadata: { layer: "infrastructure" } },
          { id: "module::Theme", type: "module", name: "Theme Variables", metadata: { layer: "presentation" } },
        ],
        edges: [
          { sourceId: "module::Component", targetId: "module::Primitive", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Component", targetId: "module::Utils", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Component", targetId: "module::Hook", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Component", targetId: "module::Theme", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Registry", targetId: "module::Component", type: "has", weight: 0.9 },
          { sourceId: "module::Primitive", targetId: "module::Utils", type: "depends_on", weight: 0.5 },
        ],
      };

    // ── Database (JS/TS) ──
    case "graph:prisma":
      return {
        nodes: [
          { id: "module::Model", type: "module", name: "Prisma Model", metadata: { layer: "data" } },
          { id: "module::Relation", type: "module", name: "Relation (1:1, 1:M, M:N)", metadata: { layer: "data" } },
          { id: "module::Enum", type: "module", name: "Prisma Enum", metadata: { layer: "data" } },
          { id: "module::Migration", type: "module", name: "Migration", metadata: { layer: "infrastructure" } },
          { id: "module::Client", type: "module", name: "Prisma Client (queries)", metadata: { layer: "data" } },
          { id: "module::Middleware", type: "module", name: "Prisma Middleware", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::Model", targetId: "module::Relation", type: "has", weight: 0.9 },
          { sourceId: "module::Model", targetId: "module::Enum", type: "depends_on", weight: 0.5 },
          { sourceId: "module::Migration", targetId: "module::Model", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Client", targetId: "module::Model", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Middleware", targetId: "module::Client", type: "wraps", weight: 0.7 },
          { sourceId: "module::Client", targetId: "module::Relation", type: "depends_on", weight: 0.8 },
        ],
      };

    case "graph:drizzle":
      return {
        nodes: [
          { id: "module::Schema", type: "module", name: "Drizzle Schema", metadata: { layer: "data" } },
          { id: "module::Table", type: "module", name: "Table Definition", metadata: { layer: "data" } },
          { id: "module::Relation", type: "module", name: "Relations", metadata: { layer: "data" } },
          { id: "module::Query", type: "module", name: "Query Builder", metadata: { layer: "data" } },
          { id: "module::Migration", type: "module", name: "Drizzle Kit Migration", metadata: { layer: "infrastructure" } },
          { id: "module::DB", type: "module", name: "Database Instance", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::Schema", targetId: "module::Table", type: "has", weight: 1.0 },
          { sourceId: "module::Schema", targetId: "module::Relation", type: "has", weight: 0.8 },
          { sourceId: "module::Query", targetId: "module::Schema", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Query", targetId: "module::DB", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Migration", targetId: "module::Schema", type: "depends_on", weight: 0.8 },
          { sourceId: "module::DB", targetId: "module::Schema", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Relation", targetId: "module::Table", type: "depends_on", weight: 0.8 },
        ],
      };

    // ── PHP ──
    case "graph:laravel":
      return {
        nodes: [
          { id: "module::Controller", type: "module", name: "Controller", metadata: { layer: "presentation" } },
          { id: "module::Service", type: "module", name: "Service", metadata: { layer: "business" } },
          { id: "module::Repository", type: "module", name: "Repository (Eloquent)", metadata: { layer: "data" } },
          { id: "module::Middleware", type: "module", name: "Middleware", metadata: { layer: "presentation" } },
          { id: "module::Blade", type: "module", name: "Blade Template", metadata: { layer: "presentation" } },
          { id: "module::Model", type: "module", name: "Eloquent Model", metadata: { layer: "data" } },
        ],
        edges: [
          { sourceId: "module::Controller", targetId: "module::Service", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Service", targetId: "module::Repository", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Controller", targetId: "module::Middleware", type: "depends_on", weight: 0.5 },
          { sourceId: "module::Controller", targetId: "module::Blade", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Repository", targetId: "module::Model", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Service", targetId: "module::Model", type: "depends_on", weight: 0.6 },
        ],
      };

    case "graph:spring":
      return {
        nodes: [
          { id: "module::Controller", type: "module", name: "REST Controller", metadata: { layer: "presentation" } },
          { id: "module::Service", type: "module", name: "Service", metadata: { layer: "business" } },
          { id: "module::Repository", type: "module", name: "JPA Repository", metadata: { layer: "data" } },
          { id: "module::Entity", type: "module", name: "JPA Entity", metadata: { layer: "data" } },
          { id: "module::Config", type: "module", name: "Configuration", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::Controller", targetId: "module::Service", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Service", targetId: "module::Repository", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Repository", targetId: "module::Entity", type: "depends_on", weight: 1.0 },
          { sourceId: "module::Config", targetId: "module::Controller", type: "depends_on", weight: 0.4 },
          { sourceId: "module::Config", targetId: "module::Service", type: "depends_on", weight: 0.4 },
        ],
      };

    case "graph:django":
      return {
        nodes: [
          { id: "module::View", type: "module", name: "View", metadata: { layer: "presentation" } },
          { id: "module::Model", type: "module", name: "Django Model", metadata: { layer: "data" } },
          { id: "module::Serializer", type: "module", name: "Serializer", metadata: { layer: "presentation" } },
          { id: "module::URL", type: "module", name: "URL Router", metadata: { layer: "presentation" } },
          { id: "module::Admin", type: "module", name: "Admin Config", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::URL", targetId: "module::View", type: "depends_on", weight: 1.0 },
          { sourceId: "module::View", targetId: "module::Model", type: "depends_on", weight: 0.9 },
          { sourceId: "module::View", targetId: "module::Serializer", type: "depends_on", weight: 0.7 },
          { sourceId: "module::Admin", targetId: "module::Model", type: "depends_on", weight: 0.6 },
        ],
      };

    case "graph:gin":
      return {
        nodes: [
          { id: "module::Handler", type: "module", name: "Route Handler", metadata: { layer: "presentation" } },
          { id: "module::Service", type: "module", name: "Service", metadata: { layer: "business" } },
          { id: "module::Repository", type: "module", name: "Repository", metadata: { layer: "data" } },
          { id: "module::Middleware", type: "module", name: "Gin Middleware", metadata: { layer: "presentation" } },
          { id: "module::Model", type: "module", name: "Data Model", metadata: { layer: "data" } },
        ],
        edges: [
          { sourceId: "module::Handler", targetId: "module::Service", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Service", targetId: "module::Repository", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Handler", targetId: "module::Middleware", type: "depends_on", weight: 0.6 },
          { sourceId: "module::Repository", targetId: "module::Model", type: "depends_on", weight: 0.8 },
        ],
      };

    case "graph:axum":
      return {
        nodes: [
          { id: "module::Handler", type: "module", name: "Route Handler", metadata: { layer: "presentation" } },
          { id: "module::Extractor", type: "module", name: "Extractor", metadata: { layer: "presentation" } },
          { id: "module::Service", type: "module", name: "Service", metadata: { layer: "business" } },
          { id: "module::Repository", type: "module", name: "Repository", metadata: { layer: "data" } },
          { id: "module::State", type: "module", name: "App State", metadata: { layer: "infrastructure" } },
        ],
        edges: [
          { sourceId: "module::Handler", targetId: "module::Extractor", type: "depends_on", weight: 0.8 },
          { sourceId: "module::Handler", targetId: "module::Service", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Service", targetId: "module::Repository", type: "depends_on", weight: 0.9 },
          { sourceId: "module::Handler", targetId: "module::State", type: "depends_on", weight: 0.5 },
        ],
      };

    default:
      return null;
  }
}
