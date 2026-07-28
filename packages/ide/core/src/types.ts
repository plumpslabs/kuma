// ============================================================
// KUMA IDE CORE — Type Definitions
// ============================================================

export interface KumaNode {
  id: number;
  name: string;
  type: string;
  metadata: string; // JSON string
  created_at: number;
  updated_at: number;
}

export interface KumaEdge {
  id: number;
  source_node_id: number;
  target_node_id: number;
  relationship: string;
  metadata: string;
  created_at: number;
}

export interface KumaGotcha {
  id: number;
  file_path: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  workaround: string | null;
  added_by: string;
  created_at: number;
  updated_at: number;
}

export interface KumaTrajectory {
  id: number;
  goal: string;
  steps: string; // JSON array
  total_duration_ms: number;
  success_rate: number;
  complexity: number;
  created_at: number;
}

export interface KumaDistilledSkill {
  id: number;
  name: string;
  description: string;
  pattern: string;
  parameters: string;
  success_count: number;
  avg_duration_ms: number;
  source_trajectory_id: number | null;
  last_used_at: number | null;
  created_at: number;
}

export interface KumaCheckpoint {
  id: number;
  label: string;
  description: string;
  file_path: string;
  created_at: number;
}

export interface KumaBlackboardEvent {
  id: number;
  type: string;
  source: string;
  topic: string;
  payload: string;
  severity: "info" | "warning" | "critical";
  tags: string;
  created_at: number;
}

export interface KumaSecurityFinding {
  id: number;
  check_name: string;
  severity: string;
  description: string;
  file_path: string | null;
  remediated: number;
  created_at: number;
}

export interface KumaHealthSnapshot {
  id: number;
  score: number;
  details: string;
  created_at: number;
}

export interface KumaDriftRecord {
  id: number;
  file_path: string;
  table_name: string;
  record_id: number;
  expected_hash: string;
  actual_hash: string;
  created_at: number;
}

export interface KumaGraphExport {
  nodes: KumaNode[];
  edges: KumaEdge[];
  mermaid: string;
}

export interface KumaDashboardData {
  graph: KumaGraphExport;
  gotchas: KumaGotcha[];
  trajectories: KumaTrajectory[];
  skills: KumaDistilledSkill[];
  checkpoints: KumaCheckpoint[];
  blackboardEvents: KumaBlackboardEvent[];
  securityFindings: KumaSecurityFinding[];
  driftRecords: KumaDriftRecord[];
  healthScore: number | null;
  nodeCount: number;
  edgeCount: number;
}

export interface KumaDbStats {
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
}
