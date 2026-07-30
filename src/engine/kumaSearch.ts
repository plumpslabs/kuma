// ============================================================
// KUMA SEARCH — Hybrid Semantic Search Engine (Issue #13)
// ============================================================
// Combines keyword matching with TF-IDF vector similarity for
// semantic search across graph nodes, memory files, and research
// cache. No external ML dependencies — pure JS TF-IDF.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { getDb } from "./kumaDb.js";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// SYNONYM MAP — Keyword expansion for semantic matching
// ============================================================

const SYNONYM_MAP: Record<string, string[]> = {
  timeout: ["timeout", "duration", "expiry", "ttl", "deadline", "latency"],
  duration: ["duration", "timeout", "length", "period", "interval"],
  delay: ["delay", "wait", "latency", "defer", "throttle"],
  latency: ["latency", "delay", "response time", "speed", "performance"],
  error: ["error", "failure", "exception", "bug", "fault", "crash"],
  crash: ["crash", "panic", "oom", "out of memory", "segfault"],
  fail: ["fail", "error", "break", "regression", "broken"],
  auth: ["auth", "authentication", "login", "oauth", "session", "token", "credential"],
  login: ["login", "signin", "auth", "authenticate"],
  token: ["token", "jwt", "session", "api key", "secret"],
  permission: ["permission", "access", "role", "rbac", "authorization", "acl"],
  database: ["database", "db", "storage", "persistence", "sql", "nosql"],
  query: ["query", "search", "fetch", "select", "lookup"],
  index: ["index", "key", "lookup", "search"],
  cache: ["cache", "memcached", "redis", "buffer", "temporary storage"],
  api: ["api", "endpoint", "route", "rest", "graphql", "service"],
  route: ["route", "endpoint", "path", "handler"],
  request: ["request", "http", "call", "fetch", "invocation"],
  response: ["response", "reply", "result", "output"],
  performance: ["performance", "speed", "latency", "throughput", "efficiency"],
  memory: ["memory", "ram", "heap", "allocation", "leak"],
  cpu: ["cpu", "processor", "compute", "thread", "worker"],
  architecture: ["architecture", "design", "pattern", "structure", "system"],
  service: ["service", "microservice", "module", "component", "layer"],
  config: ["config", "configuration", "setting", "env", "environment"],
  deploy: ["deploy", "release", "rollout", "publish", "ship"],
  build: ["build", "compile", "bundle", "transpile", "package"],
  test: ["test", "spec", "unit test", "integration", "e2e"],
  lint: ["lint", "format", "style", "prettier", "eslint"],
  redis: ["redis", "cache", "session store", "message queue"],
  postgres: ["postgres", "postgresql", "psql", "relational db", "sql"],
  docker: ["docker", "container", "image", "dockerfile", "compose"],
  typescript: ["typescript", "ts", "type system", "compiler"],
  prisma: ["prisma", "orm", "database client", "schema"],
  create: ["create", "add", "new", "make", "generate"],
  update: ["update", "modify", "change", "edit", "patch"],
  delete: ["delete", "remove", "drop", "clear", "purge"],
};

/**
 * Expand a query term to include synonyms.
 * Returns a map of all expanded terms with their original source term.
 */
export function expandQueryTerms(query: string): Map<string, Set<string>> {
  const terms = query.toLowerCase().split(/[\s_-]+/).filter(t => t.length > 2);
  const expanded = new Map<string, Set<string>>();

  for (const term of terms) {
    const sources = new Set<string>();
    sources.add(term);

    if (SYNONYM_MAP[term]) {
      for (const syn of SYNONYM_MAP[term]) {
        sources.add(syn);
      }
    }

    for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
      if (synonyms.includes(term)) {
        sources.add(key);
      }
    }

    expanded.set(term, sources);
  }

  return expanded;
}

// ============================================================
// TF-IDF Vector Builder
// ============================================================

interface TokenVector {
  terms: Map<string, number>; // term -> tf-idf score
  source: string;
  sourceType: "graph" | "memory" | "research";
}

let _vectorCache: { vectors: TokenVector[]; builtAt: number } | null = null;
const VECTOR_CACHE_TTL = 300_000; // 5 minutes (Issue #13: was 60s, too frequent)

/**
 * Build TF-IDF vectors from all available knowledge sources.
 * Cached for VECTOR_CACHE_TTL to avoid recomputing on every search.
 */
