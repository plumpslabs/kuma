// ============================================================
// KUMA GRAPH CENTRALITY — PageRank & Architectural Hub Analysis
// ============================================================
// Computes PageRank & Degree Centrality across knowledge graph nodes
// to mathematically identify "load-bearing" core files vs leaf nodes.
// Used by impact analysis, domain clustering, and risk calculations.
// ============================================================

import { getDb } from "./kumaDb.js";

export interface NodeCentrality {
  nodeId: string;
  name: string;
  type: string;
  filePath?: string;
  score: number;       // Normalized 0.00 to 1.00
  rank: number;        // 1-indexed rank among all nodes
  totalNodes: number;
  inDegree: number;    // Incoming dependencies / callers
  outDegree: number;   // Outgoing dependencies / calls
  isHub: boolean;      // True if node is a load-bearing hub
  hubBadge?: string;   // Markdown badge e.g. "🔥 CRITICAL CORE HUB"
}

export interface CentralityOverview {
  totalNodes: number;
  totalEdges: number;
  topHubs: NodeCentrality[];
  scores: Map<string, NodeCentrality>;
}

// In-memory cache for fast repeated queries within session
let _cachedCentrality: { timestamp: number; data: CentralityOverview } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Computes PageRank across all nodes in the SQLite knowledge graph.
 */
export async function computeGraphCentrality(force = false): Promise<CentralityOverview> {
  const now = Date.now();
  if (!force && _cachedCentrality && (now - _cachedCentrality.timestamp) < CACHE_TTL_MS) {
    return _cachedCentrality.data;
  }

  const db = await getDb();

  // 1. Fetch all nodes
  const nodeRows = db.exec("SELECT id, name, type, file_path FROM nodes");
  const nodes = nodeRows[0]?.values || [];
  const totalNodes = nodes.length;

  if (totalNodes === 0) {
    const empty: CentralityOverview = { totalNodes: 0, totalEdges: 0, topHubs: [], scores: new Map() };
    _cachedCentrality = { timestamp: now, data: empty };
    return empty;
  }

  // 2. Fetch all edges
  const edgeRows = db.exec("SELECT source_id, target_id, weight FROM edges");
  const edges = edgeRows[0]?.values || [];
  const totalEdges = edges.length;

  const nodeIndexMap = new Map<string, number>();
  const indexToNode: Array<{ id: string; name: string; type: string; filePath?: string }> = [];

  for (let i = 0; i < totalNodes; i++) {
    const [id, name, type, filePath] = nodes[i] as [string, string, string, string | null];
    nodeIndexMap.set(id, i);
    indexToNode.push({ id, name, type, filePath: filePath || undefined });
  }

  const inDegree = new Int32Array(totalNodes);
  const outDegree = new Int32Array(totalNodes);
  const adjacencyList: Array<Array<{ targetIdx: number; weight: number }>> = Array.from({ length: totalNodes }, () => []);

  for (const edge of edges) {
    const [sourceId, targetId, weightVal] = edge as [string, string, number | null];
    const sourceIdx = nodeIndexMap.get(sourceId);
    const targetIdx = nodeIndexMap.get(targetId);
    const weight = weightVal || 1.0;

    if (sourceIdx !== undefined && targetIdx !== undefined && sourceIdx !== targetIdx) {
      // source depends on target (e.g. source calls target or imports target)
      // in graph authority, target receives incoming rank!
      outDegree[sourceIdx]++;
      inDegree[targetIdx]++;
      adjacencyList[sourceIdx].push({ targetIdx, weight });
    }
  }

  // 3. Power Iteration PageRank
  // Damping factor d = 0.85
  const d = 0.85;
  const iterations = 15;
  let ranks = new Float64Array(totalNodes).fill(1 / totalNodes);

  for (let it = 0; it < iterations; it++) {
    const newRanks = new Float64Array(totalNodes).fill((1 - d) / totalNodes);
    let danglingSum = 0;

    for (let i = 0; i < totalNodes; i++) {
      if (outDegree[i] === 0) {
        danglingSum += ranks[i];
      } else {
        const outgoing = adjacencyList[i];
        const share = (ranks[i] * d) / outDegree[i];
        for (const { targetIdx } of outgoing) {
          newRanks[targetIdx] += share;
        }
      }
    }

    // Distribute dangling weight evenly
    const danglingShare = (d * danglingSum) / totalNodes;
    for (let i = 0; i < totalNodes; i++) {
      ranks[i] = newRanks[i] + danglingShare;
    }
  }

  // 4. Find max score for normalization (0.00 to 1.00)
  let maxRank = 0.00001;
  for (let i = 0; i < totalNodes; i++) {
    if (ranks[i] > maxRank) maxRank = ranks[i];
  }

  // 5. Build results & sort by score descending
  const results: NodeCentrality[] = [];
  for (let i = 0; i < totalNodes; i++) {
    const node = indexToNode[i];
    const normalizedScore = Math.min(1.0, Math.round((ranks[i] / maxRank) * 100) / 100);
    const inDeg = inDegree[i];
    const outDeg = outDegree[i];

    results.push({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      filePath: node.filePath,
      score: normalizedScore,
      rank: 0, // Assigned after sort
      totalNodes,
      inDegree: inDeg,
      outDegree: outDeg,
      isHub: false,
    });
  }

  results.sort((a, b) => b.score - a.score || b.inDegree - a.inDegree);

  const scoreMap = new Map<string, NodeCentrality>();
  const hubThreshold = Math.max(1, Math.floor(totalNodes * 0.15)); // Top 15%

  for (let r = 0; r < results.length; r++) {
    const item = results[r];
    item.rank = r + 1;

    if (r < hubThreshold || item.inDegree >= 4 || item.score >= 0.70) {
      item.isHub = true;
      if (r < Math.max(1, Math.floor(totalNodes * 0.05)) || item.score >= 0.85) {
        item.hubBadge = "🔥 CRITICAL CORE HUB (Top 5%)";
      } else {
        item.hubBadge = "⚡ ARCHITECTURAL HUB";
      }
    }

    scoreMap.set(item.nodeId, item);
    scoreMap.set(item.name, item);
    if (item.filePath) {
      scoreMap.set(item.filePath, item);
    }
  }

  const overview: CentralityOverview = {
    totalNodes,
    totalEdges,
    topHubs: results.filter(r => r.isHub).slice(0, 15),
    scores: scoreMap,
  };

  _cachedCentrality = { timestamp: now, data: overview };
  return overview;
}

/**
 * Get centrality info for a specific node, symbol, or file path.
 */
export async function getNodeCentrality(target: string): Promise<NodeCentrality | null> {
  const overview = await computeGraphCentrality();
  return overview.scores.get(target) || null;
}

/**
 * Format a centrality warning for impact analysis if target is a core hub.
 */
export async function formatCentralityWarning(target: string): Promise<string | null> {
  const c = await getNodeCentrality(target);
  if (!c || !c.isHub) return null;

  return [
    `⚠️ **${c.hubBadge || "ARCHITECTURAL HUB"}** [Centrality: ${(c.score * 100).toFixed(0)}% · Rank #${c.rank}/${c.totalNodes}]`,
    `   ${c.inDegree} incoming caller(s)/dependent(s). Edits here ripple widely across the system.`,
  ].join("\n");
}
