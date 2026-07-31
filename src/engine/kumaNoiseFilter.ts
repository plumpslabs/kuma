// ============================================================
// KUMA NOISE FILTER — Anti-AST Guard (Pilar 4)
// ============================================================
// Prevents graph pollution by rejecting low-value node types.
// Only allows high-value node types that provide real signal.
// ============================================================

/**
 * Allowed high-value node types for the knowledge graph.
 * All other types (function, class, component, variable, etc.) are rejected.
 */
export const ALLOWED_NODE_TYPES = new Set([
  "arch_flow",           // Architecture flow (Layer 2)
  "gotcha",              // Known gotchas / edge cases (Layer 3)
  "decision",            // Architecture decisions / ADRs
  "cross_service_link",  // Backend ↔ Frontend integration links
  "feature_domain",      // High-level feature domains
  "file",                // File references (needed for graph connectivity)
  "research",            // Research cache nodes (needed for search)
  "flow_explanation",    // Prose explanation of arch_flow (semantic layer)
]);

/**
 * Node types that are considered "noise" — AST-level nodes that
 * pollute the graph without providing useful context.
 */
export const NOISE_NODE_TYPES = new Set([
  "function",
  "class",
  "component",
  "variable",
  "method",
  "interface",
  "type",
  "enum",
  "const",
  "hook",
  "route",
  "api_route",
  "test",
]);

/**
 * Check if a node type is allowed in the knowledge graph.
 * Returns true if the type is in the allowed set, false otherwise.
 */
export function isNodeTypeAllowed(type: string): boolean {
  return ALLOWED_NODE_TYPES.has(type);
}

/**
 * Check if a node type is considered noise.
 */
export function isNoiseType(type: string): boolean {
  return NOISE_NODE_TYPES.has(type);
}

/**
 * Filter a list of node creation requests, keeping only allowed types.
 * Returns { allowed, rejected } arrays.
 */
export function filterNodeCreation(
  nodes: Array<{ type: string; name: string; [key: string]: unknown }>
): {
  allowed: Array<{ type: string; name: string; [key: string]: unknown }>;
  rejected: Array<{ type: string; name: string; reason: string }>;
} {
  const allowed: Array<{ type: string; name: string; [key: string]: unknown }> = [];
  const rejected: Array<{ type: string; name: string; reason: string }> = [];

  for (const node of nodes) {
    if (isNodeTypeAllowed(node.type)) {
      allowed.push(node);
    } else if (isNoiseType(node.type)) {
      rejected.push({
        type: node.type,
        name: node.name,
        reason: `Type "${node.type}" is noise — use arch_flow, gotcha, decision, or cross_service_link instead`,
      });
    } else {
      // Unknown type — allow but warn
      allowed.push(node);
    }
  }

  return { allowed, rejected };
}

/**
 * Get a human-readable explanation of the noise filter policy.
 */
export function getNoiseFilterPolicy(): string {
  return [
    "🧹 **Kuma Noise Filter — Anti-AST Guard**",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "**Allowed High-Value Node Types:**",
    "  🏛️ `arch_flow` — Architecture flow (max 5 core files per flow)",
    "  📌 `gotcha` — Known bugs, edge cases, gotchas",
    "  ⚖️ `decision` — Architecture decisions / ADRs",
    "  🔗 `cross_service_link` — Backend ↔ Frontend integration links",
    "  🏗️ `feature_domain` — High-level feature domains",
    "  📄 `file` — File references (graph connectivity)",
    "  🔬 `research` — Research cache nodes",
    "",
    "**Rejected Noise Types:**",
    "  ❌ `function`, `class`, `component`, `variable`, `method`",
    "  ❌ `interface`, `type`, `enum`, `const`, `hook`",
    "  ❌ `route`, `api_route`, `test`",
    "",
    "**Why?** AST-level nodes create graph junk that slows retrieval.",
    "Use `arch_flow` to describe HOW files connect, not individual functions.",
    "",
    "**Tip:** Instead of adding function nodes, record an `arch_flow`:",
    "  kuma_memory({ action: 'arch_flow', content: 'domain: AuthFlow | hops: auth.ts → middleware.ts → session.ts' })",
  ].join("\n");
}
