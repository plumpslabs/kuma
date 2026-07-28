# @kuma/ide-core

Core TypeScript library for Kuma IDE extensions. Reads `.kuma/kuma.db` (SQLite) and provides structured data for knowledge graph, gotchas, trajectories, checkpoints, drift, blackboard events, and security findings.

## Usage

```ts
import { openDb, loadDashboard, getGraphExport, getStatusReport } from "@kuma/ide-core";

// Open Kuma database
const { db, dbPath } = await openDb("/path/to/project");

try {
  // Load everything at once
  const dashboard = loadDashboard(db);
  console.log(`Health Score: ${dashboard.healthScore}`);
  console.log(`Nodes: ${dashboard.nodeCount}, Edges: ${dashboard.edgeCount}`);

  // Or load specific data
  const graph = getGraphExport(db);
  console.log(graph.mermaid); // Mermaid diagram code

  const report = getStatusReport(db);
  console.log(report);
} finally {
  db.close();
}
```

## API

| Function | Returns | Description |
|----------|---------|-------------|
| `openDb(root?)` | `{ db, dbPath }` | Open read-only SQLite connection |
| `findKumaDb(root?)` | `string` | Find .kuma/kuma.db path |
| `hasKumaDb(root?)` | `boolean` | Check if DB exists |
| `getDbStats(root?)` | `KumaDbStats` | DB file size + counts |
| `loadDashboard(db, opts?)` | `KumaDashboardData` | All data at once |
| `getGraphExport(db)` | `KumaGraphExport` | Nodes + edges + Mermaid |
| `getNodes(db)` | `KumaNode[]` | All knowledge graph nodes |
| `getEdges(db)` | `KumaEdge[]` | All knowledge graph edges |
| `searchNodes(db, q)` | `KumaNode[]` | Search nodes by name/type |
| `getGotchas(db, opts?)` | `KumaGotcha[]` | Gotchas with filters |
| `getTrajectories(db)` | `KumaTrajectory[]` | Recent trajectories |
| `getSkills(db)` | `KumaDistilledSkill[]` | Distilled skills |
| `getCheckpoints(db)` | `KumaCheckpoint[]` | All checkpoints |
| `getBlackboardEvents(db)` | `KumaBlackboardEvent[]` | Recent events |
| `getSecurityFindings(db)` | `KumaSecurityFinding[]` | All security findings |
| `getDriftRecords(db)` | `KumaDriftRecord[]` | Drift detection records |
| `computeHealthScore(db)` | `number` | 0-100 health score |
| `getStatusReport(db)` | `string` | Formatted ASCII report |

## Dependencies

- `sql.js` (WASM SQLite) — for reading `.kuma/kuma.db`