export async function buildSearchVectors(): Promise<TokenVector[]> {
  if (_vectorCache && (Date.now() - _vectorCache.builtAt) < VECTOR_CACHE_TTL) {
    return _vectorCache.vectors;
  }

  const vectors: TokenVector[] = [];

  // 1. Collect from knowledge graph nodes
  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT id, name, metadata, file_path FROM nodes ORDER BY updated_at DESC LIMIT 500");
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const name = (row.name as string) || "";
      const metaStr = (row.metadata as string) || "{}";
      let metaText = "";
      try { const meta = JSON.parse(metaStr); metaText = Object.values(meta).join(" "); } catch { /* skip */ }
      const filePath = (row.file_path as string) || "";
      const nodeText = `${name} ${metaText} ${filePath}`.toLowerCase();
      const rawTerms = extractTerms(nodeText);
      // 🔧 FIX: Count actual term frequency per document (was always 0)
      const termCounts = new Map<string, number>();
      for (const t of rawTerms) {
        termCounts.set(t, (termCounts.get(t) || 0) + 1);
      }
      vectors.push({
        terms: termCounts,
        source: name || (row.id as string),
        sourceType: "graph",
      });
    }
    stmt.free();
  } catch { /* skip */ }

  // 2. Collect from memory files
  try {
    const root = getProjectRoot();
    const memDir = path.join(root, ".kuma", "memories");
    if (fs.existsSync(memDir)) {
      const files = fs.readdirSync(memDir).filter(f => f.endsWith(".md")).slice(0, 10);
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(memDir, file), "utf-8");
          const text = content.toLowerCase();
          const rawTerms = extractTerms(text);
          const termCounts = new Map<string, number>();
          for (const t of rawTerms) {
            termCounts.set(t, (termCounts.get(t) || 0) + 1);
          }
          vectors.push({
            terms: termCounts,
            source: file.replace(/\.md$/, ""),
            sourceType: "memory",
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  // 3. Collect from research cache
  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT scope, record FROM research_cache ORDER BY updated_at DESC LIMIT 50");
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const scope = (row.scope as string) || "";
      const record = (row.record as string) || "";
      const text = `${scope} ${record}`.toLowerCase();
      const rawTerms = extractTerms(text);
      const termCounts = new Map<string, number>();
      for (const t of rawTerms) {
        termCounts.set(t, (termCounts.get(t) || 0) + 1);
      }
      vectors.push({
        terms: termCounts,
        source: scope,
        sourceType: "research",
      });
    }
    stmt.free();
  } catch { /* skip */ }

  // Compute IDF for each term across all documents
  const docCount = vectors.length || 1;

  // Count how many documents contain each term
  const docFreq = new Map<string, number>();
  for (const vec of vectors) {
    const seen = new Set<string>();
    for (const [term] of vec.terms) {
      if (!seen.has(term)) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
        seen.add(term);
      }
    }
  }

  // Compute IDF and apply TF-IDF weights
  for (const vec of vectors) {
    const maxFreq = Math.max(1, ...Array.from(vec.terms.values()));
    for (const [term, rawFreq] of vec.terms) {
      const tf = 0.5 + (0.5 * rawFreq) / maxFreq; // augmented frequency
      const docsWithTerm = docFreq.get(term) || 1;
      const idf = Math.log(1 + (docCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
      vec.terms.set(term, tf * idf);
    }
  }

  _vectorCache = { vectors, builtAt: Date.now() };
  return vectors;
}

/**
 * Extract meaningful terms from text.
 */
function extractTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'\/\\|@#$%^&*+=<>~`]+/)
    .filter(t => t.length > 2 && t.length < 50 && !/^\d+$/.test(t));
}

// ============================================================
// COSINE SIMILARITY
// ============================================================

function cosineSimilarity(
  queryVec: Map<string, number>,
  docVec: Map<string, number>,
): number {
  let dotProduct = 0;
  let queryMagnitude = 0;
  let docMagnitude = 0;

  for (const [term, qWeight] of queryVec) {
    queryMagnitude += qWeight * qWeight;
    const dWeight = docVec.get(term) || 0;
    dotProduct += qWeight * dWeight;
  }

  for (const [, dWeight] of docVec) {
    docMagnitude += dWeight * dWeight;
  }

  const mag = Math.sqrt(queryMagnitude) * Math.sqrt(docMagnitude);
  if (mag === 0) return 0;
  return dotProduct / mag;
}

