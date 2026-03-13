use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_scanned_at: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRecord {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub runtime_type: String,
    pub framework_type: String,
    pub expected_port: Option<u16>,
    pub detected_port: Option<u16>,
    pub start_command: Option<String>,
    pub status: String,
    pub pid: Option<u32>,
    pub uptime_seconds: u64,
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub gpu_percent: Option<f64>,
    pub gpu_memory_bytes: Option<u64>,
    pub last_signal: String,
    pub tags: Vec<String>,
    pub source: String,
    pub issue: Option<ServiceActionIssue>,
    pub port_conflict: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogEntry {
    pub sequence: u64,
    pub timestamp: String,
    pub stream: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogSnapshot {
    pub service_id: String,
    pub entries: Vec<ServiceLogEntry>,
    pub dropped_entries: u64,
    pub last_updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExecutionRecord {
    pub id: String,
    pub service_id: String,
    pub trigger_action: String,
    pub command_line: String,
    pub pid: Option<u32>,
    pub detected_port: Option<u16>,
    pub status: String,
    pub started_at: Option<String>,
    pub stopped_at: Option<String>,
    pub duration_seconds: Option<f64>,
    pub last_signal: String,
    pub issue: Option<ServiceActionIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExecutionHistorySnapshot {
    pub service_id: String,
    pub entries: Vec<ServiceExecutionRecord>,
    pub last_updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ScriptRecord {
    pub id: String,
    pub service_id: String,
    pub service_name: String,
    pub name: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ProfilePreset {
    pub id: String,
    pub label: String,
    pub vus: u32,
    pub duration: String,
    pub rate: Option<u32>,
    pub thresholds: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6BinaryStatus {
    pub is_available: bool,
    pub resolved_path: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ThresholdValidation {
    pub expression: String,
    pub is_valid: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ValidationResult {
    pub is_valid: bool,
    pub binary: K6BinaryStatus,
    pub thresholds: Vec<K6ThresholdValidation>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6LabSnapshot {
    pub scripts: Vec<K6ScriptRecord>,
    pub profiles: Vec<K6ProfilePreset>,
    pub binary: K6BinaryStatus,
    pub preferences: K6LabPreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct K6LabPreferences {
    pub selected_service_id: Option<String>,
    pub script_id: Option<String>,
    pub profile_id: String,
    pub vus: u32,
    pub duration: String,
    pub rate: Option<u32>,
    #[serde(default)]
    pub thresholds: Vec<String>,
    #[serde(default)]
    pub k6_binary_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunRecord {
    pub id: String,
    pub service_id: String,
    pub service_name: String,
    pub script_id: String,
    pub script_name: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub warning_service_stopped: bool,
    pub raw_result_path: Option<String>,
    pub summary_export_path: Option<String>,
    pub command_line: String,
    pub configured_duration_seconds: f64,
    pub elapsed_seconds: f64,
    pub progress_percent: f64,
    pub summary_metrics: Option<K6RunSummaryMetrics>,
    pub external_dashboard_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunSnapshot {
    pub active_run: Option<K6RunRecord>,
    pub latest_run: Option<K6RunRecord>,
    pub history: Vec<K6RunRecord>,
    pub latest_report: Option<K6RunReport>,
    pub output_entries: Vec<ServiceLogEntry>,
    pub dropped_output_entries: u64,
    pub last_updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunSummaryMetrics {
    pub latency_avg_ms: Option<f64>,
    pub latency_p95_ms: Option<f64>,
    pub latency_p99_ms: Option<f64>,
    pub requests_per_second: Option<f64>,
    pub error_rate: Option<f64>,
    pub active_vus: Option<f64>,
    pub duration_seconds: f64,
    pub checks_pass: u64,
    pub checks_fail: u64,
    pub checks_pass_rate: Option<f64>,
    pub thresholds: Vec<K6ThresholdResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ThresholdResult {
    pub expression: String,
    pub status: String,
    pub actual_value: Option<f64>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6MetricPoint {
    pub timestamp: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunCharts {
    pub latency_avg_ms: Vec<K6MetricPoint>,
    pub latency_p95_ms: Vec<K6MetricPoint>,
    pub latency_p99_ms: Vec<K6MetricPoint>,
    pub requests_per_second: Vec<K6MetricPoint>,
    pub error_rate: Vec<K6MetricPoint>,
    pub vus_active: Vec<K6MetricPoint>,
    pub checks_pass_rate: Vec<K6MetricPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunReport {
    pub run: K6RunRecord,
    pub summary: K6RunSummaryMetrics,
    pub charts: K6RunCharts,
    pub external_dashboard_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_total_percent: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub gpu_total_percent: Option<f64>,
    pub last_refresh_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub workspaces: Vec<Workspace>,
    pub services: Vec<ServiceRecord>,
    pub system: SystemMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub default_workspace_root: String,
    #[serde(default)]
    pub default_log_export_root: String,
    #[serde(default)]
    pub allowed_shells: Vec<String>,
    #[serde(default)]
    pub preferred_shell: String,
    pub dashboard_refresh_seconds: u32,
    pub realtime_refresh_seconds: u32,
    pub theme: String,
    pub gpu_mode: String,
    #[serde(default)]
    pub k6_binary_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualServiceDraft {
    pub name: String,
    pub path: String,
    pub runtime_type: String,
    pub framework_type: String,
    pub expected_port: Option<u16>,
    pub start_command: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ScriptDraft {
    pub service_id: String,
    pub path: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct K6ValidationRequest {
    pub k6_binary_path: Option<String>,
    pub vus: u32,
    pub duration: String,
    pub rate: Option<u32>,
    #[serde(default)]
    pub thresholds: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunRequest {
    pub service_id: String,
    pub script_id: String,
    pub profile_id: String,
    pub vus: u32,
    pub duration: String,
    pub rate: Option<u32>,
    #[serde(default)]
    pub thresholds: Vec<String>,
    pub k6_binary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionIssue {
    pub service_id: String,
    pub code: String,
    pub title: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionResponse {
    pub snapshot: DashboardSnapshot,
    pub issue: Option<ServiceActionIssue>,
}

pub type RunServiceResponse = ServiceActionResponse;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K6RunActionResponse {
    pub snapshot: K6RunSnapshot,
    pub issue: Option<ServiceActionIssue>,
}
