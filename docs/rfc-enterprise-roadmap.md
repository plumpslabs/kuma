# RFC: Enterprise Roadmap — Distributed Knowledge Graph, AST Regression Guardrails & OpenTelemetry

**Status:** Proposed · **Author:** Kuma Team · **Date:** 2026-07-27 · **Issue:** #11

---

## Summary

This RFC proposes four enterprise-grade capabilities to evolve Kuma from a per-developer
agent safety toolkit into a team-wide AI Agent Safety & Observability Platform.

---

## 1. Distributed Knowledge Graph Sync

### Problem
Today, `kuma.db` is a single SQLite file per project. Team members working on the same
codebase each build an isolated knowledge graph — no shared memory, no cross-session
pattern propagation, no team-level learning.

### Proposed Solution
Support optional remote backend sync for the knowledge graph:

- **PostgreSQL** — Recommended for teams already using Postgres. Full SQL access,
  row-level security, standard tooling.
- **Redis** — In-memory graph cache for teams needing fast ephemeral sync.
- **Neo4j** — Native graph database for teams with complex relationship queries.

### Config
```json
{
  "kuma": {
    "sync": {
      "backend": "postgresql",
      "connection_string": "postgresql://user:pass@host:5432/kuma",
      "sync_interval_seconds": 60,
      "sync_mode": "bidirectional"
    }
  }
}
```

### Implementation Plan
1. Define `SyncBackend` interface with `read()`, `write()`, `diff()` methods
2. Implement Postgres adapter using `pg` driver
3. Implement Redis adapter using `ioredis`
4. Implement Neo4j adapter using `neo4j-driver`
5. Add config parsing from `.kumarc.json` or environment variables
6. Background sync worker (configurable interval)

---

## 2. AST-Based Semantic Regression Guardrails

### Problem
Current `kuma_safety` guard uses text-based diff pattern matching to detect regressions.
This misses semantic breaking changes like:
- Function signature changes (parameter renames, type changes)
- Interface/type contract violations
- Async → sync conversion breaking callers
- Return type changes that pass text diff but break TypeScript

### Proposed Solution
Integrate lightweight AST parsing into `kuma_safety`:

- **TypeScript/JavaScript**: Use `typescript` compiler API to compare AST nodes
- **Go**: Use `go/ast` package  
- **Rust**: Use `syn` crate
- **Python**: Use `ast` module

### Detection Capabilities
- **Function Signature Changes**: Parameter count, type, optionality
- **Export Contract Changes**: Missing exports, renamed exports
- **Type Changes**: Return types, property types
- **Interface Compliance**: Missing implements members

### Implementation Plan
1. Create `src/engine/astDetector.ts` — AST comparison engine
2. Integrate with `kuma_safety({ action: 'guard', check: 'regression' })`
3. Cache parsed ASTs in `file_summaries` table with content_hash invalidation

---

## 3. OpenTelemetry (OTel) & Observability Integration

### Problem
Kuma generates rich telemetry (tool calls, safety scores, decision logs, audit trail)
but has no way to export it to standard observability platforms.

### Proposed Solution
Export Kuma telemetry via OpenTelemetry protocol (OTLP):

- **Traces**: Tool call execution flows with duration, success/failure, safety decisions
- **Metrics**: Safety scores over time, anti-pattern frequency, verification pass rates
- **Logs**: Audit trail entries, decision logs, security findings

### Export Targets
- **Prometheus + Grafana** — Open-source, self-hosted
- **Datadog** — Commercial APM
- **New Relic** — Commercial observability
- **Honeycomb** — Observability for high-cardinality events

### Implementation Plan
1. Add `@opentelemetry/api` and `@opentelemetry/exporter-otlp-proto` as optional deps
2. Create `src/engine/otelExporter.ts` — batched export of traces/metrics/logs
3. Add config: `kuma_otel_{endpoint,service_name,enabled}`
4. Wire into `kumaSafetyProxy.ts` — auto-export on every tool call

### DB Schema
```sql
CREATE TABLE IF NOT EXISTS otel_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT,
    service_name TEXT DEFAULT 'kuma',
    enabled INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

---

## 4. Real-Time Token & Cost Guardrails (Cost Shield)

### Problem
AI agent sessions can consume excessive tokens with no budget awareness, leading to
surprise costs in API-based workflows.

### Proposed Solution
Implement per-session and per-task cost/token budgets:

- **Token Estimation**: Approximate token count per tool call (input + output)
- **Budget Thresholds**: Configurable per-session and per-task limits
- **Escalation**: Auto-pause agent when budget exceeded, with optional override
- **Alerting**: Console warnings at 50%, 75%, 90%, and 100% of budget

### Config
```json
{
  "kuma": {
    "cost_shield": {
      "enabled": true,
      "session_budget": 100000,
      "task_budget": 25000,
      "action": "warn"  // "warn" | "pause" | "block"
    }
  }
}
```

### Implementation Plan
1. Create `src/engine/costShield.ts` — token estimation + budget tracking
2. Add `cost_tracking` DB table
3. Wire into `kumaRouter.ts` — check budget before every tool call
4. Add `kuma_safety cost` action for budget status queries

### DB Schema
```sql
CREATE TABLE IF NOT EXISTS cost_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    tool_name TEXT NOT NULL,
    token_estimate INTEGER DEFAULT 0,
    cost_estimate REAL DEFAULT 0.0,
    budget_limit REAL DEFAULT 0.0,
    escalated INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

---

## Migration Path

| Phase | Features | Effort | Impact |
|-------|----------|--------|--------|
| **Phase 1** | OTel config table + Cost tracking schema | Low | Foundation |
| **Phase 2** | OTel exporter + Basic cost tracking | Medium | Observability |
| **Phase 3** | AST guardrails for TS/JS | Medium | Better safety |
| **Phase 4** | Distributed sync (Postgres adapter) | High | Team sharing |
| **Phase 5** | Distributed sync (Redis + Neo4j) | High | Multi-backend |
| **Phase 6** | Cost Shield with auto-pause | Medium | Cost control |

---

## Open Questions

1. Should distributed sync be push-based (agent-initiated) or pull-based (background worker)?
2. Should AST guardrails be pluggable per language (language-server-protocol based)?
3. Should OTel export be synchronous (blocking) or asynchronous (background queue)?
4. Should Cost Shield support team-level budget pooling?

---

*This RFC is a planning document. See individual issues for implementation tracking.*