// ============================================================
// HYBRID SEARCH
// ============================================================

export interface HybridSearchResult {
  source: string;
  sourceType: "graph" | "memory" | "research";
  score: number;
  keywordScore: number;
  vectorScore: number;
  matchedTerms: string[];
}

/**
 * Perform hybrid search: keyword matching + TF-IDF vector similarity.
 * Returns results scored 0-100, sorted by relevance.
 */
export async function hybridSearch(
  query: string,
  limit: number = 10,
): Promise<HybridSearchResult[]> {
  const results: HybridSearchResult[] = [];

  // 1. Expand query terms with synonyms
  const expandedTerms = expandQueryTerms(query);
  const allSearchTerms = new Set<string>();
  for (const [, sources] of expandedTerms) {
    for (const term of sources) {
      allSearchTerms.add(term);
    }
  }
  const searchTerms = Array.from(allSearchTerms);

  // 2. Build query vector
  const queryVector = new Map<string, number>();
  for (const [originalTerm, sources] of expandedTerms) {
    for (const term of sources) {
      const weight = term === originalTerm ? 2.0 : 1.0;
      queryVector.set(term, (queryVector.get(term) || 0) + weight);
    }
  }

  // 3. Search graph database (keyword match)
  try {
    const db = await getDb();
    const likeClauses = searchTerms.map(() => `name LIKE ?`).join(" OR ");
    const sql = `SELECT id, name, type, file_path, metadata FROM nodes WHERE (${likeClauses}) LIMIT ${limit * 3}`;
    const stmt = db.prepare(sql);
    stmt.bind(searchTerms.map(t => `%${t}%`));

    const seen = new Set<string>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const name = (row.name as string) || "";
      const filePath = (row.file_path as string) || "";
      const sourceKey = name + filePath;
      if (seen.has(sourceKey)) continue;
      seen.add(sourceKey);

      const lowerText = `${name} ${filePath}`.toLowerCase();
      const matchedTerms = searchTerms.filter(t => lowerText.includes(t));
      const keywordScore = matchedTerms.length > 0
        ? Math.round((matchedTerms.length / Math.max(1, searchTerms.length)) * 100)
        : 0;

      results.push({
        source: name,
        sourceType: "graph",
        score: keywordScore,
        keywordScore,
        vectorScore: 0,
        matchedTerms,
      });
    }
    stmt.free();
  } catch (err) {
    console.error(`[KumaSearch] DB search failed: ${err}`);
  }

  // 4. TF-IDF vector similarity scoring
  try {
    const vectors = await buildSearchVectors();
    for (const vec of vectors) {
      const vectorScore = Math.round(cosineSimilarity(queryVector, vec.terms) * 100);
      const existing = results.find(r => r.source === vec.source);
      if (existing) {
        existing.vectorScore = vectorScore;
        existing.score = Math.min(100, Math.round(existing.keywordScore * 0.6 + vectorScore * 0.4));
        for (const [term] of vec.terms) {
          if (queryVector.has(term) && !existing.matchedTerms.includes(term)) {
            existing.matchedTerms.push(term);
          }
        }
      } else if (vectorScore > 0) {
        const matchedTerms: string[] = [];
        for (const [term] of vec.terms) {
          if (queryVector.has(term)) matchedTerms.push(term);
        }
        results.push({
          source: vec.source,
          sourceType: vec.sourceType,
          score: Math.round(vectorScore * 0.4),
          keywordScore: 0,
          vectorScore,
          matchedTerms,
        });
      }
    }
  } catch (err) {
    console.error(`[KumaSearch] Vector search failed: ${err}`);
  }

  // 5. Sort + deduplicate
  const uniqueResults = Array.from(
    new Map(results.map(r => [r.source, r])).values()
  );
  return uniqueResults.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Format hybrid search results as readable string.
 */
