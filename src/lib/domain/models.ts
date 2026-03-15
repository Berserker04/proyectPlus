export type ServiceStatus = "running" | "stopped" | "starting" | "error" | "external";

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
  name: string;
  workingDirectory: string;
  startCommand: string;
  expectedPort: number | null;
  detectedPort: number | null;
  status: ServiceStatus;
  pid: number | null;
  cpuPercent: number;
  memoryBytes: number;
  lastSignal: string;
  issue: ServiceActionIssue | null;
  portConflict: boolean;
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
  name: string;
  workingDirectory: string;
  startCommand: string;
  expectedPort: number | null;
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
