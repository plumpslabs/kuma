// ============================================================
// Module declaration for @kuma/ide-core
// ============================================================
// This allows TypeScript to resolve the dynamic import without
// needing tsconfig paths or compiling core source files.
// The actual module is resolved at runtime via pnpm workspace.

declare module "@kuma/ide-core" {
  export function openDb(root?: string): Promise<{ db: any; dbPath: string }>;
  export function findKumaDb(root?: string): string;
  export function hasKumaDb(root?: string): boolean;
  export function getDbStats(root?: string): Promise<{
    dbSizeBytes: number;
    dbPath: string;
    nodeCount: number;
    edgeCount: number;
    gotchaCount: number;
    trajectoryCount: number;
    checkpointCount: number;
    blackboardCount: number;
    securityCount: number;
    driftCount: number;
  }>;
  export function loadDashboard(
    db: any,
    opts?: { maxGraphNodes?: number }
  ): any;
  export function getStatusReport(db: any): string;
  export function computeHealthScore(db: any): number;
  export function getGraphExport(
    db: any,
    opts?: { maxNodes?: number }
  ): { nodes: any[]; edges: any[]; mermaid: string };
  export function getNodes(db: any): any[];
  export function getEdges(db: any): any[];
  export function getGotchas(
    db: any,
    opts?: { filePath?: string; severity?: string }
  ): any[];
  export function getTrajectories(db: any, limit?: number): any[];
  export function getSkills(db: any): any[];
  export function getCheckpoints(db: any): any[];
  export function getBlackboardEvents(
    db: any,
    opts?: { limit?: number; severity?: string; topic?: string }
  ): any[];
  export function getSecurityFindings(db: any): any[];
  export function getDriftRecords(db: any): any[];
}
