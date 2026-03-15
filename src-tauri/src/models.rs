use serde::{Deserialize, Serialize};

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
    pub name: String,
    pub working_directory: String,
    pub start_command: String,
    pub expected_port: Option<u16>,
    pub detected_port: Option<u16>,
    pub status: String,
    pub pid: Option<u32>,
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub last_signal: String,
    pub issue: Option<ServiceActionIssue>,
    pub port_conflict: bool,
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
    pub name: String,
    pub working_directory: String,
    pub start_command: String,
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
