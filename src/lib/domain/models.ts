export type ServiceStatus = "running" | "stopped" | "starting" | "error";
export type AppTheme = "midnight" | "ember" | "arctic";
export type GpuMode = "auto" | "disabled" | "nvidia";
export type AppSettingsPathKind = "workspaceRoot" | "logExportRoot" | "k6BinaryFile";

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastScannedAt: string | null;
  isActive: boolean;
}

export interface ServiceRecord {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  createdAt: string;
  runtimeType: string;
  frameworkType: string;
  expectedPort: number | null;
  detectedPort: number | null;
  startCommand: string | null;
  status: ServiceStatus;
  pid: number | null;
  uptimeSeconds: number;
  cpuPercent: number;
  memoryBytes: number;
  gpuPercent: number | null;
  gpuMemoryBytes: number | null;
  lastSignal: string;
  tags: string[];
  source: "autodiscovery" | "manifest";
  issue: ServiceActionIssue | null;
  portConflict: boolean;
}

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

export interface ServiceExecutionRecord {
  id: string;
  serviceId: string;
  triggerAction: string;
  commandLine: string;
  pid: number | null;
  detectedPort: number | null;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
  durationSeconds: number | null;
  lastSignal: string;
  issue: ServiceActionIssue | null;
}

export interface ServiceExecutionHistorySnapshot {
  serviceId: string;
  entries: ServiceExecutionRecord[];
  lastUpdatedAt: string;
}

export interface K6ScriptRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  name: string;
  path: string;
  source: "autodiscovery" | "manual";
}

export interface K6ProfilePreset {
  id: string;
  label: string;
  vus: number;
  duration: string;
  rate: number | null;
  thresholds: string[];
}

export interface K6BinaryStatus {
  isAvailable: boolean;
  resolvedPath: string | null;
  detail: string;
}

export interface K6ThresholdValidation {
  expression: string;
  isValid: boolean;
  detail: string;
}

export interface K6ValidationResult {
  isValid: boolean;
  binary: K6BinaryStatus;
  thresholds: K6ThresholdValidation[];
  issues: string[];
}

export interface K6LabSnapshot {
  scripts: K6ScriptRecord[];
  profiles: K6ProfilePreset[];
  binary: K6BinaryStatus;
  preferences: K6LabPreferences;
}

export interface K6LabPreferences {
  selectedServiceId: string | null;
  scriptId: string | null;
  profileId: string;
  vus: number;
  duration: string;
  rate: number | null;
  thresholds: string[];
  k6BinaryPath: string;
}

export interface K6RunRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  scriptId: string;
  scriptName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  pid: number | null;
  exitCode: number | null;
  warningServiceStopped: boolean;
  rawResultPath: string | null;
  summaryExportPath: string | null;
  commandLine: string;
  configuredDurationSeconds: number;
  elapsedSeconds: number;
  progressPercent: number;
  summaryMetrics: K6RunSummaryMetrics | null;
  externalDashboardUrl: string | null;
}

export interface K6RunSnapshot {
  activeRun: K6RunRecord | null;
  latestRun: K6RunRecord | null;
  history: K6RunRecord[];
  latestReport: K6RunReport | null;
  outputEntries: ServiceLogEntry[];
  droppedOutputEntries: number;
  lastUpdatedAt: string;
}

export interface K6RunSummaryMetrics {
  latencyAvgMs: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  requestsPerSecond: number | null;
  errorRate: number | null;
  activeVus: number | null;
  durationSeconds: number;
  checksPass: number;
  checksFail: number;
  checksPassRate: number | null;
  thresholds: K6ThresholdResult[];
}

export interface K6ThresholdResult {
  expression: string;
  status: string;
  actualValue: number | null;
  detail: string;
}

export interface K6MetricPoint {
  timestamp: string;
  value: number;
}

export interface K6RunCharts {
  latencyAvgMs: K6MetricPoint[];
  latencyP95Ms: K6MetricPoint[];
  latencyP99Ms: K6MetricPoint[];
  requestsPerSecond: K6MetricPoint[];
  errorRate: K6MetricPoint[];
  vusActive: K6MetricPoint[];
  checksPassRate: K6MetricPoint[];
}

export interface K6RunReport {
  run: K6RunRecord;
  summary: K6RunSummaryMetrics;
  charts: K6RunCharts;
  externalDashboardUrl: string | null;
}

export interface SystemMetrics {
  cpuTotalPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  gpuTotalPercent: number | null;
  lastRefreshAt: string;
}

export interface DashboardSnapshot {
  workspaces: Workspace[];
  services: ServiceRecord[];
  system: SystemMetrics;
}

export interface AppSettings {
  defaultWorkspaceRoot: string;
  defaultLogExportRoot: string;
  allowedShells: string[];
  preferredShell: string;
  dashboardRefreshSeconds: number;
  realtimeRefreshSeconds: number;
  theme: AppTheme;
  gpuMode: GpuMode;
  k6BinaryPath: string;
}

export interface ManualServiceDraft {
  name: string;
  path: string;
  runtimeType: string;
  frameworkType: string;
  expectedPort: number | null;
  startCommand: string;
  tags: string[];
  env: Record<string, string>;
}

export interface K6ScriptDraft {
  serviceId: string;
  path: string;
  name?: string | null;
}

export interface K6ValidationRequest {
  k6BinaryPath?: string | null;
  vus: number;
  duration: string;
  rate?: number | null;
  thresholds: string[];
}

export interface K6RunRequest {
  serviceId: string;
  scriptId: string;
  profileId: string;
  vus: number;
  duration: string;
  rate?: number | null;
  thresholds: string[];
  k6BinaryPath?: string | null;
}

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

export interface K6RunActionResponse {
  snapshot: K6RunSnapshot;
  issue: ServiceActionIssue | null;
}