export function formatHybridResults(
  query: string,
  results: HybridSearchResult[],
): string {
  const expandedTerms = expandQueryTerms(query);
  const originalTerms = Array.from(expandedTerms.keys()).join(", ");
  const totalSynonyms = Array.from(expandedTerms.values()).reduce(
    (sum, s) => sum + s.size, 0
  );

  const lines: string[] = [
    "**Hybrid Search** — " + query,
    "----------------------------------------",
    "",
    "Expanded query: " + originalTerms + " (" + totalSynonyms + " total terms with synonyms)",
    "",
  ];

  if (results.length === 0) {
    lines.push("No results found. Try different keywords or research first.");
    return lines.join("\n");
  }

  lines.push(results.length + " result(s) — ranked by hybrid relevance");
  lines.push("");

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const typeIcon = r.sourceType === "graph" ? "file" : r.sourceType === "memory" ? "memory" : "research";
    const matchType = r.vectorScore > r.keywordScore
      ? "semantic match"
      : r.keywordScore > 0
        ? "keyword match"
        : "expanded match";

    lines.push((i + 1) + ". [" + typeIcon + "] " + r.source + " — " + r.score + "%");
    lines.push("   keyword: " + r.keywordScore + "% | vector: " + r.vectorScore + "% (" + matchType + ")");
    if (r.matchedTerms.length > 0) {
      lines.push("   Terms: " + r.matchedTerms.slice(0, 6).join(", "));
    }
    lines.push("");
  }

  lines.push("Hybrid search combines keyword matching with semantic synonym expansion.");
  return lines.join("\n");
}

// ============================================================
// GRAPH CONNECTIVITY SCORING (Pilar 3)
// ============================================================
// Enhances hybrid search by factoring in graph edge weights.
// Nodes with more inbound/outbound edges get a connectivity boost.
// ============================================================

interface GraphConnectivity {
  nodeEdges: Map<string, number>; // node id -> edge count
  totalEdges: number;
}

let _connectivityCache: GraphConnectivity | null = null;
const CONNECTIVITY_CACHE_TTL = 300_000; // 5 minutes

/**
 * Build graph connectivity index for scoring.
 */
export async function buildGraphConnectivity(): Promise<GraphConnectivity> {
  if (_connectivityCache) return _connectivityCache;

  const nodeEdges = new Map<string, number>();
  let totalEdges = 0;

  try {
    const db = await getDb();
    const stmt = db.prepare("SELECT source_id, target_id FROM edges LIMIT 2000");
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const src = (row.source_id as string) || "";
      const tgt = (row.target_id as string) || "";
      if (src) nodeEdges.set(src, (nodeEdges.get(src) || 0) + 1);
      if (tgt) nodeEdges.set(tgt, (nodeEdges.get(tgt) || 0) + 1);
      totalEdges++;
    }
    stmt.free();
  } catch {}

  _connectivityCache = { nodeEdges, totalEdges };
  setTimeout(() => { _connectivityCache = null; }, CONNECTIVITY_CACHE_TTL);
  return _connectivityCache;
}

/**
 * Get connectivity score for a node (0-1 normalized).
 */
function connectivityScore(nodeId: string, connectivity: GraphConnectivity): number {
  if (connectivity.totalEdges === 0) return 0;
  const edges = connectivity.nodeEdges.get(nodeId) || 0;
  // Logarithmic scaling to prevent highly-connected nodes from dominating
  return Math.min(1, Math.log(1 + edges) / Math.log(1 + 20));
}

/**
 * Clear connectivity cache.
 */
export function clearConnectivityCache(): void {
  _connectivityCache = null;
}

// ============================================================
// ENHANCED HYBRID SEARCH with Graph Connectivity (Pilar 3)
// ============================================================

/**
 * Enhanced hybrid search that combines:
 * 1. TF-IDF vector similarity (semantic)
 * 2. Keyword matching (lexical)
 * 3. Graph connectivity scoring (structural)
 */
export async function enhancedHybridSearch(
  query: string,
  limit: number = 10,
): Promise<HybridSearchResult[]> {
  const basicResults = await hybridSearch(query, limit * 2);
  const connectivity = await buildGraphConnectivity();

  // Apply graph connectivity boost
  for (const result of basicResults) {
    // Find matching node in graph
    try {
      const db = await getDb();
      const stmt = db.prepare("SELECT id FROM nodes WHERE name LIKE ? LIMIT 1");
      stmt.bind([`%${result.source}%`]);
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const nodeId = (row.id as string) || "";
        const connScore = connectivityScore(nodeId, connectivity);
        // Blend: 60% original score + 40% connectivity
        result.score = Math.min(100, Math.round(result.score * 0.6 + connScore * 40));
      }
      stmt.free();
    } catch {}
  }

  return basicResults.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function clearSearchCache(): void {
  _vectorCache = null;
  clearConnectivityCache();
}
