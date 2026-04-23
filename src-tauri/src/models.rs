use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type ServiceKind = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceNodeLayout {
    pub x: f64,
    pub y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeTelemetryViewModel {
    pub requests_per_second: Option<f64>,
    pub average_latency_ms: Option<f64>,
    pub p95_latency_ms: Option<f64>,
    pub error_rate_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTopologyEdge {
    pub id: String,
    pub source_service_id: String,
    pub target_service_id: String,
    pub label: Option<String>,
    pub telemetry: Option<EdgeTelemetryViewModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTopology {
    pub project_id: String,
    pub node_layouts: HashMap<String, ServiceNodeLayout>,
    pub edges: Vec<ProjectTopologyEdge>,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Core domain
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microservice {
    pub id: String,
    pub project_id: String,
    pub kind: ServiceKind,
    pub name: String,
    pub working_directory: String,
    pub start_command: String,
    pub expected_port: Option<u16>,
    pub detected_port: Option<u16>,
    pub status: String,
    pub pid: Option<u32>,
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub has_log_error: bool,
    pub last_signal: String,
    pub issue: Option<ServiceActionIssue>,
    pub port_conflict: bool,
    pub graph: Option<ServiceNodeLayout>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// System metrics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_total_percent: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub last_refresh_at: String,
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub projects: Vec<Project>,
    pub services: Vec<Microservice>,
    pub system: SystemMetrics,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub dashboard_refresh_seconds: u32,
    pub realtime_refresh_seconds: u32,
}

// ---------------------------------------------------------------------------
// Drafts (input from frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDraft {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroserviceDraft {
    pub project_id: String,
    pub kind: ServiceKind,
    pub name: String,
    pub working_directory: String,
    pub start_command: String,
    #[serde(default)]
    pub expected_port: Option<u16>,
}

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

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
pub struct PortKillResponse {
    pub snapshot: DashboardSnapshot,
    pub port: u16,
    pub killed_pids: Vec<u32>,
    pub matched_service_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyEndpointResponse {
    pub status: u16,
    pub body: String,
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/// Payload del evento `service-log-line` emitido por los hilos lectores
/// de stdout/stderr por cada nueva línea capturada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogLineEvent {
    pub service_id: String,
    pub entry: ServiceLogEntry,
}
