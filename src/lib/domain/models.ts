export type ServiceStatus = "running" | "stopped" | "starting" | "error" | "external";
export type ServiceKind = "service" | "worker";

export interface ServiceNodeLayout {
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  collapsed?: boolean;
}

export interface EdgeTelemetryViewModel {
  requestsPerSecond?: number | null;
  averageLatencyMs?: number | null;
  p95LatencyMs?: number | null;
  errorRatePercent?: number | null;
}

export interface ProjectTopologyEdge {
  id: string;
  sourceServiceId: string;
  targetServiceId: string;
  label?: string | null;
  telemetry?: EdgeTelemetryViewModel | null;
}

export interface ProjectTopology {
  projectId: string;
  nodeLayouts: Record<string, ServiceNodeLayout>;
  edges: ProjectTopologyEdge[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Core domain
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface Microservice {
  id: string;
  projectId: string;
  kind: ServiceKind;
  name: string;
  workingDirectory: string;
  startCommand: string;
  expectedPort: number | null;
  detectedPort: number | null;
  status: ServiceStatus;
  pid: number | null;
  cpuPercent: number;
  memoryBytes: number;
  hasLogError: boolean;
  lastSignal: string;
  issue: ServiceActionIssue | null;
  portConflict: boolean;
  graph: ServiceNodeLayout | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export interface ServiceLogEntry {
  sequence: number;
  timestamp: string;
  stream: "stdout" | "stderr";
  level: "error" | "warn" | "info" | "debug" | "trace";
  message: string;
}

export interface ServiceLogSnapshot {
  serviceId: string;
  entries: ServiceLogEntry[];
  droppedEntries: number;
  lastUpdatedAt: string;
}

// ---------------------------------------------------------------------------
// System metrics
// ---------------------------------------------------------------------------

export interface SystemMetrics {
  cpuTotalPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  lastRefreshAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardSnapshot {
  projects: Project[];
  services: Microservice[];
  system: SystemMetrics;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  dashboardRefreshSeconds: number;
  realtimeRefreshSeconds: number;
}

// ---------------------------------------------------------------------------
// Drafts (input from UI)
// ---------------------------------------------------------------------------

export interface ProjectDraft {
  name: string;
}

export interface MicroserviceDraft {
  projectId: string;
  kind: ServiceKind;
  name: string;
  workingDirectory: string;
  startCommand: string;
  expectedPort?: number | null;
}

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

export interface ServiceActionIssue {
  serviceId: string;
  code: string;
  title: string;
  message: string;
  detail?: string | null;
}

export interface ServiceActionResponse {
  snapshot: DashboardSnapshot;
  issue: ServiceActionIssue | null;
}

export type RunServiceResponse = ServiceActionResponse;

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface ServiceLogLineEvent {
  serviceId: string;
  entry: ServiceLogEntry;
}

export interface NodeTelemetryViewModel {
  nodeId: string;
  status: ServiceStatus;
  pressureScore: number;
  pressureTone: "healthy" | "warning" | "pressure" | "critical" | "idle";
  cpuPercent: number;
  memoryBytes: number;
  hasLogError: boolean;
}
