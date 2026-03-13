use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Read},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use chrono::{DateTime, Timelike, Utc};
use rfd::FileDialog;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

use crate::models::{
    AppSettings, DashboardSnapshot, K6BinaryStatus, K6LabPreferences, K6LabSnapshot,
    K6MetricPoint, K6ProfilePreset, K6RunActionResponse, K6RunCharts, K6RunRecord,
    K6RunReport, K6RunRequest, K6RunSnapshot, K6RunSummaryMetrics, K6ScriptDraft,
    K6ScriptRecord, K6ThresholdResult, K6ThresholdValidation, K6ValidationRequest,
    K6ValidationResult, ManualServiceDraft, RunServiceResponse, ServiceActionIssue,
    ServiceActionResponse, ServiceExecutionHistorySnapshot, ServiceExecutionRecord,
    ServiceLogEntry, ServiceLogSnapshot, ServiceRecord, SystemMetrics, Workspace,
};

const INIT_SQL: &str = include_str!("../sql/001_init.sql");
const MANIFEST_DIRECTORY_NAME: &str = ".ms-control-center";
const MANIFEST_FILE_NAME: &str = "services.manifest.json";
const STARTUP_PORT_TIMEOUT: Duration = Duration::from_secs(8);
const DEFAULT_LAST_SIGNAL: &str = "Catalog restored from local metadata";
const MAX_LOG_ENTRIES: usize = 1_500;
const ALLOWED_SERVICE_LAUNCHERS: &[&str] = &[
    "npm",
    "npx",
    "pnpm",
    "pnpx",
    "yarn",
    "yarnpkg",
    "bun",
    "bunx",
    "node",
    "nest",
    "nx",
    "turbo",
    "cross-env",
    "cross-env-shell",
    "nodemon",
    "ts-node",
    "tsx",
];
const USER_PREFERENCE_SCOPE_GLOBAL: &str = "global";
const USER_PREFERENCE_SCOPE_WORKSPACE: &str = "workspace";
const USER_PREFERENCE_KEY_APP_SETTINGS: &str = "app_settings";
const USER_PREFERENCE_KEY_K6_LAB_CONTEXT: &str = "k6_lab_context";
const USER_PREFERENCE_KEY_K6_BINARY_PATH: &str = "k6_binary_path";

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No se pudo resolver el directorio de datos de la aplicacion.")]
    MissingAppDataDir,
    #[error("No hay un workspace activo para reescanear.")]
    NoActiveWorkspace,
    #[error("El workspace ya no existe en disco: {0}")]
    MissingWorkspace(String),
    #[error("La ruta del servicio ya no existe en disco: {0}")]
    MissingServicePath(String),
    #[error("No se pudo calcular una ruta relativa para {0}.")]
    RelativePath(String),
    #[error("No se pudo validar la ruta del servicio manual: {0}.")]
    InvalidManualServicePath(String),
    #[error("El nombre del servicio manual no puede estar vacio.")]
    InvalidManualServiceName,
    #[error("El comando de arranque manual no puede estar vacio.")]
    InvalidManualStartCommand,
    #[error("El comando de arranque no esta permitido: {0}.")]
    DisallowedStartCommand(String),
    #[error("No se pudo validar la ruta del script k6: {0}.")]
    InvalidK6ScriptPath(String),
    #[error("La ruta del script k6 debe estar dentro del workspace activo.")]
    InvalidK6ScriptWorkspaceBoundary,
    #[error("El path del binario k6 no puede estar vacio cuando se configura manualmente.")]
    InvalidK6BinaryPath,
    #[error("El binario k6 configurado no esta permitido: {0}.")]
    DisallowedK6BinaryPath(String),
    #[error("El script k6 ya no existe o no pertenece al workspace activo: {0}.")]
    MissingK6Script(String),
    #[error("La shell configurada no esta permitida: {0}.")]
    DisallowedShell(String),
    #[error("La ruta esta fuera del workspace permitido: {0}.")]
    PathNotAllowed(String),
    #[cfg(all(unix, not(target_os = "macos")))]
    #[error("{0}")]
    CommandFailed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
struct PersistedServiceSeed {
    id: String,
    workspace_id: String,
    name: String,
    path: String,
    runtime_type: String,
    framework_type: String,
    expected_port: Option<u16>,
    start_command: Option<String>,
    tags: Vec<String>,
    env: BTreeMap<String, String>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceManifestDocument {
    #[serde(default = "default_manifest_schema_version")]
    schema_version: u8,
    #[serde(default)]
    services: Vec<ManualServiceManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualServiceManifest {
    path: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    runtime_type: Option<String>,
    #[serde(default)]
    framework_type: Option<String>,
    #[serde(default)]
    expected_port: Option<u16>,
    #[serde(default)]
    start_command: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

fn default_manifest_schema_version() -> u8 {
    1
}

pub struct RuntimeSupervisor {
    services: Arc<Mutex<BTreeMap<String, RuntimeServiceState>>>,
    logs: Arc<Mutex<BTreeMap<String, ServiceLogBuffer>>>,
}

impl Default for RuntimeSupervisor {
    fn default() -> Self {
        Self {
            services: Arc::new(Mutex::new(BTreeMap::new())),
            logs: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }
}

pub struct K6RunnerSupervisor {
    active_run: Arc<Mutex<Option<ActiveK6RunState>>>,
    output: Arc<Mutex<ServiceLogBuffer>>,
}

impl Default for K6RunnerSupervisor {
    fn default() -> Self {
        Self {
            active_run: Arc::new(Mutex::new(None)),
            output: Arc::new(Mutex::new(ServiceLogBuffer::default())),
        }
    }
}

struct RuntimeServiceState {
    process_instance_id: Option<String>,
    process: Option<Child>,
    pid: Option<u32>,
    started_at: Option<String>,
    launch_instant: Instant,
    expected_port: Option<u16>,
    detected_port: Option<u16>,
    status: String,
    last_signal: String,
    issue: Option<ServiceActionIssue>,
    restart_count: u32,
}

struct RuntimePersistenceUpdate {
    service_id: String,
    process_instance_id: Option<String>,
    pid: Option<u32>,
    status: String,
    detected_port: Option<u16>,
    last_signal: String,
    issue: Option<ServiceActionIssue>,
}

#[derive(Debug, Default, Clone)]
struct ServiceLogBuffer {
    generation: u64,
    next_sequence: u64,
    dropped_entries: u64,
    entries: VecDeque<ServiceLogEntry>,
    last_updated_at: String,
}

struct ActiveK6RunState {
    run_id: String,
    service_id: String,
    service_name: String,
    script_id: String,
    script_name: String,
    profile_id: String,
    vus: u32,
    duration: String,
    rate: Option<u32>,
    thresholds: Vec<String>,
    binary_path: String,
    command_line: String,
    configured_duration_seconds: f64,
    warning_service_stopped: bool,
    started_at: String,
    result_path: String,
    summary_export_path: String,
    launch_instant: Instant,
    process: Option<Child>,
    pid: Option<u32>,
}

struct ServiceLaunchContext {
    id: String,
    name: String,
    root_path: String,
    path: String,
    expected_port: Option<u16>,
    start_command: Option<String>,
    env: BTreeMap<String, String>,
}

struct K6RunLaunchContext {
    workspace_root: PathBuf,
    service_id: String,
    service_name: String,
    service_status: String,
    script_id: String,
    script_name: String,
    script_path: String,
}

struct K6RunArtifacts {
    result_path: PathBuf,
    summary_export_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedK6RunSummary {
    #[serde(default)]
    config: PersistedK6RunConfig,
    #[serde(default)]
    outcome: PersistedK6RunOutcome,
    #[serde(default)]
    summary_export_path: Option<String>,
    #[serde(default)]
    summary_export_json: Option<Value>,
    #[serde(default)]
    output_tail: Vec<String>,
    #[serde(default)]
    external_dashboard_url: Option<String>,
    #[serde(default)]
    interrupted_by_app_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedK6LabContextPreference {
    selected_service_id: Option<String>,
    script_id: Option<String>,
    profile_id: String,
    vus: u32,
    duration: String,
    rate: Option<u32>,
    #[serde(default)]
    thresholds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedGlobalK6BinaryPreference {
    #[serde(default)]
    k6_binary_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAppSettingsPreference {
    #[serde(default)]
    default_workspace_root: String,
    #[serde(default)]
    default_log_export_root: String,
    #[serde(default)]
    allowed_shells: Vec<String>,
    #[serde(default)]
    preferred_shell: String,
    dashboard_refresh_seconds: u32,
    realtime_refresh_seconds: u32,
    theme: String,
    gpu_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedK6RunConfig {
    #[serde(default)]
    profile_id: String,
    #[serde(default)]
    vus: u32,
    #[serde(default)]
    duration: String,
    #[serde(default)]
    rate: Option<u32>,
    #[serde(default)]
    thresholds: Vec<String>,
    #[serde(default)]
    binary_path: String,
    #[serde(default)]
    command_line: String,
    #[serde(default)]
    configured_duration_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedK6RunOutcome {
    #[serde(default)]
    status: String,
    #[serde(default)]
    exit_code: Option<i32>,
    #[serde(default)]
    warning_service_stopped: bool,
    #[serde(default)]
    started_at: String,
    #[serde(default)]
    finished_at: Option<String>,
}

#[derive(Debug, Default)]
struct K6SeriesBucket {
    latency_values_ms: Vec<f64>,
    request_count: f64,
    error_values: Vec<f64>,
    vus_value: Option<f64>,
    check_values: Vec<f64>,
}

#[derive(Debug, Deserialize)]
struct K6ResultLine {
    metric: String,
    #[serde(rename = "type")]
    line_type: String,
    #[serde(default)]
    data: K6ResultPointData,
}

#[derive(Debug, Default, Deserialize)]
struct K6ResultPointData {
    #[serde(default)]
    time: Option<String>,
    #[serde(default)]
    value: Option<f64>,
}

#[derive(Debug, Clone)]
struct WorkspaceK6Context {
    workspace_id: String,
    root_path: PathBuf,
    services: Vec<ServiceK6Context>,
}

#[derive(Debug, Clone)]
struct ServiceK6Context {
    service_id: String,
    relative_path: String,
}

#[derive(Debug, Clone)]
struct ProcessMetricsSnapshot {
    cpu_percent: f64,
    memory_bytes: u64,
    gpu_percent: Option<f64>,
    gpu_memory_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
struct PlatformMetricsSnapshot {
    cpu_total_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    gpu_total_percent: Option<f64>,
    processes: BTreeMap<u32, ProcessMetricsSnapshot>,
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsMetricsPayload {
    cpu_total_percent: Option<f64>,
    memory_used_bytes: Option<u64>,
    memory_total_bytes: Option<u64>,
    #[serde(default)]
    processes: Vec<WindowsProcessMetric>,
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsProcessMetric {
    pid: u32,
    cpu_percent: f64,
    memory_bytes: u64,
}

#[cfg(windows)]
#[derive(Debug, Default)]
struct NvidiaGpuSnapshot {
    total_percent: Option<f64>,
    processes: BTreeMap<u32, NvidiaProcessMetric>,
}

#[cfg(windows)]
#[derive(Debug, Default, Clone)]
struct NvidiaProcessMetric {
    gpu_percent: Option<f64>,
    gpu_memory_bytes: Option<u64>,
}

pub fn get_dashboard_snapshot(app: &AppHandle) -> Result<DashboardSnapshot, AppError> {
    build_dashboard_snapshot(app, true)
}

pub fn get_app_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let connection = open_connection(app)?;
    load_app_settings(&connection)
}

pub fn save_app_settings(app: &AppHandle, settings: AppSettings) -> Result<AppSettings, AppError> {
    let connection = open_connection(app)?;
    persist_app_settings(&connection, settings)?;
    load_app_settings(&connection)
}

fn build_dashboard_snapshot(app: &AppHandle, refresh_runtime: bool) -> Result<DashboardSnapshot, AppError> {
    if refresh_runtime {
        refresh_runtime_supervisor(app);
    }

    recover_unmanaged_service_states(app)?;

    let connection = open_connection(app)?;
    let workspaces = load_workspaces(&connection)?;
    let mut services = load_services(&connection)?;
    apply_runtime_overlay(app, &mut services);
    annotate_port_conflicts(&mut services);

    let settings = load_app_settings(&connection)?;

    Ok(DashboardSnapshot {
        workspaces,
        system: collect_system_metrics(&mut services, &settings.gpu_mode),
        services,
    })
}

pub fn select_workspace_root(app: &AppHandle) -> Result<DashboardSnapshot, AppError> {
    let Some(path) = pick_workspace_root(app)? else {
        return get_dashboard_snapshot(app);
    };

    sync_workspace_catalog(app, path)
}

pub fn pick_workspace_root(app: &AppHandle) -> Result<Option<PathBuf>, AppError> {
    let connection = open_connection(app)?;
    let settings = load_app_settings(&connection)?;
    let dialog = apply_dialog_directory_hint(FileDialog::new(), &settings.default_workspace_root)
        .set_title("Seleccionar carpeta raiz");

    Ok(dialog.pick_folder())
}

pub fn pick_app_settings_path(app: &AppHandle, kind: &str) -> Result<Option<String>, AppError> {
    let connection = open_connection(app)?;
    let settings = load_app_settings(&connection)?;
    let selected = match kind {
        "workspaceRoot" => apply_dialog_directory_hint(FileDialog::new(), &settings.default_workspace_root)
            .set_title("Seleccionar ruta por defecto del workspace")
            .pick_folder(),
        "logExportRoot" => apply_dialog_directory_hint(FileDialog::new(), &settings.default_log_export_root)
            .set_title("Seleccionar ruta por defecto de exportacion")
            .pick_folder(),
        "k6BinaryFile" => {
            let dialog = apply_dialog_file_hint(FileDialog::new(), &settings.k6_binary_path)
                .set_title("Seleccionar binario k6");
            #[cfg(target_os = "windows")]
            let dialog = dialog.add_filter("k6", &["exe"]);
            dialog.pick_file()
        }
        _ => return Ok(None),
    };

    Ok(selected.map(|path| normalize_path(&path)))
}

pub fn rescan_active_workspace(app: &AppHandle) -> Result<DashboardSnapshot, AppError> {
    let path = load_active_workspace_path(app)?;
    if !path.exists() {
        return Err(AppError::MissingWorkspace(normalize_path(&path)));
    }

    sync_workspace_catalog(app, path)
}

pub fn register_manual_service(app: &AppHandle, draft: ManualServiceDraft) -> Result<DashboardSnapshot, AppError> {
    let workspace_root = load_active_workspace_path(app)?;
    let normalized_path = validate_manual_service_path(&workspace_root, &draft.path)?;
    let name = draft.name.trim();
    let start_command = draft.start_command.trim();
    let service_dir = workspace_root.join(relative_source_root(&normalized_path));

    if name.is_empty() {
        return Err(AppError::InvalidManualServiceName);
    }

    if start_command.is_empty() {
        return Err(AppError::InvalidManualStartCommand);
    }

    validate_service_start_command(&workspace_root, &service_dir, start_command)?;

    let mut manifest = load_service_manifest_document(&workspace_root)?;
    let entry = ManualServiceManifest {
        path: normalized_path.clone(),
        name: Some(name.to_string()),
        runtime_type: Some(normalize_manifest_string(&draft.runtime_type, "node")),
        framework_type: Some(normalize_manifest_string(&draft.framework_type, "custom")),
        expected_port: draft.expected_port,
        start_command: Some(start_command.to_string()),
        tags: normalize_tags(draft.tags),
        env: normalize_env_map(draft.env),
    };

    upsert_manifest_entry(&mut manifest.services, entry);
    save_service_manifest_document(&workspace_root, &manifest)?;
    sync_workspace_catalog(app, workspace_root)
}

pub fn run_service(app: &AppHandle, service_id: &str) -> Result<RunServiceResponse, AppError> {
    let launch = load_service_launch_context(app, service_id)?;

    if let Some(issue) = can_start_service(app, &launch) {
        record_runtime_issue(app, service_id, issue.clone());
        return Ok(ServiceActionResponse {
            snapshot: build_dashboard_snapshot(app, false)?,
            issue: Some(issue),
        });
    }

    spawn_service_runtime(app, launch, 0, false)
}

pub fn stop_service(app: &AppHandle, service_id: &str) -> Result<ServiceActionResponse, AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    let outcome = stop_runtime_service(app, &launch, StopIntent::ManualStop)?;
    Ok(ServiceActionResponse {
        snapshot: build_dashboard_snapshot(app, false)?,
        issue: outcome.issue,
    })
}

pub fn restart_service(app: &AppHandle, service_id: &str) -> Result<ServiceActionResponse, AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    let outcome = stop_runtime_service(app, &launch, StopIntent::Restart)?;
    if let Some(issue) = outcome.issue {
        return Ok(ServiceActionResponse {
            snapshot: build_dashboard_snapshot(app, false)?,
            issue: Some(issue),
        });
    }

    spawn_service_runtime(app, launch, outcome.restart_count.saturating_add(1), true)
}

pub fn cleanup_runtime_supervisor(app: &AppHandle) -> Result<(), AppError> {
    let service_ids = {
        let supervisor = app.state::<RuntimeSupervisor>();
        let services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
        services.keys().cloned().collect::<Vec<_>>()
    };

    for service_id in service_ids {
        let Ok(launch) = load_service_launch_context(app, &service_id) else {
            continue;
        };
        let _ = stop_runtime_service(app, &launch, StopIntent::AppExit)?;
    }

    Ok(())
}

pub fn open_service_folder(app: &AppHandle, service_id: &str) -> Result<(), AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    let service_dir = resolve_service_directory(&launch)?;
    spawn_folder_opener(&service_dir)
}

pub fn open_service_terminal(app: &AppHandle, service_id: &str) -> Result<(), AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    let service_dir = resolve_service_directory(&launch)?;
    let connection = open_connection(app)?;
    let settings = load_app_settings(&connection)?;
    spawn_terminal_opener(&service_dir, &settings)
}

pub fn get_k6_lab_snapshot(app: &AppHandle) -> Result<K6LabSnapshot, AppError> {
    let mut connection = open_connection(app)?;
    build_k6_lab_snapshot(&mut connection)
}

pub fn register_k6_script(app: &AppHandle, draft: K6ScriptDraft) -> Result<K6LabSnapshot, AppError> {
    let mut connection = open_connection(app)?;
    let workspace_context = load_active_workspace_k6_context(&connection)?.ok_or(AppError::NoActiveWorkspace)?;
    let relative_path = validate_k6_script_path(&workspace_context.root_path, &draft.path)?;
    let service_context = workspace_context
        .services
        .iter()
        .find(|service| service.service_id == draft.service_id)
        .ok_or_else(|| AppError::MissingServicePath(draft.service_id.clone()))?;
    let full_path = workspace_context.root_path.join(relative_source_root(&relative_path));

    if !full_path.is_file() || !is_supported_k6_extension(&full_path) {
        return Err(AppError::InvalidK6ScriptPath(normalize_path(&full_path)));
    }

    let now = Utc::now().to_rfc3339();
    let script_name = draft
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| derive_k6_script_name(&relative_path));
    let script_id = format!("{}::{}", service_context.service_id, relative_path);

    connection.execute(
        "INSERT INTO k6_script (id, service_id, name, path, source, default_config_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'manual', '{}', ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            service_id = excluded.service_id,
            name = excluded.name,
            path = excluded.path,
            source = excluded.source,
            updated_at = excluded.updated_at",
        params![
            script_id,
            service_context.service_id,
            script_name,
            relative_path,
            now.as_str(),
            now.as_str(),
        ],
    )?;

    build_k6_lab_snapshot(&mut connection)
}

pub fn save_k6_lab_preferences(app: &AppHandle, preferences: K6LabPreferences) -> Result<K6LabSnapshot, AppError> {
    let mut connection = open_connection(app)?;
    let workspace_context = load_active_workspace_k6_context(&connection)?;
    if let Some(workspace_context) = workspace_context.as_ref() {
        sync_k6_script_catalog(&mut connection, workspace_context)?;
    }

    persist_k6_lab_preferences(&connection, workspace_context.as_ref(), preferences)?;
    build_k6_lab_snapshot(&mut connection)
}

pub fn validate_k6_setup(app: &AppHandle, request: K6ValidationRequest) -> Result<K6ValidationResult, AppError> {
    let connection = open_connection(app).ok();
    let binary = resolve_k6_binary_status(connection.as_ref(), request.k6_binary_path.as_deref());
    let thresholds = validate_k6_thresholds(&request.thresholds);
    let mut issues = Vec::new();

    if request.vus == 0 {
        issues.push("VUs debe ser mayor que 0.".to_string());
    }

    if !is_valid_k6_duration(&request.duration) {
        issues.push("Duration debe usar unidades validas de k6, por ejemplo 30s, 5m o 1m30s.".to_string());
    }

    if matches!(request.rate, Some(0)) {
        issues.push("Rate debe ser mayor que 0 cuando se configure.".to_string());
    }

    if !binary.is_available {
        issues.push(binary.detail.clone());
    }

    for threshold in &thresholds {
        if !threshold.is_valid {
            issues.push(format!("Threshold invalido: {}", threshold.expression));
        }
    }

    Ok(K6ValidationResult {
        is_valid: issues.is_empty(),
        binary,
        thresholds,
        issues,
    })
}

pub fn get_k6_run_snapshot(app: &AppHandle) -> Result<K6RunSnapshot, AppError> {
    build_k6_run_snapshot(app, true)
}

pub fn start_k6_run(app: &AppHandle, request: K6RunRequest) -> Result<K6RunActionResponse, AppError> {
    refresh_k6_runner(app)?;
    recover_unmanaged_k6_runs(app)?;

    if has_active_k6_run(app) {
        return Ok(K6RunActionResponse {
            snapshot: build_k6_run_snapshot(app, false)?,
            issue: Some(build_service_issue(
                &request.service_id,
                "k6_run_already_active",
                "Ya existe una corrida k6 activa",
                "El MVP solo permite una corrida k6 activa a la vez.",
                Some("Cancela la corrida actual o espera a que termine antes de iniciar otra."),
            )),
        });
    }

    let launch = load_k6_run_launch_context(app, &request.service_id, &request.script_id)?;
    let validation = validate_k6_setup(
        app,
        K6ValidationRequest {
            k6_binary_path: request.k6_binary_path.clone(),
            vus: request.vus,
            duration: request.duration.clone(),
            rate: request.rate,
            thresholds: request.thresholds.clone(),
        },
    )?;

    if !validation.is_valid {
        return Ok(K6RunActionResponse {
            snapshot: build_k6_run_snapshot(app, false)?,
            issue: Some(build_service_issue(
                &launch.service_id,
                "k6_setup_invalid",
                "El setup k6 no es valido",
                "La corrida no se puede iniciar hasta corregir binario, duration, VUs o thresholds.",
                Some(&validation.issues.join(" | ")),
            )),
        });
    }

    let configured_duration_seconds = parse_k6_duration_seconds(&request.duration).unwrap_or_default();
    let warning_service_stopped = !matches!(
        resolve_current_service_status(app, &launch.service_id, &launch.service_status).as_str(),
        "running" | "starting"
    );
    let binary_path = validation.binary.resolved_path.unwrap_or_default();
    let run_id = Uuid::new_v4().to_string();
    let artifacts = prepare_k6_run_artifacts(app, &run_id)?;
    let script_absolute_path = launch.workspace_root.join(relative_source_root(&launch.script_path));
    let arguments = build_k6_run_arguments(
        request.vus,
        &request.duration,
        request.rate,
        &artifacts.result_path,
        &artifacts.summary_export_path,
        &script_absolute_path,
    );
    let command_line = render_command_line(&binary_path, &arguments);

    let mut command = Command::new(&binary_path);
    command
        .args(arguments.iter().map(String::as_str))
        .current_dir(&launch.workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Ok(K6RunActionResponse {
                snapshot: build_k6_run_snapshot(app, false)?,
                issue: Some(build_service_issue(
                    &launch.service_id,
                    "k6_spawn_failed",
                    "No se pudo iniciar k6",
                    "El proceso hijo de k6 no pudo iniciarse desde la app de escritorio.",
                    Some(&error.to_string()),
                )),
            });
        }
    };

    let output_generation = prepare_k6_output_buffer_for_run(app);
    if let Some(stdout) = child.stdout.take() {
        spawn_k6_output_reader(app, output_generation, "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_k6_output_reader(app, output_generation, "stderr", stderr);
    }

    let pid = child.id();
    let started_at = Utc::now().to_rfc3339();
    let active_run = ActiveK6RunState {
        run_id: run_id.clone(),
        service_id: launch.service_id.clone(),
        service_name: launch.service_name.clone(),
        script_id: launch.script_id.clone(),
        script_name: launch.script_name.clone(),
        profile_id: request.profile_id.clone(),
        vus: request.vus,
        duration: request.duration.clone(),
        rate: request.rate,
        thresholds: request.thresholds.clone(),
        binary_path: binary_path.clone(),
        command_line: command_line.clone(),
        configured_duration_seconds,
        warning_service_stopped,
        started_at: started_at.clone(),
        result_path: normalize_path(&artifacts.result_path),
        summary_export_path: normalize_path(&artifacts.summary_export_path),
        launch_instant: Instant::now(),
        process: Some(child),
        pid: Some(pid),
    };
    let initial_summary = serialize_k6_summary(&PersistedK6RunSummary {
        config: build_persisted_k6_config(&active_run),
        outcome: PersistedK6RunOutcome {
            status: "running".into(),
            exit_code: None,
            warning_service_stopped,
            started_at: started_at.clone(),
            finished_at: None,
        },
        summary_export_path: Some(active_run.summary_export_path.clone()),
        summary_export_json: None,
        output_tail: Vec::new(),
        external_dashboard_url: None,
        interrupted_by_app_restart: false,
    })?;

    let connection = open_connection(app)?;
    if let Err(error) = connection.execute(
        "INSERT INTO k6_run (id, service_id, script_id, status, started_at, finished_at, summary_json, raw_result_path)
         VALUES (?1, ?2, ?3, 'running', ?4, NULL, ?5, NULL)",
        params![
            active_run.run_id,
            active_run.service_id,
            active_run.script_id,
            active_run.started_at,
            initial_summary,
        ],
    ) {
        if let Some(mut child) = active_run.process {
            let _ = terminate_supervised_process(&mut child, active_run.pid);
        }
        return Err(AppError::from(error));
    }

    {
        let supervisor = app.state::<K6RunnerSupervisor>();
        let mut active_slot = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
        *active_slot = Some(active_run);
    }

    Ok(K6RunActionResponse {
        snapshot: build_k6_run_snapshot(app, false)?,
        issue: warning_service_stopped.then(|| {
            build_service_issue(
                &launch.service_id,
                "k6_target_service_stopped",
                "El servicio objetivo no esta running",
                "La corrida k6 continua, pero el servicio asociado aparece detenido o sin supervisor activo.",
                Some("La app no bloquea la corrida; valida manualmente que el endpoint objetivo este disponible."),
            )
        }),
    })
}

pub fn cancel_k6_run(app: &AppHandle) -> Result<K6RunActionResponse, AppError> {
    refresh_k6_runner(app)?;
    recover_unmanaged_k6_runs(app)?;

    let Some(mut active_run) = take_active_k6_run(app) else {
        return Ok(K6RunActionResponse {
            snapshot: build_k6_run_snapshot(app, false)?,
            issue: None,
        });
    };

    if let Some(mut child) = active_run.process.take() {
        if let Err(error) = terminate_supervised_process(&mut child, active_run.pid) {
            let service_id = active_run.service_id.clone();
            active_run.process = Some(child);
            restore_active_k6_run(app, active_run);
            return Ok(K6RunActionResponse {
                snapshot: build_k6_run_snapshot(app, false)?,
                issue: Some(build_service_issue(
                    &service_id,
                    "k6_cancel_failed",
                    "No se pudo cancelar la corrida k6",
                    "La app no pudo terminar el arbol del proceso k6 activo.",
                    Some(&error),
                )),
            });
        }
    }

    finalize_k6_run(app, active_run, "cancelled", None, false)?;

    Ok(K6RunActionResponse {
        snapshot: build_k6_run_snapshot(app, false)?,
        issue: None,
    })
}

pub fn cleanup_k6_runner(app: &AppHandle) -> Result<(), AppError> {
    if has_active_k6_run(app) {
        let _ = cancel_k6_run(app)?;
    }

    Ok(())
}

pub fn get_service_logs(app: &AppHandle, service_id: &str) -> Result<ServiceLogSnapshot, AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    Ok(snapshot_service_logs(app, &launch.id))
}

pub fn clear_service_logs(app: &AppHandle, service_id: &str) -> Result<ServiceLogSnapshot, AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    clear_service_log_buffer(app, &launch.id);
    Ok(snapshot_service_logs(app, &launch.id))
}

pub fn get_service_execution_history(
    app: &AppHandle,
    service_id: &str,
) -> Result<ServiceExecutionHistorySnapshot, AppError> {
    build_service_execution_history_snapshot(app, service_id, true)
}

pub fn export_service_logs(app: &AppHandle, service_id: &str) -> Result<Option<String>, AppError> {
    let launch = load_service_launch_context(app, service_id)?;
    let snapshot = snapshot_service_logs(app, &launch.id);
    let default_name = build_log_export_name(&launch.name);
    let connection = open_connection(app)?;
    let settings = load_app_settings(&connection)?;
    let dialog = apply_dialog_directory_hint(FileDialog::new(), &settings.default_log_export_root)
        .set_title("Exportar logs del servicio")
        .set_file_name(&default_name)
        .add_filter("Log", &["log", "txt"]);
    let Some(destination) = dialog
        .save_file()
    else {
        return Ok(None);
    };

    fs::write(&destination, render_service_log_export(&snapshot))?;
    Ok(Some(normalize_path(&destination)))
}

fn load_app_settings(connection: &Connection) -> Result<AppSettings, AppError> {
    let mut settings = default_app_settings();
    if let Some(saved_settings) = load_user_preference_json::<PersistedAppSettingsPreference>(
        connection,
        USER_PREFERENCE_KEY_APP_SETTINGS,
        USER_PREFERENCE_SCOPE_GLOBAL,
        "",
    )? {
        settings.default_workspace_root = saved_settings.default_workspace_root;
        settings.default_log_export_root = saved_settings.default_log_export_root;
        settings.allowed_shells = saved_settings.allowed_shells;
        settings.preferred_shell = saved_settings.preferred_shell;
        settings.dashboard_refresh_seconds = saved_settings.dashboard_refresh_seconds;
        settings.realtime_refresh_seconds = saved_settings.realtime_refresh_seconds;
        settings.theme = saved_settings.theme;
        settings.gpu_mode = saved_settings.gpu_mode;
    }

    if let Some(global_binary) = load_global_k6_binary_path_preference(connection)? {
        settings.k6_binary_path = global_binary;
    }

    Ok(sanitize_app_settings(settings))
}

fn persist_app_settings(connection: &Connection, settings: AppSettings) -> Result<(), AppError> {
    let sanitized = sanitize_app_settings(settings);
    save_user_preference_json(
        connection,
        USER_PREFERENCE_KEY_APP_SETTINGS,
        USER_PREFERENCE_SCOPE_GLOBAL,
        "",
        &PersistedAppSettingsPreference {
            default_workspace_root: sanitized.default_workspace_root.clone(),
            default_log_export_root: sanitized.default_log_export_root.clone(),
            allowed_shells: sanitized.allowed_shells.clone(),
            preferred_shell: sanitized.preferred_shell.clone(),
            dashboard_refresh_seconds: sanitized.dashboard_refresh_seconds,
            realtime_refresh_seconds: sanitized.realtime_refresh_seconds,
            theme: sanitized.theme.clone(),
            gpu_mode: sanitized.gpu_mode.clone(),
        },
    )?;
    save_global_k6_binary_path_preference(connection, &sanitized.k6_binary_path)
}

fn default_app_settings() -> AppSettings {
    let allowed_shells = default_allowed_shells();
    let preferred_shell = allowed_shells
        .first()
        .cloned()
        .unwrap_or_else(default_preferred_shell);

    AppSettings {
        default_workspace_root: String::new(),
        default_log_export_root: String::new(),
        allowed_shells,
        preferred_shell,
        dashboard_refresh_seconds: 2,
        realtime_refresh_seconds: 1,
        theme: "midnight".into(),
        gpu_mode: "auto".into(),
        k6_binary_path: String::new(),
    }
}

fn default_allowed_shells() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        return vec!["cmd.exe".into(), "powershell.exe".into(), "pwsh.exe".into()];
    }

    #[cfg(target_os = "macos")]
    {
        return vec!["zsh".into(), "bash".into(), "sh".into()];
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return vec!["bash".into(), "sh".into(), "zsh".into()];
    }
}

fn default_preferred_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        return "cmd.exe".into();
    }

    #[cfg(target_os = "macos")]
    {
        return "zsh".into();
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return "bash".into();
    }
}

fn sanitize_app_settings(mut settings: AppSettings) -> AppSettings {
    settings.default_workspace_root = settings.default_workspace_root.trim().to_string();
    settings.default_log_export_root = settings.default_log_export_root.trim().to_string();
    settings.k6_binary_path = settings.k6_binary_path.trim().to_string();

    let mut allowed_shells = Vec::new();
    let mut seen_shells = BTreeSet::new();
    for shell in settings.allowed_shells {
        let trimmed = shell.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized_key = trimmed.to_ascii_lowercase();
        if seen_shells.insert(normalized_key) {
            allowed_shells.push(trimmed.to_string());
        }
    }

    if allowed_shells.is_empty() {
        allowed_shells = default_allowed_shells();
    }

    settings.allowed_shells = allowed_shells;

    let preferred_shell = settings.preferred_shell.trim();
    settings.preferred_shell = if preferred_shell.is_empty() {
        settings
            .allowed_shells
            .first()
            .cloned()
            .unwrap_or_else(default_preferred_shell)
    } else {
        let allowed_match = settings
            .allowed_shells
            .iter()
            .find(|candidate| candidate.eq_ignore_ascii_case(preferred_shell))
            .cloned();
        allowed_match
            .or_else(|| settings.allowed_shells.first().cloned())
            .unwrap_or_else(default_preferred_shell)
    };

    settings.dashboard_refresh_seconds = settings.dashboard_refresh_seconds.clamp(1, 30);
    settings.realtime_refresh_seconds = settings.realtime_refresh_seconds.clamp(1, 10);

    if !matches!(settings.theme.as_str(), "midnight" | "ember" | "arctic") {
        settings.theme = "midnight".into();
    }

    if !matches!(settings.gpu_mode.as_str(), "auto" | "disabled" | "nvidia") {
        settings.gpu_mode = "auto".into();
    }

    settings
}

fn validate_service_start_command(root: &Path, working_directory: &Path, command: &str) -> Result<String, AppError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidManualStartCommand);
    }

    if contains_forbidden_shell_syntax(trimmed) {
        return Err(AppError::DisallowedStartCommand(
            "No se permiten pipes, chaining, redirecciones ni sustitucion de shell.".into(),
        ));
    }

    let launcher_token = extract_command_launcher_token(trimmed).ok_or_else(|| {
        AppError::DisallowedStartCommand("No se pudo resolver el launcher principal del comando.".into())
    })?;
    let normalized_launcher = normalize_command_name(&launcher_token).ok_or_else(|| {
        AppError::DisallowedStartCommand("No se pudo normalizar el launcher principal del comando.".into())
    })?;

    if !ALLOWED_SERVICE_LAUNCHERS.contains(&normalized_launcher.as_str()) {
        return Err(AppError::DisallowedStartCommand(format!(
            "El launcher `{normalized_launcher}` no esta en la allowlist del MVP."
        )));
    }

    if is_path_like_token(&launcher_token) {
        let launcher_path = resolve_command_token_path(working_directory, &launcher_token);
        if launcher_path.is_absolute() {
            if !launcher_path.exists() {
                return Err(AppError::DisallowedStartCommand(format!(
                    "El launcher absoluto `{}` no existe en disco.",
                    normalize_path(&launcher_path)
                )));
            }
        } else {
            if launcher_path
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
            {
                return Err(AppError::DisallowedStartCommand(
                    "No se permiten launchers relativos que escapen del directorio del servicio.".into(),
                ));
            }

            ensure_path_within_root(root, &launcher_path)?;
        }
    }

    Ok(normalized_launcher)
}

fn contains_forbidden_shell_syntax(command: &str) -> bool {
    let mut quote: Option<char> = None;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;

    while index < chars.len() {
        let current = chars[index];
        if let Some(active_quote) = quote {
            if current == active_quote {
                quote = None;
            }
            index += 1;
            continue;
        }

        match current {
            '"' | '\'' => {
                quote = Some(current);
            }
            '\n' | '\r' | ';' | '`' | '<' | '>' | '|' | '&' => return true,
            '$' if chars.get(index + 1) == Some(&'(') => return true,
            _ => {}
        }

        index += 1;
    }

    false
}

fn extract_command_launcher_token(command: &str) -> Option<String> {
    let trimmed = command.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let mut token = String::new();
    let mut quote: Option<char> = None;

    for current in trimmed.chars() {
        if let Some(active_quote) = quote {
            if current == active_quote {
                quote = None;
            } else {
                token.push(current);
            }
            continue;
        }

        match current {
            '"' | '\'' => quote = Some(current),
            value if value.is_whitespace() => break,
            value => token.push(value),
        }
    }

    (!token.trim().is_empty()).then_some(token)
}

fn normalize_command_name(token: &str) -> Option<String> {
    let token_path = Path::new(token);
    let file_name = token_path.file_name().and_then(|value| value.to_str()).unwrap_or(token);
    let file_name = file_name.trim();
    if file_name.is_empty() {
        return None;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);

    Some(stem.to_ascii_lowercase())
}

fn is_path_like_token(token: &str) -> bool {
    token.starts_with('.')
        || token.contains(['\\', '/'])
        || Path::new(token).is_absolute()
}

fn resolve_command_token_path(working_directory: &Path, token: &str) -> PathBuf {
    let token_path = PathBuf::from(token);
    if token_path.is_absolute() {
        token_path
    } else {
        working_directory.join(token_path)
    }
}

fn ensure_path_within_root(root: &Path, candidate: &Path) -> Result<(), AppError> {
    let canonical_root = fs::canonicalize(root)?;
    let canonical_candidate = fs::canonicalize(candidate)?;
    if canonical_candidate.starts_with(&canonical_root) {
        return Ok(());
    }

    Err(AppError::PathNotAllowed(normalize_path(candidate)))
}

fn apply_dialog_directory_hint(dialog: FileDialog, preferred_directory: &str) -> FileDialog {
    let Some(trimmed) = non_empty_trimmed(preferred_directory) else {
        return dialog;
    };

    let preferred_path = PathBuf::from(trimmed);
    if preferred_path.exists() && preferred_path.is_dir() {
        dialog.set_directory(preferred_path)
    } else {
        dialog
    }
}

fn apply_dialog_file_hint(dialog: FileDialog, preferred_file: &str) -> FileDialog {
    let Some(trimmed) = non_empty_trimmed(preferred_file) else {
        return dialog;
    };

    let preferred_path = PathBuf::from(trimmed);
    let dialog = if let Some(parent) = preferred_path.parent().filter(|parent| parent.exists() && parent.is_dir()) {
        dialog.set_directory(parent)
    } else {
        dialog
    };

    if let Some(file_name) = preferred_path.file_name().and_then(|file_name| file_name.to_str()) {
        dialog.set_file_name(file_name)
    } else {
        dialog
    }
}

fn build_k6_lab_snapshot(connection: &mut Connection) -> Result<K6LabSnapshot, AppError> {
    let workspace_context = load_active_workspace_k6_context(connection)?;

    if let Some(workspace_context) = workspace_context.as_ref() {
        sync_k6_script_catalog(connection, workspace_context)?;
    }

    let scripts = load_k6_scripts(connection)?;
    let profiles = default_k6_profiles();
    let preferences = load_effective_k6_lab_preferences(connection, workspace_context.as_ref(), &scripts, &profiles)?;
    let binary = resolve_k6_binary_status(
        Some(connection),
        non_empty_trimmed(&preferences.k6_binary_path),
    );

    Ok(K6LabSnapshot {
        scripts,
        profiles,
        binary,
        preferences,
    })
}

fn load_effective_k6_lab_preferences(
    connection: &Connection,
    workspace_context: Option<&WorkspaceK6Context>,
    scripts: &[K6ScriptRecord],
    profiles: &[K6ProfilePreset],
) -> Result<K6LabPreferences, AppError> {
    let mut preferences = default_k6_lab_preferences(profiles);

    if let Some(workspace_context) = workspace_context {
        if let Some(saved_context) = load_user_preference_json::<PersistedK6LabContextPreference>(
            connection,
            USER_PREFERENCE_KEY_K6_LAB_CONTEXT,
            USER_PREFERENCE_SCOPE_WORKSPACE,
            &workspace_context.workspace_id,
        )? {
            preferences.selected_service_id = saved_context.selected_service_id;
            preferences.script_id = saved_context.script_id;
            preferences.profile_id = saved_context.profile_id;
            preferences.vus = saved_context.vus;
            preferences.duration = saved_context.duration;
            preferences.rate = saved_context.rate;
            preferences.thresholds = saved_context.thresholds;
        }
    }

    if let Some(global_binary) = load_global_k6_binary_path_preference(connection)? {
        preferences.k6_binary_path = global_binary;
    }

    Ok(sanitize_k6_lab_preferences(
        workspace_context,
        scripts,
        profiles,
        preferences,
    ))
}

fn persist_k6_lab_preferences(
    connection: &Connection,
    workspace_context: Option<&WorkspaceK6Context>,
    preferences: K6LabPreferences,
) -> Result<(), AppError> {
    let scripts = load_k6_scripts(connection)?;
    let profiles = default_k6_profiles();
    let sanitized = sanitize_k6_lab_preferences(workspace_context, &scripts, &profiles, preferences);

    if let Some(workspace_context) = workspace_context {
        let workspace_value = PersistedK6LabContextPreference {
            selected_service_id: sanitized.selected_service_id.clone(),
            script_id: sanitized.script_id.clone(),
            profile_id: sanitized.profile_id.clone(),
            vus: sanitized.vus,
            duration: sanitized.duration.clone(),
            rate: sanitized.rate,
            thresholds: sanitized.thresholds.clone(),
        };
        save_user_preference_json(
            connection,
            USER_PREFERENCE_KEY_K6_LAB_CONTEXT,
            USER_PREFERENCE_SCOPE_WORKSPACE,
            &workspace_context.workspace_id,
            &workspace_value,
        )?;
    }

    save_global_k6_binary_path_preference(connection, &sanitized.k6_binary_path)
}

fn default_k6_lab_preferences(profiles: &[K6ProfilePreset]) -> K6LabPreferences {
    let profile = profiles.first().cloned().unwrap_or(K6ProfilePreset {
        id: "smoke".into(),
        label: "Smoke".into(),
        vus: 1,
        duration: "30s".into(),
        rate: Some(1),
        thresholds: vec!["http_req_failed<0.01".into(), "checks>0.95".into()],
    });

    K6LabPreferences {
        selected_service_id: None,
        script_id: None,
        profile_id: profile.id,
        vus: profile.vus,
        duration: profile.duration,
        rate: profile.rate,
        thresholds: profile.thresholds,
        k6_binary_path: String::new(),
    }
}

fn sanitize_k6_lab_preferences(
    workspace_context: Option<&WorkspaceK6Context>,
    scripts: &[K6ScriptRecord],
    profiles: &[K6ProfilePreset],
    mut preferences: K6LabPreferences,
) -> K6LabPreferences {
    let default_preferences = default_k6_lab_preferences(profiles);
    let valid_service_ids = workspace_context
        .map(|context| {
            context
                .services
                .iter()
                .map(|service| service.service_id.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    preferences.selected_service_id = preferences
        .selected_service_id
        .filter(|service_id| valid_service_ids.iter().any(|candidate| candidate == service_id))
        .or_else(|| valid_service_ids.first().cloned());

    let valid_script_ids = preferences
        .selected_service_id
        .as_ref()
        .map(|service_id| {
            scripts
                .iter()
                .filter(|script| &script.service_id == service_id)
                .map(|script| script.id.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    preferences.script_id = preferences
        .script_id
        .filter(|script_id| valid_script_ids.iter().any(|candidate| candidate == script_id))
        .or_else(|| valid_script_ids.first().cloned());

    let profile_defaults = profiles
        .iter()
        .find(|profile| profile.id == preferences.profile_id)
        .cloned()
        .or_else(|| profiles.first().cloned())
        .unwrap_or_else(|| K6ProfilePreset {
            id: default_preferences.profile_id.clone(),
            label: "Smoke".into(),
            vus: default_preferences.vus,
            duration: default_preferences.duration.clone(),
            rate: default_preferences.rate,
            thresholds: default_preferences.thresholds.clone(),
        });

    if !profiles.iter().any(|profile| profile.id == preferences.profile_id) {
        preferences.profile_id = profile_defaults.id.clone();
    }

    if preferences.vus == 0 {
        preferences.vus = profile_defaults.vus;
    }

    if !is_valid_k6_duration(&preferences.duration) {
        preferences.duration = profile_defaults.duration.clone();
    }

    if matches!(preferences.rate, Some(0)) {
        preferences.rate = profile_defaults.rate;
    }

    preferences.thresholds = preferences
        .thresholds
        .into_iter()
        .map(|threshold| threshold.trim().to_string())
        .filter(|threshold| !threshold.is_empty())
        .collect();
    preferences.k6_binary_path = preferences.k6_binary_path.trim().to_string();

    if workspace_context.is_none() {
        preferences.selected_service_id = None;
        preferences.script_id = None;
    }

    preferences
}

fn load_global_k6_binary_path_preference(connection: &Connection) -> Result<Option<String>, AppError> {
    let value = load_user_preference_json::<PersistedGlobalK6BinaryPreference>(
        connection,
        USER_PREFERENCE_KEY_K6_BINARY_PATH,
        USER_PREFERENCE_SCOPE_GLOBAL,
        "",
    )?;

    Ok(value
        .map(|preference| preference.k6_binary_path.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn save_global_k6_binary_path_preference(connection: &Connection, path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() {
        delete_user_preference(
            connection,
            USER_PREFERENCE_KEY_K6_BINARY_PATH,
            USER_PREFERENCE_SCOPE_GLOBAL,
            "",
        )?;
        return Ok(());
    }

    let normalized_path = PathBuf::from(path.trim());
    if !is_allowed_k6_binary_name(&normalized_path) {
        return Err(AppError::DisallowedK6BinaryPath(
            "La ruta configurada debe apuntar a un binario llamado k6 o k6.exe.".into(),
        ));
    }

    save_user_preference_json(
        connection,
        USER_PREFERENCE_KEY_K6_BINARY_PATH,
        USER_PREFERENCE_SCOPE_GLOBAL,
        "",
        &PersistedGlobalK6BinaryPreference {
            k6_binary_path: normalize_path(&normalized_path),
        },
    )
}

fn load_user_preference_json<T: DeserializeOwned>(
    connection: &Connection,
    key: &str,
    scope_type: &str,
    scope_id: &str,
) -> Result<Option<T>, AppError> {
    let value_json = connection
        .query_row(
            "SELECT value_json
             FROM user_preference
             WHERE key = ?1
               AND scope_type = ?2
               AND scope_id = ?3
             LIMIT 1",
            params![key, scope_type, scope_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    value_json
        .map(|value| serde_json::from_str::<T>(&value).map_err(AppError::from))
        .transpose()
}

fn save_user_preference_json<T: Serialize>(
    connection: &Connection,
    key: &str,
    scope_type: &str,
    scope_id: &str,
    value: &T,
) -> Result<(), AppError> {
    let updated_at = Utc::now().to_rfc3339();
    let value_json = serde_json::to_string(value)?;

    connection.execute(
        "INSERT INTO user_preference (key, scope_type, scope_id, value_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(key, scope_type, scope_id) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at",
        params![key, scope_type, scope_id, value_json, updated_at],
    )?;

    Ok(())
}

fn delete_user_preference(
    connection: &Connection,
    key: &str,
    scope_type: &str,
    scope_id: &str,
) -> Result<(), AppError> {
    connection.execute(
        "DELETE FROM user_preference
         WHERE key = ?1
           AND scope_type = ?2
           AND scope_id = ?3",
        params![key, scope_type, scope_id],
    )?;
    Ok(())
}

fn non_empty_trimmed(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn build_k6_run_snapshot(app: &AppHandle, refresh: bool) -> Result<K6RunSnapshot, AppError> {
    if refresh {
        refresh_k6_runner(app)?;
    }
    recover_unmanaged_k6_runs(app)?;

    let connection = open_connection(app)?;
    let (output_entries, dropped_output_entries, last_updated_at) = snapshot_k6_output(app);

    let history = load_k6_run_history(&connection, 12)?;
    let latest_run = history.first().cloned();
    let latest_report = latest_run
        .as_ref()
        .map(build_k6_run_report)
        .transpose()?;

    Ok(K6RunSnapshot {
        active_run: snapshot_active_k6_run(app),
        latest_run,
        history,
        latest_report,
        output_entries,
        dropped_output_entries,
        last_updated_at,
    })
}

fn build_service_execution_history_snapshot(
    app: &AppHandle,
    service_id: &str,
    refresh: bool,
) -> Result<ServiceExecutionHistorySnapshot, AppError> {
    if refresh {
        refresh_runtime_supervisor(app);
    }

    recover_unmanaged_service_states(app)?;
    let launch = load_service_launch_context(app, service_id)?;
    let connection = open_connection(app)?;
    let entries = load_service_execution_history(&connection, &launch.id, 12)?;

    Ok(ServiceExecutionHistorySnapshot {
        service_id: launch.id,
        entries,
        last_updated_at: Utc::now().to_rfc3339(),
    })
}

fn has_active_k6_run(app: &AppHandle) -> bool {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let active_run = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
    active_run.is_some()
}

fn take_active_k6_run(app: &AppHandle) -> Option<ActiveK6RunState> {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let mut active_run = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
    active_run.take()
}

fn restore_active_k6_run(app: &AppHandle, active_run: ActiveK6RunState) {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let mut active_slot = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
    *active_slot = Some(active_run);
}

fn snapshot_active_k6_run(app: &AppHandle) -> Option<K6RunRecord> {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let active_run = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
    active_run
        .as_ref()
        .map(build_active_k6_run_record)
}

fn build_active_k6_run_record(active_run: &ActiveK6RunState) -> K6RunRecord {
    let elapsed_seconds = active_run.launch_instant.elapsed().as_secs_f64();
    K6RunRecord {
        id: active_run.run_id.clone(),
        service_id: active_run.service_id.clone(),
        service_name: active_run.service_name.clone(),
        script_id: active_run.script_id.clone(),
        script_name: active_run.script_name.clone(),
        status: "running".into(),
        started_at: active_run.started_at.clone(),
        finished_at: None,
        pid: active_run.pid,
        exit_code: None,
        warning_service_stopped: active_run.warning_service_stopped,
        raw_result_path: Some(active_run.result_path.clone()),
        summary_export_path: Some(active_run.summary_export_path.clone()),
        command_line: active_run.command_line.clone(),
        configured_duration_seconds: active_run.configured_duration_seconds,
        elapsed_seconds,
        progress_percent: compute_progress_percent(elapsed_seconds, active_run.configured_duration_seconds),
        summary_metrics: None,
        external_dashboard_url: None,
    }
}

fn snapshot_k6_output(app: &AppHandle) -> (Vec<ServiceLogEntry>, u64, String) {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let output = supervisor.output.lock().expect("k6 output lock should not be poisoned");
    (
        output.entries.iter().cloned().collect(),
        output.dropped_entries,
        if output.last_updated_at.is_empty() {
            Utc::now().to_rfc3339()
        } else {
            output.last_updated_at.clone()
        },
    )
}

fn prepare_k6_output_buffer_for_run(app: &AppHandle) -> u64 {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let mut output = supervisor.output.lock().expect("k6 output lock should not be poisoned");
    output.generation = output.generation.saturating_add(1);
    output.next_sequence = 0;
    output.dropped_entries = 0;
    output.entries.clear();
    output.last_updated_at = Utc::now().to_rfc3339();
    output.generation
}

fn spawn_k6_output_reader<R>(app: &AppHandle, generation: u64, stream: &'static str, reader: R)
where
    R: Read + Send + 'static,
{
    let output = {
        let supervisor = app.state::<K6RunnerSupervisor>();
        supervisor.output.clone()
    };

    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            let Ok(message) = line else {
                continue;
            };
            let trimmed = message.trim_end().to_string();
            if trimmed.is_empty() {
                continue;
            }

            append_k6_output_line(&output, generation, stream, &trimmed);
        }
    });
}

fn append_k6_output_line(
    output: &Arc<Mutex<ServiceLogBuffer>>,
    generation: u64,
    stream: &str,
    message: &str,
) {
    let mut output = output.lock().expect("k6 output lock should not be poisoned");

    if output.generation != generation {
        return;
    }

    let entry = ServiceLogEntry {
        sequence: output.next_sequence,
        timestamp: Utc::now().to_rfc3339(),
        stream: stream.to_string(),
        level: infer_log_level(stream, message).to_string(),
        message: message.to_string(),
    };
    push_log_entry(&mut output, entry);
}

fn refresh_k6_runner(app: &AppHandle) -> Result<(), AppError> {
    let finished = {
        let supervisor = app.state::<K6RunnerSupervisor>();
        let mut active_slot = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
        let Some(mut active_run) = active_slot.take() else {
            return Ok(());
        };

        let Some(process) = active_run.process.as_mut() else {
            return finalize_k6_run(app, active_run, "failed", None, false);
        };

        match process.try_wait() {
            Ok(Some(status)) => {
                active_run.process = None;
                Some((
                    active_run,
                    if status.success() { "completed" } else { "failed" },
                    status.code(),
                ))
            }
            Ok(None) => {
                *active_slot = Some(active_run);
                None
            }
            Err(_) => {
                active_run.process = None;
                Some((active_run, "failed", None))
            }
        }
    };

    if let Some((active_run, status, exit_code)) = finished {
        finalize_k6_run(app, active_run, status, exit_code, false)?;
    }

    Ok(())
}

fn recover_unmanaged_k6_runs(app: &AppHandle) -> Result<(), AppError> {
    let active_run_id = {
        let supervisor = app.state::<K6RunnerSupervisor>();
        let active_run = supervisor.active_run.lock().expect("k6 runner lock should not be poisoned");
        active_run.as_ref().map(|run| run.run_id.clone())
    };
    let connection = open_connection(app)?;
    let mut statement = connection.prepare(
        "SELECT id, started_at, summary_json
         FROM k6_run
         WHERE status = 'running'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let now = Utc::now().to_rfc3339();

    for row in rows {
        let (run_id, started_at, summary_json) = row?;
        if active_run_id.as_deref() == Some(run_id.as_str()) {
            continue;
        }

        let mut summary = parse_persisted_k6_summary(&summary_json);
        if summary.outcome.started_at.trim().is_empty() {
            summary.outcome.started_at = started_at;
        }
        summary.outcome.status = "failed".into();
        summary.outcome.finished_at = Some(now.clone());
        summary.interrupted_by_app_restart = true;

        connection.execute(
            "UPDATE k6_run
             SET status = 'failed',
                 finished_at = ?2,
                 summary_json = ?3
             WHERE id = ?1",
            params![run_id, now.as_str(), serialize_k6_summary(&summary)?],
        )?;
    }

    Ok(())
}

fn finalize_k6_run(
    app: &AppHandle,
    active_run: ActiveK6RunState,
    status: &str,
    exit_code: Option<i32>,
    interrupted_by_app_restart: bool,
) -> Result<(), AppError> {
    let finished_at = Utc::now().to_rfc3339();
    let summary_export_json = read_json_file_if_exists(Path::new(&active_run.summary_export_path));
    let raw_result_path = path_if_exists(Path::new(&active_run.result_path));
    let output_tail = collect_k6_output_tail(app, 30);
    let summary = PersistedK6RunSummary {
        config: build_persisted_k6_config(&active_run),
        outcome: PersistedK6RunOutcome {
            status: status.to_string(),
            exit_code,
            warning_service_stopped: active_run.warning_service_stopped,
            started_at: active_run.started_at.clone(),
            finished_at: Some(finished_at.clone()),
        },
        summary_export_path: Some(active_run.summary_export_path.clone()),
        summary_export_json,
        output_tail,
        external_dashboard_url: None,
        interrupted_by_app_restart,
    };

    let connection = open_connection(app)?;
    connection.execute(
        "UPDATE k6_run
         SET status = ?2,
             finished_at = ?3,
             summary_json = ?4,
             raw_result_path = ?5
         WHERE id = ?1",
        params![
            active_run.run_id,
            status,
            finished_at.as_str(),
            serialize_k6_summary(&summary)?,
            raw_result_path,
        ],
    )?;

    Ok(())
}

fn load_k6_run_history(connection: &Connection, limit: usize) -> Result<Vec<K6RunRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            k6_run.id,
            k6_run.service_id,
            service.name,
            k6_run.script_id,
            k6_script.name,
            k6_run.status,
            k6_run.started_at,
            k6_run.finished_at,
            k6_run.summary_json,
            k6_run.raw_result_path
         FROM k6_run
         INNER JOIN service ON service.id = k6_run.service_id
         INNER JOIN k6_script ON k6_script.id = k6_run.script_id
         INNER JOIN workspace ON workspace.id = service.workspace_id
         WHERE workspace.is_active = 1
           AND k6_run.status <> 'running'
         ORDER BY COALESCE(k6_run.finished_at, k6_run.started_at) DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map([limit as i64], |row| {
        let summary = parse_persisted_k6_summary(&row.get::<_, String>(8)?);
        let started_at: String = row.get(6)?;
        let finished_at: Option<String> = row.get(7)?;
        let configured_duration_seconds = summary.config.configured_duration_seconds;
        let elapsed_seconds =
            elapsed_seconds_from_timestamps(&started_at, finished_at.as_deref()).unwrap_or(configured_duration_seconds);
        let summary_metrics = build_k6_run_summary_metrics(&summary, elapsed_seconds);

        Ok(K6RunRecord {
            id: row.get(0)?,
            service_id: row.get(1)?,
            service_name: row.get(2)?,
            script_id: row.get(3)?,
            script_name: row.get(4)?,
            status: row.get(5)?,
            started_at,
            finished_at,
            pid: None,
            exit_code: summary.outcome.exit_code,
            warning_service_stopped: summary.outcome.warning_service_stopped,
            raw_result_path: row.get(9)?,
            summary_export_path: summary.summary_export_path.clone(),
            command_line: summary.config.command_line,
            configured_duration_seconds,
            elapsed_seconds,
            progress_percent: compute_progress_percent(elapsed_seconds, configured_duration_seconds),
            summary_metrics: Some(summary_metrics),
            external_dashboard_url: summary.external_dashboard_url,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_service_execution_history(
    connection: &Connection,
    service_id: &str,
    limit: usize,
) -> Result<Vec<ServiceExecutionRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            id,
            service_id,
            trigger_action,
            command_line,
            pid,
            detected_port,
            status,
            started_at,
            stopped_at,
            last_signal_text,
            last_issue_json
         FROM process_instance
         WHERE service_id = ?1
         ORDER BY COALESCE(started_at, stopped_at) DESC, id DESC
         LIMIT ?2",
    )?;
    let rows = statement.query_map(params![service_id, limit as i64], |row| {
        let pid = row
            .get::<_, Option<i64>>(4)?
            .and_then(|value| u32::try_from(value).ok());
        let detected_port = row
            .get::<_, Option<i64>>(5)?
            .and_then(|value| u16::try_from(value).ok());
        let started_at: Option<String> = row.get(7)?;
        let stopped_at: Option<String> = row.get(8)?;
        let last_issue_json: String = row.get(10)?;
        let duration_seconds = started_at
            .as_deref()
            .and_then(|started| elapsed_seconds_from_timestamps(started, stopped_at.as_deref()));

        Ok(ServiceExecutionRecord {
            id: row.get(0)?,
            service_id: row.get(1)?,
            trigger_action: row.get(2)?,
            command_line: row.get(3)?,
            pid,
            detected_port,
            status: row.get(6)?,
            started_at,
            stopped_at,
            duration_seconds,
            last_signal: row.get(9)?,
            issue: serde_json::from_str::<Option<ServiceActionIssue>>(&last_issue_json).unwrap_or(None),
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn build_k6_run_report(run: &K6RunRecord) -> Result<K6RunReport, AppError> {
    let summary = run
        .summary_metrics
        .clone()
        .unwrap_or_else(|| empty_k6_run_summary(run.elapsed_seconds));
    let charts = build_k6_run_charts(run.raw_result_path.as_deref())?;

    Ok(K6RunReport {
        run: run.clone(),
        summary,
        charts,
        external_dashboard_url: run.external_dashboard_url.clone(),
    })
}

fn build_k6_run_summary_metrics(summary: &PersistedK6RunSummary, duration_seconds: f64) -> K6RunSummaryMetrics {
    let latency_avg_ms = k6_summary_metric_number(summary.summary_export_json.as_ref(), "http_req_duration", "avg");
    let latency_p95_ms = k6_summary_metric_number(summary.summary_export_json.as_ref(), "http_req_duration", "p(95)");
    let latency_p99_ms = k6_summary_metric_number(summary.summary_export_json.as_ref(), "http_req_duration", "p(99)");
    let requests_per_second = k6_summary_metric_number(summary.summary_export_json.as_ref(), "http_reqs", "rate");
    let error_rate = k6_summary_metric_number(summary.summary_export_json.as_ref(), "http_req_failed", "value");
    let active_vus = k6_summary_metric_number(summary.summary_export_json.as_ref(), "vus", "max")
        .or_else(|| k6_summary_metric_number(summary.summary_export_json.as_ref(), "vus", "value"));
    let checks_pass = k6_summary_metric_number(summary.summary_export_json.as_ref(), "checks", "passes")
        .map(|value| value.max(0.0) as u64)
        .unwrap_or(0);
    let checks_fail = k6_summary_metric_number(summary.summary_export_json.as_ref(), "checks", "fails")
        .map(|value| value.max(0.0) as u64)
        .unwrap_or(0);
    let checks_pass_rate = k6_summary_metric_number(summary.summary_export_json.as_ref(), "checks", "value");

    let mut metrics = K6RunSummaryMetrics {
        latency_avg_ms,
        latency_p95_ms,
        latency_p99_ms,
        requests_per_second,
        error_rate,
        active_vus,
        duration_seconds,
        checks_pass,
        checks_fail,
        checks_pass_rate,
        thresholds: Vec::new(),
    };
    metrics.thresholds = summary
        .config
        .thresholds
        .iter()
        .map(|expression| evaluate_k6_threshold_result(expression, &metrics))
        .collect();
    metrics
}

fn empty_k6_run_summary(duration_seconds: f64) -> K6RunSummaryMetrics {
    K6RunSummaryMetrics {
        latency_avg_ms: None,
        latency_p95_ms: None,
        latency_p99_ms: None,
        requests_per_second: None,
        error_rate: None,
        active_vus: None,
        duration_seconds,
        checks_pass: 0,
        checks_fail: 0,
        checks_pass_rate: None,
        thresholds: Vec::new(),
    }
}

fn k6_summary_metric_number(summary_json: Option<&Value>, metric_name: &str, field_name: &str) -> Option<f64> {
    summary_json?
        .get("metrics")?
        .get(metric_name)?
        .get(field_name)?
        .as_f64()
}

fn evaluate_k6_threshold_result(expression: &str, metrics: &K6RunSummaryMetrics) -> K6ThresholdResult {
    let trimmed = expression.trim().to_string();
    let operators = ["<=", ">=", "==", "!=", "<", ">"];
    let Some((operator, index)) = operators
        .iter()
        .find_map(|operator| trimmed.find(operator).map(|index| (*operator, index)))
    else {
        return K6ThresholdResult {
            expression: trimmed,
            status: "not_evaluated".into(),
            actual_value: None,
            detail: "La expresion no se pudo interpretar para evaluacion local.".into(),
        };
    };

    let left = trimmed[..index].trim();
    let right = trimmed[index + operator.len()..].trim();
    let Some(expected_value) = right.parse::<f64>().ok() else {
        return K6ThresholdResult {
            expression: trimmed,
            status: "not_evaluated".into(),
            actual_value: None,
            detail: "El valor esperado no es numerico.".into(),
        };
    };

    let actual_value = resolve_threshold_metric_value(left, metrics);
    let Some(actual_value) = actual_value else {
        return K6ThresholdResult {
            expression: trimmed,
            status: "not_evaluated".into(),
            actual_value: None,
            detail: "La metrica no esta disponible en el resumen actual.".into(),
        };
    };

    let passed = match operator {
        "<=" => actual_value <= expected_value,
        ">=" => actual_value >= expected_value,
        "==" => (actual_value - expected_value).abs() < f64::EPSILON,
        "!=" => (actual_value - expected_value).abs() >= f64::EPSILON,
        "<" => actual_value < expected_value,
        ">" => actual_value > expected_value,
        _ => false,
    };

    K6ThresholdResult {
        expression: trimmed,
        status: if passed { "passed".into() } else { "failed".into() },
        actual_value: Some(actual_value),
        detail: format!("Actual {:.4} {} esperado {:.4}.", actual_value, if passed { "cumple" } else { "no cumple" }, expected_value),
    }
}

fn resolve_threshold_metric_value(metric: &str, metrics: &K6RunSummaryMetrics) -> Option<f64> {
    match metric {
        "avg" => metrics.latency_avg_ms,
        "p(95)" => metrics.latency_p95_ms,
        "p(99)" => metrics.latency_p99_ms,
        "http_req_failed" => metrics.error_rate,
        "http_reqs" => metrics.requests_per_second,
        "checks" => metrics.checks_pass_rate,
        "vus" | "vus_max" => metrics.active_vus,
        _ => None,
    }
}

fn build_k6_run_charts(raw_result_path: Option<&str>) -> Result<K6RunCharts, AppError> {
    let Some(raw_result_path) = raw_result_path else {
        return Ok(empty_k6_run_charts());
    };
    let path = PathBuf::from(raw_result_path);
    if !path.is_file() {
        return Ok(empty_k6_run_charts());
    }

    let contents = fs::read_to_string(path)?;
    Ok(build_k6_run_charts_from_ndjson(&contents))
}

fn build_k6_run_charts_from_ndjson(contents: &str) -> K6RunCharts {
    let mut buckets: BTreeMap<String, K6SeriesBucket> = BTreeMap::new();

    for line in contents.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(entry) = serde_json::from_str::<K6ResultLine>(line) else {
            continue;
        };
        if entry.line_type != "Point" {
            continue;
        }

        let Some(timestamp) = entry.data.time.as_deref().and_then(normalize_chart_timestamp) else {
            continue;
        };
        let Some(value) = entry.data.value else {
            continue;
        };
        let bucket = buckets.entry(timestamp).or_default();

        match entry.metric.as_str() {
            "http_req_duration" => bucket.latency_values_ms.push(value),
            "http_reqs" => bucket.request_count += value,
            "http_req_failed" => bucket.error_values.push(value),
            "vus" => bucket.vus_value = Some(value),
            "checks" => bucket.check_values.push(value),
            _ => {}
        }
    }

    let mut charts = empty_k6_run_charts();
    for (timestamp, bucket) in buckets {
        if !bucket.latency_values_ms.is_empty() {
            charts.latency_avg_ms.push(K6MetricPoint {
                timestamp: timestamp.clone(),
                value: average(&bucket.latency_values_ms),
            });
            charts.latency_p95_ms.push(K6MetricPoint {
                timestamp: timestamp.clone(),
                value: percentile(&bucket.latency_values_ms, 95.0),
            });
            charts.latency_p99_ms.push(K6MetricPoint {
                timestamp: timestamp.clone(),
                value: percentile(&bucket.latency_values_ms, 99.0),
            });
        }

        charts.requests_per_second.push(K6MetricPoint {
            timestamp: timestamp.clone(),
            value: bucket.request_count,
        });

        if !bucket.error_values.is_empty() {
            charts.error_rate.push(K6MetricPoint {
                timestamp: timestamp.clone(),
                value: average(&bucket.error_values),
            });
        }

        if let Some(vus_value) = bucket.vus_value {
            charts.vus_active.push(K6MetricPoint {
                timestamp: timestamp.clone(),
                value: vus_value,
            });
        }

        if !bucket.check_values.is_empty() {
            charts.checks_pass_rate.push(K6MetricPoint {
                timestamp,
                value: average(&bucket.check_values),
            });
        }
    }

    charts
}

fn empty_k6_run_charts() -> K6RunCharts {
    K6RunCharts {
        latency_avg_ms: Vec::new(),
        latency_p95_ms: Vec::new(),
        latency_p99_ms: Vec::new(),
        requests_per_second: Vec::new(),
        error_rate: Vec::new(),
        vus_active: Vec::new(),
        checks_pass_rate: Vec::new(),
    }
}

fn normalize_chart_timestamp(raw: &str) -> Option<String> {
    let timestamp = DateTime::parse_from_rfc3339(raw).ok()?;
    timestamp.with_nanosecond(0).map(|next| next.to_rfc3339())
}

fn average(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }

    values.iter().sum::<f64>() / values.len() as f64
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }

    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((percentile / 100.0) * (sorted.len().saturating_sub(1) as f64)).round() as usize;
    sorted[rank.min(sorted.len().saturating_sub(1))]
}

fn resolve_current_service_status(app: &AppHandle, service_id: &str, persisted_status: &str) -> String {
    let supervisor = app.state::<RuntimeSupervisor>();
    let services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
    services
        .get(service_id)
        .map(|runtime| runtime.status.clone())
        .unwrap_or_else(|| persisted_status.to_string())
}

fn prepare_k6_run_artifacts(app: &AppHandle, run_id: &str) -> Result<K6RunArtifacts, AppError> {
    let data_dir = app.path().app_data_dir().map_err(|_| AppError::MissingAppDataDir)?;
    let run_dir = data_dir.join("k6-runs").join(run_id);
    fs::create_dir_all(&run_dir)?;
    Ok(K6RunArtifacts {
        result_path: run_dir.join("result.json"),
        summary_export_path: run_dir.join("summary.json"),
    })
}

fn build_k6_run_arguments(
    vus: u32,
    duration: &str,
    rate: Option<u32>,
    result_path: &Path,
    summary_export_path: &Path,
    script_path: &Path,
) -> Vec<String> {
    let mut arguments = vec![
        "run".into(),
        "--vus".into(),
        vus.to_string(),
        "--duration".into(),
        duration.to_string(),
    ];

    if let Some(rate) = rate {
        arguments.push("--rps".into());
        arguments.push(rate.to_string());
    }

    arguments.push("--out".into());
    arguments.push(format!("json={}", normalize_path(result_path)));
    arguments.push("--summary-export".into());
    arguments.push(normalize_path(summary_export_path));
    arguments.push("--summary-mode=full".into());
    arguments.push(normalize_path(script_path));
    arguments
}

fn render_command_line(binary_path: &str, arguments: &[String]) -> String {
    std::iter::once(binary_path.to_string())
        .chain(arguments.iter().cloned())
        .map(|argument| quote_command_line_argument(&argument))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_command_line_argument(argument: &str) -> String {
    if argument.contains(' ') {
        format!("\"{argument}\"")
    } else {
        argument.to_string()
    }
}

fn parse_k6_duration_seconds(duration: &str) -> Option<f64> {
    if !is_valid_k6_duration(duration) {
        return None;
    }

    let chars = duration.trim().chars().collect::<Vec<_>>();
    let mut index = 0;
    let mut total_seconds = 0.0;

    while index < chars.len() {
        let digit_start = index;
        while index < chars.len() && chars[index].is_ascii_digit() {
            index += 1;
        }
        let value = chars[digit_start..index].iter().collect::<String>().parse::<f64>().ok()?;

        let unit_start = index;
        while index < chars.len() && chars[index].is_ascii_alphabetic() {
            index += 1;
        }
        let unit = chars[unit_start..index].iter().collect::<String>();
        total_seconds += match unit.as_str() {
            "ms" => value / 1000.0,
            "s" => value,
            "m" => value * 60.0,
            "h" => value * 3600.0,
            _ => return None,
        };
    }

    Some(total_seconds)
}

fn compute_progress_percent(elapsed_seconds: f64, configured_duration_seconds: f64) -> f64 {
    if configured_duration_seconds <= 0.0 {
        return 0.0;
    }

    ((elapsed_seconds / configured_duration_seconds) * 100.0).clamp(0.0, 100.0)
}

fn elapsed_seconds_from_timestamps(started_at: &str, finished_at: Option<&str>) -> Option<f64> {
    let started_at = DateTime::parse_from_rfc3339(started_at).ok()?;
    let finished_at = DateTime::parse_from_rfc3339(finished_at?).ok()?;
    Some((finished_at - started_at).num_milliseconds().max(0) as f64 / 1000.0)
}

fn build_persisted_k6_config(active_run: &ActiveK6RunState) -> PersistedK6RunConfig {
    PersistedK6RunConfig {
        profile_id: active_run.profile_id.clone(),
        vus: active_run.vus,
        duration: active_run.duration.clone(),
        rate: active_run.rate,
        thresholds: active_run.thresholds.clone(),
        binary_path: active_run.binary_path.clone(),
        command_line: active_run.command_line.clone(),
        configured_duration_seconds: active_run.configured_duration_seconds,
    }
}

fn parse_persisted_k6_summary(raw: &str) -> PersistedK6RunSummary {
    serde_json::from_str::<PersistedK6RunSummary>(raw).unwrap_or_default()
}

fn serialize_k6_summary(summary: &PersistedK6RunSummary) -> Result<String, AppError> {
    serde_json::to_string(summary).map_err(AppError::from)
}

fn read_json_file_if_exists(path: &Path) -> Option<Value> {
    if !path.is_file() {
        return None;
    }

    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&contents).ok()
}

fn path_if_exists(path: &Path) -> Option<String> {
    if path.exists() {
        Some(normalize_path(path))
    } else {
        None
    }
}

fn collect_k6_output_tail(app: &AppHandle, limit: usize) -> Vec<String> {
    let supervisor = app.state::<K6RunnerSupervisor>();
    let output = supervisor.output.lock().expect("k6 output lock should not be poisoned");
    output
        .entries
        .iter()
        .rev()
        .take(limit)
        .map(|entry| format!("[{}] {}", entry.stream, entry.message))
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn spawn_service_runtime(
    app: &AppHandle,
    launch: ServiceLaunchContext,
    restart_count: u32,
    is_restart: bool,
) -> Result<ServiceActionResponse, AppError> {
    let trigger_action = if is_restart { "restart" } else { "run" };
    let service_dir = resolve_service_directory(&launch)?;
    let Some(start_command) = launch.start_command.as_deref() else {
        let issue = build_service_issue(
            &launch.id,
            "missing_command",
            "Falta comando de arranque",
            "El servicio no tiene un start command configurado.",
            Some("Configura startCommand en el manifest o deja que autodiscovery resuelva scripts del proyecto."),
        );
        record_runtime_issue(app, &launch.id, issue.clone());
        return Ok(ServiceActionResponse {
            snapshot: build_dashboard_snapshot(app, false)?,
            issue: Some(issue),
        });
    };

    if let Err(error) = validate_service_start_command(Path::new(&launch.root_path), &service_dir, start_command) {
        let issue = build_service_issue(
            &launch.id,
            "command_not_allowed",
            "Comando bloqueado por allowlist",
            "El start command del servicio no cumple la politica de seguridad local.",
            Some(&error.to_string()),
        );
        let failure_signal = format!("Se bloqueo el arranque de {} por politica de comandos.", launch.name);
        let _ = persist_failed_process_instance(
            app,
            &launch.id,
            trigger_action,
            start_command,
            &failure_signal,
            &issue,
        );
        record_runtime_issue(app, &launch.id, issue.clone());
        return Ok(ServiceActionResponse {
            snapshot: build_dashboard_snapshot(app, false)?,
            issue: Some(issue),
        });
    }

    if let Some(expected_port) = launch.expected_port {
        if is_local_port_listening(expected_port) {
            let issue = build_service_issue(
                &launch.id,
                "port_occupied",
                "Puerto ocupado",
                &format!("El puerto esperado {expected_port} ya esta en uso."),
                Some("Libera el puerto, cambia expectedPort o corrige la configuracion del servicio."),
            );
            record_runtime_issue(app, &launch.id, issue.clone());
            return Ok(ServiceActionResponse {
                snapshot: build_dashboard_snapshot(app, false)?,
                issue: Some(issue),
            });
        }
    }

    let mut command = build_shell_process(start_command, &service_dir, &launch.env);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let issue = build_service_issue(
                &launch.id,
                "spawn_failed",
                "No se pudo lanzar el servicio",
                "El proceso no pudo iniciarse desde la app de escritorio.",
                Some(&error.to_string()),
            );
            let failure_signal = format!("No se pudo lanzar {} desde la app de escritorio.", launch.name);
            let _ = persist_failed_process_instance(
                app,
                &launch.id,
                trigger_action,
                start_command,
                &failure_signal,
                &issue,
            );
            record_runtime_issue(app, &launch.id, issue.clone());
            return Ok(ServiceActionResponse {
                snapshot: build_dashboard_snapshot(app, false)?,
                issue: Some(issue),
            });
        }
    };

    let log_generation = prepare_service_log_buffer_for_run(app, &launch.id);
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(app, launch.id.clone(), log_generation, "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(app, launch.id.clone(), log_generation, "stderr", stderr);
    }

    let pid = child.id();
    let now = Utc::now().to_rfc3339();
    let start_signal = if is_restart {
        format!("Restart #{} solicitado para {}.", restart_count, launch.name)
    } else {
        format!("Run solicitado para {}.", launch.name)
    };
    let process_instance_id = persist_process_instance_start(
        app,
        &launch.id,
        trigger_action,
        start_command,
        pid,
        &now,
        &start_signal,
    )?;

    {
        let supervisor = app.state::<RuntimeSupervisor>();
        let mut services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
        services.insert(
            launch.id.clone(),
            RuntimeServiceState {
                process_instance_id: Some(process_instance_id),
                process: Some(child),
                pid: Some(pid),
                started_at: Some(now),
                launch_instant: Instant::now(),
                expected_port: launch.expected_port,
                detected_port: None,
                status: "starting".into(),
                last_signal: start_signal.clone(),
                issue: None,
                restart_count,
            },
        );
    }

    persist_service_runtime_state(
        app,
        &launch.id,
        "starting",
        None,
        &start_signal,
        None,
    )?;

    Ok(ServiceActionResponse {
        snapshot: build_dashboard_snapshot(app, false)?,
        issue: None,
    })
}

struct StopRuntimeOutcome {
    issue: Option<ServiceActionIssue>,
    restart_count: u32,
}

enum StopIntent {
    ManualStop,
    Restart,
    AppExit,
}

fn stop_runtime_service(
    app: &AppHandle,
    launch: &ServiceLaunchContext,
    intent: StopIntent,
) -> Result<StopRuntimeOutcome, AppError> {
    let runtime = {
        let supervisor = app.state::<RuntimeSupervisor>();
        let mut services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
        services.remove(&launch.id)
    };

    let Some(mut runtime) = runtime else {
        let issue = match intent {
            StopIntent::AppExit => None,
            StopIntent::ManualStop => Some(build_service_issue(
                &launch.id,
                "service_not_running",
                "Servicio no supervisado",
                "La app no tiene un proceso activo para detener.",
                Some("Ejecuta Run antes de solicitar Stop."),
            )),
            StopIntent::Restart => Some(build_service_issue(
                &launch.id,
                "service_not_running",
                "Servicio no supervisado",
                "La app no tiene un proceso activo para reiniciar.",
                Some("Ejecuta Run antes de solicitar Restart."),
            )),
        };

        if let Some(issue) = issue.clone() {
            record_runtime_issue(app, &launch.id, issue.clone());
        }

        return Ok(StopRuntimeOutcome {
            issue,
            restart_count: 0,
        });
    };

    let next_restart_count = runtime.restart_count;
    let process_instance_id = runtime.process_instance_id.clone();
    let stop_signal = match intent {
        StopIntent::ManualStop => format!("Stop solicitado para {}.", launch.name),
        StopIntent::Restart => format!("Restart solicitado para {}: deteniendo proceso actual.", launch.name),
        StopIntent::AppExit => format!("Cerrando supervisor local para {}.", launch.name),
    };

    let issue = if let Some(mut child) = runtime.process.take() {
        terminate_supervised_process(&mut child, runtime.pid).err().map(|detail| {
            build_service_issue(
                &launch.id,
                "orphan_process",
                "No se pudo detener el proceso supervisado",
                "El proceso quedo fuera de supervision y puede seguir activo.",
                Some(&detail),
            )
        })
    } else {
        None
    };

    if let Some(issue) = issue.clone() {
        let orphan_signal = format!("{} El proceso pudo quedar huerfano.", stop_signal);
        persist_service_runtime_state(app, &launch.id, "error", runtime.detected_port, &orphan_signal, Some(&issue))?;
        if let Some(process_instance_id) = process_instance_id.as_deref() {
            persist_process_instance_state(
                app,
                process_instance_id,
                runtime.pid,
                runtime.detected_port,
                "error",
                &orphan_signal,
                Some(&issue),
            )?;
        }
        record_runtime_issue(app, &launch.id, issue.clone());
        return Ok(StopRuntimeOutcome {
            issue: Some(issue),
            restart_count: next_restart_count,
        });
    }

    if let Some(port) = runtime.detected_port.or(runtime.expected_port).filter(|value| is_local_port_listening(*value)) {
        let issue = build_service_issue(
            &launch.id,
            "orphan_process",
            "Puerto aun ocupado tras Stop",
            "El supervisor detuvo su proceso principal, pero el puerto esperado sigue ocupado.",
            Some(&format!("El puerto {port} sigue escuchando y el servicio puede haber quedado huerfano.")),
        );
        persist_service_runtime_state(app, &launch.id, "error", Some(port), &stop_signal, Some(&issue))?;
        if let Some(process_instance_id) = process_instance_id.as_deref() {
            persist_process_instance_state(
                app,
                process_instance_id,
                runtime.pid,
                Some(port),
                "error",
                &stop_signal,
                Some(&issue),
            )?;
        }
        record_runtime_issue(app, &launch.id, issue.clone());
        return Ok(StopRuntimeOutcome {
            issue: Some(issue),
            restart_count: next_restart_count,
        });
    }

    runtime.pid = None;
    runtime.detected_port = None;
    runtime.status = "stopped".into();
    runtime.issue = None;
    runtime.last_signal = stop_signal.clone();

    persist_service_runtime_state(app, &launch.id, "stopped", None, &stop_signal, None)?;
    if let Some(process_instance_id) = process_instance_id.as_deref() {
        persist_process_instance_state(
            app,
            process_instance_id,
            runtime.pid,
            runtime.detected_port,
            "stopped",
            &stop_signal,
            None,
        )?;
    }

    Ok(StopRuntimeOutcome {
        issue: None,
        restart_count: next_restart_count,
    })
}

fn sync_workspace_catalog(app: &AppHandle, selected_path: PathBuf) -> Result<DashboardSnapshot, AppError> {
    let canonical_path = fs::canonicalize(selected_path)?;
    let root_path = normalize_path(&canonical_path);
    let now = Utc::now().to_rfc3339();

    let mut connection = open_connection(app)?;
    let existing = connection
        .query_row(
            "SELECT id, created_at FROM workspace WHERE root_path = ?1 LIMIT 1",
            [root_path.as_str()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;

    let workspace = Workspace {
        id: existing
            .as_ref()
            .map(|row| row.0.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        name: workspace_name_from_path(&canonical_path),
        root_path: root_path.clone(),
        created_at: existing
            .as_ref()
            .map(|row| row.1.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
        last_scanned_at: Some(now),
        is_active: true,
    };

    let services = scan_services(&canonical_path, &workspace.id)?;
    persist_workspace_catalog(&mut connection, &workspace, &services)?;

    get_dashboard_snapshot(app)
}

fn load_active_workspace_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let connection = open_connection(app)?;
    let active_workspace = connection
        .query_row(
            "SELECT root_path FROM workspace WHERE is_active = 1 LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(AppError::NoActiveWorkspace)?;

    Ok(PathBuf::from(active_workspace))
}

fn load_service_launch_context(app: &AppHandle, service_id: &str) -> Result<ServiceLaunchContext, AppError> {
    let connection = open_connection(app)?;
    connection.query_row(
        "SELECT
            service.id,
            service.name,
            workspace.root_path,
            service.path,
            service.expected_port,
            service.start_command,
            service.env_json
         FROM service
         INNER JOIN workspace ON workspace.id = service.workspace_id
         WHERE service.id = ?1
         LIMIT 1",
        [service_id],
        |row| {
            let expected_port = row
                .get::<_, Option<i64>>(4)?
                .and_then(|value| u16::try_from(value).ok());
            let env_json: String = row.get(6)?;
            let env = serde_json::from_str::<BTreeMap<String, String>>(&env_json).unwrap_or_default();

            Ok(ServiceLaunchContext {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                path: row.get(3)?,
                expected_port,
                start_command: row.get(5)?,
                env,
            })
        },
    )
    .map_err(AppError::from)
}

fn load_k6_run_launch_context(
    app: &AppHandle,
    service_id: &str,
    script_id: &str,
) -> Result<K6RunLaunchContext, AppError> {
    let connection = open_connection(app)?;
    let context = connection
        .query_row(
            "SELECT
                workspace.root_path,
                service.id,
                service.name,
                service.last_known_status,
                k6_script.id,
                k6_script.name,
                k6_script.path
             FROM k6_script
             INNER JOIN service ON service.id = k6_script.service_id
             INNER JOIN workspace ON workspace.id = service.workspace_id
             WHERE workspace.is_active = 1
               AND service.id = ?1
               AND k6_script.id = ?2
             LIMIT 1",
            params![service_id, script_id],
            |row| {
                Ok(K6RunLaunchContext {
                    workspace_root: PathBuf::from(row.get::<_, String>(0)?),
                    service_id: row.get(1)?,
                    service_name: row.get(2)?,
                    service_status: row.get(3)?,
                    script_id: row.get(4)?,
                    script_name: row.get(5)?,
                    script_path: row.get(6)?,
                })
            },
        )
        .optional()?;
    let Some(context) = context else {
        return Err(AppError::MissingK6Script(script_id.to_string()));
    };

    let script_absolute_path = context.workspace_root.join(relative_source_root(&context.script_path));
    if !script_absolute_path.is_file() {
        return Err(AppError::MissingK6Script(normalize_path(&script_absolute_path)));
    }
    ensure_path_within_root(&context.workspace_root, &script_absolute_path)?;

    Ok(context)
}

fn load_active_workspace_k6_context(connection: &Connection) -> Result<Option<WorkspaceK6Context>, AppError> {
    let workspace = connection
        .query_row(
            "SELECT id, root_path FROM workspace WHERE is_active = 1 LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((workspace_id, root_path)) = workspace else {
        return Ok(None);
    };

    let mut statement = connection.prepare(
        "SELECT id, path
         FROM service
         WHERE workspace_id = ?1
         ORDER BY path ASC",
    )?;
    let rows = statement.query_map([workspace_id.as_str()], |row| {
        Ok(ServiceK6Context {
            service_id: row.get(0)?,
            relative_path: row.get(1)?,
        })
    })?;

    Ok(Some(WorkspaceK6Context {
        workspace_id,
        root_path: PathBuf::from(root_path),
        services: rows.collect::<Result<Vec<_>, _>>()?,
    }))
}

fn sync_k6_script_catalog(connection: &mut Connection, workspace: &WorkspaceK6Context) -> Result<(), AppError> {
    let tx = connection.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM k6_script
         WHERE service_id IN (SELECT id FROM service WHERE workspace_id = ?1)
           AND source = 'autodiscovery'",
        [workspace.workspace_id.as_str()],
    )?;

    let now = Utc::now().to_rfc3339();
    for service in &workspace.services {
        let service_root = workspace.root_path.join(relative_source_root(&service.relative_path));
        if !service_root.exists() {
            continue;
        }

        for script_path in discover_k6_scripts_for_service(&service_root)? {
            let relative_path = normalize_relative_path(
                script_path
                    .strip_prefix(&workspace.root_path)
                    .map_err(|_| AppError::InvalidK6ScriptWorkspaceBoundary)?,
            );
            let script_id = format!("{}::{}", service.service_id, relative_path);

            tx.execute(
                "INSERT INTO k6_script (id, service_id, name, path, source, default_config_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'autodiscovery', '{}', ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    path = excluded.path,
                    source = excluded.source,
                    updated_at = excluded.updated_at",
                params![
                    script_id,
                    service.service_id,
                    derive_k6_script_name(&relative_path),
                    relative_path,
                    now.as_str(),
                    now.as_str(),
                ],
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

fn load_k6_scripts(connection: &Connection) -> Result<Vec<K6ScriptRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            k6_script.id,
            k6_script.service_id,
            service.name,
            k6_script.name,
            k6_script.path,
            k6_script.source
         FROM k6_script
         INNER JOIN service ON service.id = k6_script.service_id
         INNER JOIN workspace ON workspace.id = service.workspace_id
         WHERE workspace.is_active = 1
         ORDER BY service.name ASC, k6_script.path ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(K6ScriptRecord {
            id: row.get(0)?,
            service_id: row.get(1)?,
            service_name: row.get(2)?,
            name: row.get(3)?,
            path: row.get(4)?,
            source: row.get(5)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn discover_k6_scripts_for_service(service_root: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut scripts = Vec::new();

    for entry in WalkDir::new(service_root)
        .max_depth(5)
        .into_iter()
        .filter_entry(|entry| should_walk(entry))
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if !is_supported_k6_extension(path) || !looks_like_k6_script(path)? {
            continue;
        }

        scripts.push(path.to_path_buf());
    }

    scripts.sort();
    scripts.dedup();
    Ok(scripts)
}

fn is_supported_k6_extension(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("js" | "ts" | "mjs" | "cjs")
    )
}

fn looks_like_k6_script(path: &Path) -> Result<bool, AppError> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let recent_segments = path
        .components()
        .rev()
        .take(3)
        .filter_map(|component| component.as_os_str().to_str())
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();

    let path_hint = ["k6", "load", "perf", "performance", "stress", "smoke", "spike"]
        .iter()
        .any(|token| {
            file_name.contains(token) ||
                recent_segments
                    .iter()
                    .any(|segment| segment.contains(token))
        });

    let contents = fs::read_to_string(path)?;
    let content_hint = [
        "from 'k6'",
        "from \"k6\"",
        "from 'k6/http'",
        "from \"k6/http\"",
        "import http from 'k6/http'",
        "import http from \"k6/http\"",
        "check(",
        "group(",
    ]
    .iter()
    .any(|token| contents.contains(token));

    Ok(path_hint || content_hint)
}

fn derive_k6_script_name(relative_path: &str) -> String {
    Path::new(&relative_source_root(relative_path))
        .file_stem()
        .and_then(|value| value.to_str())
        .map(normalize_service_name)
        .unwrap_or_else(|| "k6-script".into())
}

fn validate_k6_script_path(workspace_root: &Path, raw_path: &str) -> Result<String, AppError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidK6ScriptPath(raw_path.to_string()));
    }

    let candidate = workspace_root.join(relative_source_root(trimmed));
    let canonical_workspace = fs::canonicalize(workspace_root)?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|_| AppError::InvalidK6ScriptPath(normalize_path(&candidate)))?;

    if !canonical_candidate.starts_with(&canonical_workspace) {
        return Err(AppError::InvalidK6ScriptWorkspaceBoundary);
    }

    Ok(normalize_relative_path(
        canonical_candidate
            .strip_prefix(&canonical_workspace)
            .map_err(|_| AppError::InvalidK6ScriptWorkspaceBoundary)?,
    ))
}

fn default_k6_profiles() -> Vec<K6ProfilePreset> {
    vec![
        K6ProfilePreset {
            id: "smoke".into(),
            label: "Smoke".into(),
            vus: 1,
            duration: "30s".into(),
            rate: Some(1),
            thresholds: vec!["http_req_failed<0.01".into(), "checks>0.95".into()],
        },
        K6ProfilePreset {
            id: "load".into(),
            label: "Load".into(),
            vus: 10,
            duration: "5m".into(),
            rate: Some(10),
            thresholds: vec!["p(95)<500".into(), "http_req_failed<0.02".into()],
        },
        K6ProfilePreset {
            id: "stress".into(),
            label: "Stress".into(),
            vus: 50,
            duration: "10m".into(),
            rate: Some(50),
            thresholds: vec!["p(95)<900".into(), "http_req_failed<0.05".into()],
        },
        K6ProfilePreset {
            id: "spike".into(),
            label: "Spike".into(),
            vus: 100,
            duration: "1m".into(),
            rate: Some(100),
            thresholds: vec!["p(95)<1200".into(), "http_req_failed<0.08".into()],
        },
    ]
}

fn resolve_k6_binary_status(connection: Option<&Connection>, override_path: Option<&str>) -> K6BinaryStatus {
    let preferred_path = override_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| connection.and_then(|connection| load_global_k6_binary_path_preference(connection).ok().flatten()));
    let trimmed_override = preferred_path.as_deref();

    if override_path.is_some() && trimmed_override.is_none() {
        return K6BinaryStatus {
            is_available: false,
            resolved_path: None,
            detail: AppError::InvalidK6BinaryPath.to_string(),
        };
    }

    if let Some(override_path) = trimmed_override {
        let override_candidate = PathBuf::from(override_path);
        if !is_allowed_k6_binary_name(&override_candidate) {
            return K6BinaryStatus {
                is_available: false,
                resolved_path: Some(override_path.to_string()),
                detail: AppError::DisallowedK6BinaryPath(
                    "El binario configurado debe llamarse k6 o k6.exe.".into(),
                )
                .to_string(),
            };
        }
    }

    let candidates = if let Some(override_path) = trimmed_override {
        vec![PathBuf::from(override_path)]
    } else {
        default_k6_binary_candidates()
    };

    for candidate in candidates {
        if let Some(resolved_path) = validate_k6_binary_candidate(&candidate) {
            return K6BinaryStatus {
                is_available: true,
                resolved_path: Some(resolved_path),
                detail: "Binario k6 validado correctamente.".into(),
            };
        }
    }

    K6BinaryStatus {
        is_available: false,
        resolved_path: trimmed_override.map(str::to_string),
        detail: "No se encontro un binario k6 valido en la ruta configurada ni en el entorno local.".into(),
    }
}

fn default_k6_binary_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("k6"), PathBuf::from("k6.exe")];

    if cfg!(windows) {
        if let Ok(root) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(root).join("k6").join("k6.exe"));
        }
        if let Ok(root) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(root).join("k6").join("k6.exe"));
        }
    }

    candidates
}

fn validate_k6_binary_candidate(candidate: &Path) -> Option<String> {
    if !is_allowed_k6_binary_name(candidate) {
        return None;
    }

    let output = Command::new(candidate).arg("version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    if !stdout.contains("k6") && !stderr.contains("k6") {
        return None;
    }

    Some(normalize_path(candidate))
}

fn validate_k6_thresholds(thresholds: &[String]) -> Vec<K6ThresholdValidation> {
    thresholds
        .iter()
        .map(|threshold| validate_k6_threshold(threshold))
        .collect()
}

fn validate_k6_threshold(threshold: &str) -> K6ThresholdValidation {
    let expression = threshold.trim().to_string();
    if expression.is_empty() {
        return K6ThresholdValidation {
            expression,
            is_valid: false,
            detail: "Threshold vacio.".into(),
        };
    }

    let operators = ["<=", ">=", "==", "!=", "<", ">"];
    let Some((operator, index)) = operators
        .iter()
        .find_map(|operator| expression.find(operator).map(|index| (*operator, index)))
    else {
        return K6ThresholdValidation {
            expression,
            is_valid: false,
            detail: "Threshold debe incluir un operador valido: <, <=, >, >=, == o !=.".into(),
        };
    };

    let left = expression[..index].trim();
    let right = expression[index + operator.len()..].trim();
    let left_valid = !left.is_empty()
        && left
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '(' | ')' | '.'));
    let right_valid = right.parse::<f64>().is_ok();

    K6ThresholdValidation {
        expression,
        is_valid: left_valid && right_valid,
        detail: if left_valid && right_valid {
            "Threshold valido.".into()
        } else if !left_valid {
            "El nombre de la metrica contiene caracteres no soportados.".into()
        } else {
            "El valor del threshold debe ser numerico.".into()
        },
    }
}

fn is_allowed_k6_binary_name(candidate: &Path) -> bool {
    matches!(normalize_command_name(&candidate.to_string_lossy()), Some(name) if name == "k6")
}

fn is_valid_k6_duration(duration: &str) -> bool {
    let trimmed = duration.trim();
    if trimmed.is_empty() {
        return false;
    }

    let chars = trimmed.chars().collect::<Vec<_>>();
    let mut index = 0;

    while index < chars.len() {
        let digit_start = index;
        while index < chars.len() && chars[index].is_ascii_digit() {
            index += 1;
        }
        if digit_start == index {
            return false;
        }

        let unit_start = index;
        while index < chars.len() && chars[index].is_ascii_alphabetic() {
            index += 1;
        }
        if unit_start == index {
            return false;
        }

        let unit = chars[unit_start..index].iter().collect::<String>();
        if !matches!(unit.as_str(), "ms" | "s" | "m" | "h") {
            return false;
        }
    }

    true
}

fn can_start_service(app: &AppHandle, service: &ServiceLaunchContext) -> Option<ServiceActionIssue> {
    let supervisor = app.state::<RuntimeSupervisor>();
    let services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
    let runtime = services.get(&service.id)?;

    if matches!(runtime.status.as_str(), "starting" | "running") {
        return Some(build_service_issue(
            &service.id,
            "already_running",
            "Servicio ya supervisado",
            "La app ya tiene este servicio en estado starting o running.",
            Some("Usa Stop o Restart desde la UI antes de volver a solicitar Run."),
        ));
    }

    None
}

fn apply_runtime_overlay(app: &AppHandle, services: &mut [ServiceRecord]) {
    let supervisor = app.state::<RuntimeSupervisor>();
    let states = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");

    for service in services.iter_mut() {
        let Some(runtime) = states.get(&service.id) else {
            continue;
        };

        service.status = runtime.status.clone();
        service.pid = runtime.pid;
        service.detected_port = runtime.detected_port.or(service.detected_port);
        service.last_signal = runtime.last_signal.clone();
        service.issue = runtime.issue.clone();

        if let Some(started_at) = &runtime.started_at {
            service.created_at = started_at.clone();
            service.uptime_seconds = compute_uptime_seconds(started_at);
        }
    }
}

fn collect_system_metrics(services: &mut [ServiceRecord], gpu_mode: &str) -> SystemMetrics {
    let platform_metrics = collect_platform_metrics(services, gpu_mode);

    for service in services.iter_mut() {
        service.cpu_percent = 0.0;
        service.memory_bytes = 0;
        service.gpu_percent = None;
        service.gpu_memory_bytes = None;

        if service.detected_port.is_none() {
            service.detected_port = resolve_runtime_port(service);
        }

        if matches!(service.status.as_str(), "running" | "starting") {
            service.uptime_seconds = compute_uptime_seconds(&service.created_at);
        }
    }

    if let Some(metrics) = platform_metrics {
        for service in services.iter_mut() {
            let Some(pid) = service.pid else {
                continue;
            };
            let Some(process) = metrics.processes.get(&pid) else {
                continue;
            };

            service.cpu_percent = process.cpu_percent;
            service.memory_bytes = process.memory_bytes;
            service.gpu_percent = process.gpu_percent;
            service.gpu_memory_bytes = process.gpu_memory_bytes;
        }

        return SystemMetrics {
            cpu_total_percent: metrics.cpu_total_percent,
            memory_used_bytes: metrics.memory_used_bytes,
            memory_total_bytes: metrics.memory_total_bytes,
            gpu_total_percent: metrics.gpu_total_percent,
            last_refresh_at: Utc::now().to_rfc3339(),
        };
    }

    SystemMetrics {
        cpu_total_percent: 0.0,
        memory_used_bytes: 0,
        memory_total_bytes: 0,
        gpu_total_percent: None,
        last_refresh_at: Utc::now().to_rfc3339(),
    }
}

fn resolve_runtime_port(service: &ServiceRecord) -> Option<u16> {
    if let Some(detected_port) = service.detected_port.filter(|value| is_local_port_listening(*value)) {
        return Some(detected_port);
    }

    service
        .expected_port
        .filter(|value| matches!(service.status.as_str(), "running" | "starting") && is_local_port_listening(*value))
}

fn collect_platform_metrics(services: &[ServiceRecord], gpu_mode: &str) -> Option<PlatformMetricsSnapshot> {
    #[cfg(windows)]
    {
        return collect_windows_metrics(services, gpu_mode);
    }

    #[cfg(not(windows))]
    {
        let _ = (services, gpu_mode);
        None
    }
}

#[cfg(windows)]
fn collect_windows_metrics(services: &[ServiceRecord], gpu_mode: &str) -> Option<PlatformMetricsSnapshot> {
    let pid_list = services
        .iter()
        .filter_map(|service| service.pid)
        .collect::<Vec<_>>();
    let pid_values = if pid_list.is_empty() {
        String::new()
    } else {
        pid_list
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",")
    };

    let script = format!(
        concat!(
            "$ids = @({pid_values});",
            "$processes = @();",
            "if ($ids.Count -gt 0) {{",
            "  $processes = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ",
            "    Where-Object {{ $ids -contains [int]$_.IDProcess }} | ",
            "    Select-Object ",
            "      @{{Name='pid';Expression={{[int]$_.IDProcess}}}},",
            "      @{{Name='cpuPercent';Expression={{[double]$_.PercentProcessorTime}}}},",
            "      @{{Name='memoryBytes';Expression={{[uint64]$_.WorkingSetPrivate}}}};",
            "}};",
            "$os = Get-CimInstance Win32_OperatingSystem;",
            "$totalCpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\" | ",
            "  Select-Object -First 1 -ExpandProperty PercentProcessorTime;",
            "[pscustomobject]@{{",
            "  cpuTotalPercent = [double]$totalCpu;",
            "  memoryUsedBytes = [uint64](([uint64]$os.TotalVisibleMemorySize - [uint64]$os.FreePhysicalMemory) * 1024);",
            "  memoryTotalBytes = [uint64]([uint64]$os.TotalVisibleMemorySize * 1024);",
            "  processes = @($processes)",
            "}} | ConvertTo-Json -Compress"
        ),
        pid_values = pid_values,
    );

    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let payload = serde_json::from_str::<WindowsMetricsPayload>(stdout.trim()).ok()?;
    let processes = payload
        .processes
        .into_iter()
        .map(|process| {
            (
                process.pid,
                ProcessMetricsSnapshot {
                    cpu_percent: process.cpu_percent,
                    memory_bytes: process.memory_bytes,
                    gpu_percent: None,
                    gpu_memory_bytes: None,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    let mut snapshot = PlatformMetricsSnapshot {
        cpu_total_percent: payload.cpu_total_percent.unwrap_or(0.0),
        memory_used_bytes: payload.memory_used_bytes.unwrap_or(0),
        memory_total_bytes: payload.memory_total_bytes.unwrap_or(0),
        gpu_total_percent: None,
        processes,
    };

    if gpu_mode != "disabled" {
        if let Some(gpu_metrics) = collect_nvidia_gpu_metrics(&pid_list) {
            snapshot.gpu_total_percent = gpu_metrics.total_percent;

            for (pid, process_gpu) in gpu_metrics.processes {
                let process_metrics = snapshot.processes.entry(pid).or_insert(ProcessMetricsSnapshot {
                    cpu_percent: 0.0,
                    memory_bytes: 0,
                    gpu_percent: None,
                    gpu_memory_bytes: None,
                });

                if process_gpu.gpu_percent.is_some() {
                    process_metrics.gpu_percent = process_gpu.gpu_percent;
                }

                if process_gpu.gpu_memory_bytes.is_some() {
                    process_metrics.gpu_memory_bytes = process_gpu.gpu_memory_bytes;
                }
            }
        }
    }

    Some(snapshot)
}

#[cfg(windows)]
fn collect_nvidia_gpu_metrics(pid_list: &[u32]) -> Option<NvidiaGpuSnapshot> {
    let total_percent = run_nvidia_smi(&["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"])
        .and_then(|stdout| parse_nvidia_gpu_total(&stdout));
    let mut processes = BTreeMap::new();

    if let Some(stdout) = run_nvidia_smi(&["pmon", "-c", "1", "-s", "u"]) {
        for (pid, metrics) in parse_nvidia_pmon(&stdout, pid_list) {
            let process = processes.entry(pid).or_insert_with(NvidiaProcessMetric::default);
            process.gpu_percent = merge_optional_numbers(process.gpu_percent, metrics.gpu_percent);
        }
    }

    if let Some(stdout) = run_nvidia_smi(&[
        "--query-compute-apps=pid,used_gpu_memory",
        "--format=csv,noheader,nounits",
    ]) {
        for (pid, metrics) in parse_nvidia_compute_apps_memory(&stdout, pid_list) {
            let process = processes.entry(pid).or_insert_with(NvidiaProcessMetric::default);
            process.gpu_memory_bytes = match (process.gpu_memory_bytes, metrics.gpu_memory_bytes) {
                (Some(current), Some(next)) => Some(current.saturating_add(next)),
                (None, Some(next)) => Some(next),
                (current, None) => current,
            };
        }
    }

    if total_percent.is_none() && processes.is_empty() {
        return None;
    }

    Some(NvidiaGpuSnapshot {
        total_percent,
        processes,
    })
}

#[cfg(windows)]
fn run_nvidia_smi(args: &[&str]) -> Option<String> {
    for candidate in nvidia_smi_candidates() {
        let Ok(output) = Command::new(&candidate).args(args).output() else {
            continue;
        };
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                return Some(stdout);
            }
        }
    }

    None
}

#[cfg(windows)]
fn nvidia_smi_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("nvidia-smi.exe")];

    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        let Ok(root) = std::env::var(variable) else {
            continue;
        };
        let candidate = PathBuf::from(root).join("NVIDIA Corporation").join("NVSMI").join("nvidia-smi.exe");
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }

    candidates
}

#[cfg(windows)]
fn parse_nvidia_gpu_total(stdout: &str) -> Option<f64> {
    let values = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(parse_nvidia_number)
        .collect::<Vec<_>>();

    if values.is_empty() {
        return None;
    }

    Some(values.iter().sum::<f64>() / values.len() as f64)
}

#[cfg(windows)]
fn parse_nvidia_pmon(stdout: &str, pid_list: &[u32]) -> BTreeMap<u32, NvidiaProcessMetric> {
    let allowed = pid_list.iter().copied().collect::<std::collections::BTreeSet<_>>();
    let mut processes = BTreeMap::new();

    for line in stdout.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
        let columns = line.split_whitespace().collect::<Vec<_>>();
        if columns.len() < 4 {
            continue;
        }

        let Ok(pid) = columns[1].parse::<u32>() else {
            continue;
        };
        if !allowed.contains(&pid) {
            continue;
        }

        let gpu_percent = parse_nvidia_number(columns[3]);
        let process = processes.entry(pid).or_insert_with(NvidiaProcessMetric::default);
        process.gpu_percent = merge_optional_numbers(process.gpu_percent, gpu_percent);
    }

    processes
}

#[cfg(windows)]
fn parse_nvidia_compute_apps_memory(stdout: &str, pid_list: &[u32]) -> BTreeMap<u32, NvidiaProcessMetric> {
    let allowed = pid_list.iter().copied().collect::<std::collections::BTreeSet<_>>();
    let mut processes = BTreeMap::new();

    for line in stdout.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let columns = line.split(',').map(str::trim).collect::<Vec<_>>();
        if columns.len() < 2 {
            continue;
        }

        let Ok(pid) = columns[0].parse::<u32>() else {
            continue;
        };
        if !allowed.contains(&pid) {
            continue;
        }

        let Some(memory_mib) = parse_nvidia_number(columns[1]) else {
            continue;
        };

        let process = processes.entry(pid).or_insert_with(NvidiaProcessMetric::default);
        let next_value = Some((memory_mib.max(0.0) as u64).saturating_mul(1024 * 1024));
        process.gpu_memory_bytes = match (process.gpu_memory_bytes, next_value) {
            (Some(current), Some(next)) => Some(current.saturating_add(next)),
            (None, value) => value,
            (value, None) => value,
        };
    }

    processes
}

#[cfg(windows)]
fn parse_nvidia_number(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "-" || trimmed.eq_ignore_ascii_case("n/a") || trimmed.eq_ignore_ascii_case("[not supported]") {
        return None;
    }

    trimmed.parse::<f64>().ok()
}

#[cfg(windows)]
fn merge_optional_numbers(current: Option<f64>, next: Option<f64>) -> Option<f64> {
    match (current, next) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (None, some) | (some, None) => some,
    }
}

fn snapshot_service_logs(app: &AppHandle, service_id: &str) -> ServiceLogSnapshot {
    let supervisor = app.state::<RuntimeSupervisor>();
    let logs = supervisor.logs.lock().expect("runtime logs lock should not be poisoned");

    if let Some(buffer) = logs.get(service_id) {
        return ServiceLogSnapshot {
            service_id: service_id.to_string(),
            entries: buffer.entries.iter().cloned().collect(),
            dropped_entries: buffer.dropped_entries,
            last_updated_at: if buffer.last_updated_at.is_empty() {
                Utc::now().to_rfc3339()
            } else {
                buffer.last_updated_at.clone()
            },
        };
    }

    ServiceLogSnapshot {
        service_id: service_id.to_string(),
        entries: Vec::new(),
        dropped_entries: 0,
        last_updated_at: Utc::now().to_rfc3339(),
    }
}

fn prepare_service_log_buffer_for_run(app: &AppHandle, service_id: &str) -> u64 {
    let supervisor = app.state::<RuntimeSupervisor>();
    let mut logs = supervisor.logs.lock().expect("runtime logs lock should not be poisoned");
    let buffer = logs.entry(service_id.to_string()).or_default();
    buffer.generation = buffer.generation.saturating_add(1);
    buffer.next_sequence = 0;
    buffer.dropped_entries = 0;
    buffer.entries.clear();
    buffer.last_updated_at = Utc::now().to_rfc3339();
    buffer.generation
}

fn clear_service_log_buffer(app: &AppHandle, service_id: &str) {
    let supervisor = app.state::<RuntimeSupervisor>();
    let mut logs = supervisor.logs.lock().expect("runtime logs lock should not be poisoned");
    let buffer = logs.entry(service_id.to_string()).or_default();
    buffer.next_sequence = 0;
    buffer.dropped_entries = 0;
    buffer.entries.clear();
    buffer.last_updated_at = Utc::now().to_rfc3339();
}

fn spawn_log_reader<R>(app: &AppHandle, service_id: String, generation: u64, stream: &'static str, reader: R)
where
    R: Read + Send + 'static,
{
    let logs = {
        let supervisor = app.state::<RuntimeSupervisor>();
        supervisor.logs.clone()
    };

    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            let Ok(message) = line else {
                continue;
            };
            let trimmed = message.trim_end().to_string();
            if trimmed.is_empty() {
                continue;
            }

            append_service_log_line(&logs, &service_id, generation, stream, &trimmed);
        }
    });
}

fn append_service_log_line(
    logs: &Arc<Mutex<BTreeMap<String, ServiceLogBuffer>>>,
    service_id: &str,
    generation: u64,
    stream: &str,
    message: &str,
) {
    let mut logs = logs.lock().expect("runtime logs lock should not be poisoned");
    let buffer = logs.entry(service_id.to_string()).or_insert_with(|| ServiceLogBuffer {
        generation,
        next_sequence: 0,
        dropped_entries: 0,
        entries: VecDeque::new(),
        last_updated_at: Utc::now().to_rfc3339(),
    });

    if buffer.generation != generation {
        return;
    }

    let entry = ServiceLogEntry {
        sequence: buffer.next_sequence,
        timestamp: Utc::now().to_rfc3339(),
        stream: stream.to_string(),
        level: infer_log_level(stream, message).to_string(),
        message: message.to_string(),
    };

    push_log_entry(buffer, entry);
}

fn push_log_entry(buffer: &mut ServiceLogBuffer, entry: ServiceLogEntry) {
    buffer.next_sequence = entry.sequence.saturating_add(1);
    buffer.last_updated_at = entry.timestamp.clone();
    buffer.entries.push_back(entry);

    while buffer.entries.len() > MAX_LOG_ENTRIES {
        let _ = buffer.entries.pop_front();
        buffer.dropped_entries = buffer.dropped_entries.saturating_add(1);
    }
}

fn infer_log_level(stream: &str, message: &str) -> &'static str {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("error") || normalized.contains("exception") || normalized.contains("fatal") {
        return "error";
    }
    if normalized.contains("warn") {
        return "warn";
    }
    if normalized.contains("debug") {
        return "debug";
    }
    if normalized.contains("trace") {
        return "trace";
    }
    if stream == "stderr" {
        return "error";
    }
    "info"
}

fn render_service_log_export(snapshot: &ServiceLogSnapshot) -> String {
    if snapshot.entries.is_empty() {
        return "No hay logs capturados para este servicio.\n".into();
    }

    let mut rendered = snapshot
        .entries
        .iter()
        .map(|entry| {
            format!(
                "[{}] [{}] [{}] {}",
                entry.timestamp, entry.stream, entry.level, entry.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    rendered.push('\n');
    rendered
}

fn build_log_export_name(service_name: &str) -> String {
    let sanitized = service_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let fallback = if sanitized.is_empty() { "service" } else { sanitized.as_str() };
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
    format!("{fallback}-logs-{timestamp}.log")
}

fn annotate_port_conflicts(services: &mut [ServiceRecord]) {
    for service in services.iter_mut() {
        service.port_conflict = false;

        let Some(expected_port) = service.expected_port else {
            continue;
        };

        let port_is_busy = is_local_port_listening(expected_port);
        let supervised_on_same_port = service.detected_port == Some(expected_port)
            && matches!(service.status.as_str(), "running" | "starting");

        if port_is_busy && !supervised_on_same_port {
            service.port_conflict = true;
        }
    }
}

fn refresh_runtime_supervisor(app: &AppHandle) {
    let mut transitions = Vec::new();
    let mut persistence_updates = Vec::new();
    {
        let supervisor = app.state::<RuntimeSupervisor>();
        let mut services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");

        for (service_id, runtime) in services.iter_mut() {
            let Some(child) = runtime.process.as_mut() else {
                continue;
            };

            match child.try_wait() {
                Ok(Some(status)) => {
                    let process_instance_id = runtime.process_instance_id.clone();
                    let pid = runtime.pid;
                    runtime.process = None;
                    runtime.pid = None;
                    runtime.detected_port = None;
                    runtime.status = "error".into();
                    runtime.last_signal = format!("El proceso supervisado termino de forma inesperada ({status}).");
                    runtime.issue = Some(build_service_issue(
                        service_id,
                        "process_exited",
                        "El proceso termino de forma inesperada",
                        "El servicio dejo de ejecutarse mientras estaba bajo supervision.",
                        Some("Revisa el comando configurado o los logs del servicio."),
                    ));
                    persistence_updates.push(RuntimePersistenceUpdate {
                        service_id: service_id.clone(),
                        process_instance_id,
                        pid,
                        status: runtime.status.clone(),
                        detected_port: runtime.detected_port,
                        last_signal: runtime.last_signal.clone(),
                        issue: runtime.issue.clone(),
                    });
                }
                Ok(None) => {
                    if let Some(expected_port) = runtime.expected_port {
                        if is_local_port_listening(expected_port) {
                            if runtime.status != "running" || runtime.detected_port != Some(expected_port) || runtime.issue.is_some() {
                                runtime.status = "running".into();
                                runtime.detected_port = Some(expected_port);
                                runtime.last_signal = format!("Servicio escuchando en el puerto {expected_port}.");
                                runtime.issue = None;
                                persistence_updates.push(RuntimePersistenceUpdate {
                                    service_id: service_id.clone(),
                                    process_instance_id: runtime.process_instance_id.clone(),
                                    pid: runtime.pid,
                                    status: runtime.status.clone(),
                                    detected_port: runtime.detected_port,
                                    last_signal: runtime.last_signal.clone(),
                                    issue: None,
                                });
                            }
                        } else if runtime.launch_instant.elapsed() >= STARTUP_PORT_TIMEOUT {
                            let process_instance_id = runtime.process_instance_id.clone();
                            let pid = runtime.pid;
                            let _ = child.kill();
                            let _ = child.wait();
                            runtime.process = None;
                            runtime.pid = None;
                            runtime.status = "error".into();
                            runtime.detected_port = None;
                            runtime.last_signal = format!(
                                "El puerto {} no estuvo disponible dentro del timeout de arranque.",
                                expected_port
                            );
                            runtime.issue = Some(build_service_issue(
                                service_id,
                                "startup_timeout",
                                "Timeout de arranque",
                                "El proceso no expuso su puerto esperado a tiempo.",
                                Some("Verifica el puerto configurado, dependencias faltantes o un arranque mas lento de lo esperado."),
                            ));
                            persistence_updates.push(RuntimePersistenceUpdate {
                                service_id: service_id.clone(),
                                process_instance_id,
                                pid,
                                status: runtime.status.clone(),
                                detected_port: runtime.detected_port,
                                last_signal: runtime.last_signal.clone(),
                                issue: runtime.issue.clone(),
                            });
                        }
                    } else {
                        if runtime.status != "running" || runtime.issue.is_some() {
                            runtime.status = "running".into();
                            runtime.issue = None;
                            runtime.last_signal = "Proceso supervisado sin puerto esperado configurado.".into();
                            persistence_updates.push(RuntimePersistenceUpdate {
                                service_id: service_id.clone(),
                                process_instance_id: runtime.process_instance_id.clone(),
                                pid: runtime.pid,
                                status: runtime.status.clone(),
                                detected_port: runtime.detected_port,
                                last_signal: runtime.last_signal.clone(),
                                issue: None,
                            });
                        }
                    }
                }
                Err(error) => {
                    transitions.push((service_id.clone(), error.to_string()));
                }
            }
        }
    }

    if transitions.is_empty() {
        return;
    }

    let supervisor = app.state::<RuntimeSupervisor>();
    let mut services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
    for (service_id, error) in transitions {
        let Some(runtime) = services.get_mut(&service_id) else {
            continue;
        };
        runtime.process = None;
        runtime.pid = None;
        runtime.status = "error".into();
        runtime.detected_port = None;
        runtime.last_signal = "No fue posible inspeccionar el proceso supervisado.".into();
        runtime.issue = Some(build_service_issue(
            &service_id,
            "process_inspection_failed",
            "No se pudo inspeccionar el proceso",
            "La app no pudo refrescar el estado del servicio.",
            Some(&error),
        ));
        persistence_updates.push(RuntimePersistenceUpdate {
            service_id,
            process_instance_id: runtime.process_instance_id.clone(),
            pid: runtime.pid,
            status: runtime.status.clone(),
            detected_port: runtime.detected_port,
            last_signal: runtime.last_signal.clone(),
            issue: runtime.issue.clone(),
        });
    }

    for update in persistence_updates {
        let _ = persist_service_runtime_state(
            app,
            &update.service_id,
            &update.status,
            update.detected_port,
            &update.last_signal,
            update.issue.as_ref(),
        );
        if let Some(process_instance_id) = update.process_instance_id.as_deref() {
            let _ = persist_process_instance_state(
                app,
                process_instance_id,
                update.pid,
                update.detected_port,
                &update.status,
                &update.last_signal,
                update.issue.as_ref(),
            );
        }
    }
}

fn record_runtime_issue(app: &AppHandle, service_id: &str, issue: ServiceActionIssue) {
    let supervisor = app.state::<RuntimeSupervisor>();
    let mut services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
    services.insert(
        service_id.to_string(),
        RuntimeServiceState {
            process_instance_id: None,
            process: None,
            pid: None,
            started_at: None,
            launch_instant: Instant::now(),
            expected_port: None,
            detected_port: None,
            status: "error".into(),
            last_signal: issue.title.clone(),
            issue: Some(issue),
            restart_count: 0,
        },
    );

    let _ = persist_service_runtime_state(
        app,
        service_id,
        "error",
        None,
        &services
            .get(service_id)
            .and_then(|runtime| runtime.issue.as_ref().map(|value| value.title.clone()))
            .unwrap_or_else(|| "Error operativo".into()),
        services.get(service_id).and_then(|runtime| runtime.issue.as_ref()),
    );
}

fn recover_unmanaged_service_states(app: &AppHandle) -> Result<(), AppError> {
    let managed_ids = {
        let supervisor = app.state::<RuntimeSupervisor>();
        let services = supervisor.services.lock().expect("runtime supervisor lock should not be poisoned");
        services.keys().cloned().collect::<Vec<_>>()
    };

    let connection = open_connection(app)?;
    let mut statement = connection.prepare(
        "SELECT id, name, expected_port, detected_port, last_known_status
         FROM service
         WHERE last_known_status IN ('starting', 'running')",
    )?;
    let rows = statement.query_map([], |row| {
        let expected_port = row
            .get::<_, Option<i64>>(2)?
            .and_then(|value| u16::try_from(value).ok());
        let detected_port = row
            .get::<_, Option<i64>>(3)?
            .and_then(|value| u16::try_from(value).ok());
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            expected_port,
            detected_port,
            row.get::<_, String>(4)?,
        ))
    })?;

    for row in rows {
        let (service_id, service_name, expected_port, detected_port, last_known_status) = row?;
        if managed_ids.iter().any(|managed_id| managed_id == &service_id) {
            continue;
        }

        let observed_port = detected_port.or(expected_port);
        if let Some(port) = observed_port.filter(|value| is_local_port_listening(*value)) {
            let issue = build_service_issue(
                &service_id,
                "orphan_process",
                "Proceso huerfano detectado",
                "El servicio seguia activo tras reiniciar la app y quedo fuera de supervision.",
                Some(&format!("Se detecto actividad en el puerto {port} para {service_name} sin supervisor asociado.")),
            );
            persist_service_runtime_state(
                app,
                &service_id,
                "error",
                Some(port),
                "Proceso previo marcado como huerfano tras reinicio de la app.",
                Some(&issue),
            )?;
            finalize_latest_open_process_instance(
                &connection,
                &service_id,
                "error",
                Some(port),
                "Proceso previo marcado como huerfano tras reinicio de la app.",
                Some(&issue),
            )?;
            continue;
        }

        let (status, signal, issue) = if last_known_status == "starting" {
            let issue = build_service_issue(
                &service_id,
                "startup_interrupted",
                "Arranque interrumpido",
                "La app se reinicio antes de completar el arranque del servicio.",
                Some("El ultimo proceso supervisado ya no estaba activo al recuperar el catalogo."),
            );
            (
                "error",
                "El arranque previo se interrumpio durante el reinicio de la app.",
                Some(issue),
            )
        } else {
            (
                "stopped",
                "Se limpio un estado running previo que ya no estaba activo al recuperar el catalogo.",
                None,
            )
        };

        persist_service_runtime_state(app, &service_id, status, None, signal, issue.as_ref())?;
        finalize_latest_open_process_instance(&connection, &service_id, status, None, signal, issue.as_ref())?;
    }

    Ok(())
}

fn insert_process_instance_row(
    connection: &Connection,
    service_id: &str,
    trigger_action: &str,
    command_line: &str,
    pid: Option<u32>,
    detected_port: Option<u16>,
    status: &str,
    started_at: Option<&str>,
    stopped_at: Option<&str>,
    last_signal: &str,
    issue: Option<&ServiceActionIssue>,
) -> Result<String, AppError> {
    let record_id = Uuid::new_v4().to_string();
    let issue_json = match issue {
        Some(issue) => serde_json::to_string(issue)?,
        None => "null".into(),
    };

    connection.execute(
        "INSERT INTO process_instance (
            id,
            service_id,
            trigger_action,
            command_line,
            pid,
            detected_port,
            status,
            started_at,
            stopped_at,
            last_signal_text,
            last_issue_json,
            cpu_percent,
            memory_bytes,
            gpu_percent,
            gpu_memory_bytes
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, 0, NULL, NULL)",
        params![
            record_id.as_str(),
            service_id,
            trigger_action,
            command_line,
            pid.map(i64::from),
            detected_port.map(i64::from),
            status,
            started_at,
            stopped_at,
            last_signal,
            issue_json,
        ],
    )?;

    Ok(record_id)
}

fn update_process_instance_row(
    connection: &Connection,
    process_instance_id: &str,
    pid: Option<u32>,
    detected_port: Option<u16>,
    status: &str,
    last_signal: &str,
    issue: Option<&ServiceActionIssue>,
) -> Result<(), AppError> {
    let issue_json = match issue {
        Some(issue) => serde_json::to_string(issue)?,
        None => "null".into(),
    };
    let stopped_at = matches!(status, "stopped" | "error").then(|| Utc::now().to_rfc3339());

    connection.execute(
        "UPDATE process_instance
         SET pid = COALESCE(?2, pid),
             detected_port = COALESCE(?3, detected_port),
             status = ?4,
             stopped_at = COALESCE(?5, stopped_at),
             last_signal_text = ?6,
             last_issue_json = ?7
         WHERE id = ?1",
        params![
            process_instance_id,
            pid.map(i64::from),
            detected_port.map(i64::from),
            status,
            stopped_at.as_deref(),
            last_signal,
            issue_json,
        ],
    )?;

    Ok(())
}

fn persist_process_instance_start(
    app: &AppHandle,
    service_id: &str,
    trigger_action: &str,
    command_line: &str,
    pid: u32,
    started_at: &str,
    last_signal: &str,
) -> Result<String, AppError> {
    let connection = open_connection(app)?;
    insert_process_instance_row(
        &connection,
        service_id,
        trigger_action,
        command_line,
        Some(pid),
        None,
        "starting",
        Some(started_at),
        None,
        last_signal,
        None,
    )
}

fn persist_failed_process_instance(
    app: &AppHandle,
    service_id: &str,
    trigger_action: &str,
    command_line: &str,
    last_signal: &str,
    issue: &ServiceActionIssue,
) -> Result<(), AppError> {
    let connection = open_connection(app)?;
    let now = Utc::now().to_rfc3339();
    let _ = insert_process_instance_row(
        &connection,
        service_id,
        trigger_action,
        command_line,
        None,
        None,
        "error",
        Some(now.as_str()),
        Some(now.as_str()),
        last_signal,
        Some(issue),
    )?;
    Ok(())
}

fn persist_process_instance_state(
    app: &AppHandle,
    process_instance_id: &str,
    pid: Option<u32>,
    detected_port: Option<u16>,
    status: &str,
    last_signal: &str,
    issue: Option<&ServiceActionIssue>,
) -> Result<(), AppError> {
    let connection = open_connection(app)?;
    update_process_instance_row(
        &connection,
        process_instance_id,
        pid,
        detected_port,
        status,
        last_signal,
        issue,
    )
}

fn finalize_latest_open_process_instance(
    connection: &Connection,
    service_id: &str,
    status: &str,
    detected_port: Option<u16>,
    last_signal: &str,
    issue: Option<&ServiceActionIssue>,
) -> Result<(), AppError> {
    let process_instance_id = connection
        .query_row(
            "SELECT id
             FROM process_instance
             WHERE service_id = ?1 AND stopped_at IS NULL
             ORDER BY COALESCE(started_at, stopped_at) DESC, id DESC
             LIMIT 1",
            [service_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    if let Some(process_instance_id) = process_instance_id {
        update_process_instance_row(
            connection,
            &process_instance_id,
            None,
            detected_port,
            status,
            last_signal,
            issue,
        )?;
    }

    Ok(())
}

fn persist_service_runtime_state(
    app: &AppHandle,
    service_id: &str,
    status: &str,
    detected_port: Option<u16>,
    last_signal: &str,
    issue: Option<&ServiceActionIssue>,
) -> Result<(), AppError> {
    let connection = open_connection(app)?;
    let now = Utc::now().to_rfc3339();
    let issue_json = match issue {
        Some(issue) => serde_json::to_string(issue)?,
        None => "null".into(),
    };

    connection.execute(
        "UPDATE service
         SET last_known_status = ?2,
             detected_port = ?3,
             updated_at = ?4,
             last_signal_text = ?5,
             last_issue_json = ?6
         WHERE id = ?1",
        params![
            service_id,
            status,
            detected_port.map(i64::from),
            now.as_str(),
            last_signal,
            issue_json,
        ],
    )?;

    Ok(())
}

fn build_service_issue(
    service_id: &str,
    code: &str,
    title: &str,
    message: &str,
    detail: Option<&str>,
) -> ServiceActionIssue {
    ServiceActionIssue {
        service_id: service_id.to_string(),
        code: code.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        detail: detail.map(str::to_string),
    }
}

fn resolve_service_directory(service: &ServiceLaunchContext) -> Result<PathBuf, AppError> {
    let workspace_root = PathBuf::from(&service.root_path);
    let relative_path = relative_source_root(&service.path);
    let service_dir = workspace_root.join(relative_path);
    if !service_dir.exists() || !service_dir.is_dir() {
        return Err(AppError::MissingServicePath(normalize_path(&service_dir)));
    }
    ensure_path_within_root(&workspace_root, &service_dir)?;
    Ok(service_dir)
}

fn build_shell_process(command: &str, working_directory: &Path, env: &BTreeMap<String, String>) -> Command {
    #[cfg(target_os = "windows")]
    let mut process = {
        let mut process = Command::new("cmd");
        process.arg("/C").arg(command);
        process
    };

    #[cfg(not(target_os = "windows"))]
    let mut process = {
        let mut process = Command::new("sh");
        process.arg("-lc").arg(command);
        process
    };

    process
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in env {
        process.env(key, value);
    }

    process
}

fn spawn_folder_opener(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(AppError::from)?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn().map_err(AppError::from)?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(AppError::from)?;
        return Ok(());
    }
}

fn spawn_terminal_opener(path: &Path, settings: &AppSettings) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let shell = resolve_allowed_terminal_shell(settings)?;
        let working_directory = normalize_path(path);
        let mut command = Command::new("cmd");
        command.arg("/C").arg("start").arg("").arg("/D").arg(&working_directory);

        match shell.as_str() {
            "powershell.exe" => {
                command
                    .arg("powershell.exe")
                    .arg("-NoExit")
                    .arg("-Command")
                    .arg(format!(
                        "Set-Location -LiteralPath '{}'",
                        escape_powershell_single_quoted_path(path)
                    ));
            }
            "pwsh.exe" => {
                command
                    .arg("pwsh.exe")
                    .arg("-NoExit")
                    .arg("-Command")
                    .arg(format!(
                        "Set-Location -LiteralPath '{}'",
                        escape_powershell_single_quoted_path(path)
                    ));
            }
            "wt.exe" => {
                command.arg("wt.exe");
            }
            _ => {
                command
                    .arg("cmd.exe")
                    .arg("/K")
                    .arg(format!("cd /d \"{}\"", working_directory));
            }
        }

        command
            .spawn()
            .map_err(AppError::from)?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let _ = resolve_allowed_terminal_shell(settings)?;
        Command::new("open")
            .args(["-a", "Terminal", &normalize_path(path)])
            .spawn()
            .map_err(AppError::from)?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = resolve_allowed_terminal_shell(settings)?;
        let attempts: [(&str, &[&str]); 3] = [
            ("x-terminal-emulator", &["--working-directory"]),
            ("gnome-terminal", &["--working-directory"]),
            ("konsole", &["--workdir"]),
        ];

        for (binary, args) in attempts {
            let spawn_result = Command::new(binary).args(args).arg(path).spawn();
            if spawn_result.is_ok() {
                return Ok(());
            }
        }

        return Err(AppError::CommandFailed(format!(
            "No se encontro un emulador de terminal soportado para abrir {}.",
            normalize_path(path)
        )));
    }
}

#[cfg(target_os = "windows")]
fn normalize_windows_shell_preference(value: &str) -> String {
    let normalized = value
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase();

    match normalized.as_str() {
        "powershell" | "powershell.exe" => "powershell.exe".into(),
        "pwsh" | "pwsh.exe" => "pwsh.exe".into(),
        "wt" | "wt.exe" | "windowsterminal.exe" => "wt.exe".into(),
        "cmd" | "cmd.exe" => "cmd.exe".into(),
        _ => normalized,
    }
}

fn resolve_allowed_terminal_shell(settings: &AppSettings) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    let preferred_shell = normalize_windows_shell_preference(&settings.preferred_shell);
    #[cfg(not(target_os = "windows"))]
    let preferred_shell = settings.preferred_shell.trim().to_ascii_lowercase();

    let allowed_shells = settings
        .allowed_shells
        .iter()
        .filter_map(|shell| {
            #[cfg(target_os = "windows")]
            {
                Some(normalize_windows_shell_preference(shell))
            }
            #[cfg(not(target_os = "windows"))]
            {
                let trimmed = shell.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_ascii_lowercase())
            }
        })
        .collect::<Vec<_>>();

    if allowed_shells
        .iter()
        .any(|allowed_shell| allowed_shell == &preferred_shell)
    {
        return Ok(preferred_shell);
    }

    Err(AppError::DisallowedShell(settings.preferred_shell.clone()))
}

#[cfg(target_os = "windows")]
fn escape_powershell_single_quoted_path(path: &Path) -> String {
    normalize_path(path).replace('\'', "''")
}

fn terminate_supervised_process(child: &mut Child, pid: Option<u32>) -> Result<(), String> {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let resolved_pid = pid.unwrap_or_else(|| child.id());
        let output = Command::new("taskkill")
            .args(["/PID", &resolved_pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|error| format!("No se pudo invocar taskkill: {error}"))?;

        if !output.status.success() && !matches!(child.try_wait(), Ok(Some(_))) {
            return Err(format!(
                "taskkill no pudo cerrar el arbol del proceso {}. {}",
                resolved_pid,
                render_command_output(&output.stdout, &output.stderr)
            ));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        child
            .kill()
            .map_err(|error| format!("No se pudo terminar el proceso supervisado: {error}"))?;
    }

    child
        .wait()
        .map_err(|error| format!("No se pudo esperar el cierre del proceso supervisado: {error}"))?;

    Ok(())
}

fn render_command_output(stdout: &[u8], stderr: &[u8]) -> String {
    let rendered = [String::from_utf8_lossy(stdout), String::from_utf8_lossy(stderr)]
        .join(" ")
        .trim()
        .to_string();

    if rendered.is_empty() {
        "No hubo salida adicional.".into()
    } else {
        rendered
    }
}

fn is_local_port_listening(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

fn compute_uptime_seconds(started_at: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(started_at)
        .ok()
        .and_then(|timestamp| (Utc::now() - timestamp.with_timezone(&Utc)).to_std().ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn default_last_signal_for_source(source: &str) -> String {
    match source {
        "manifest" => "Catalog restored from manual manifest".into(),
        "autodiscovery" => "Catalog restored from Nest autodiscovery".into(),
        _ => DEFAULT_LAST_SIGNAL.into(),
    }
}

fn open_connection(app: &AppHandle) -> Result<Connection, AppError> {
    let path = database_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    ensure_schema(&connection)?;
    Ok(connection)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let data_dir = app.path().app_data_dir().map_err(|_| AppError::MissingAppDataDir)?;
    Ok(data_dir.join("catalog.sqlite"))
}

fn ensure_schema(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(INIT_SQL)?;
    ensure_column(connection, "workspace", "is_active", "is_active INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "service", "source", "source TEXT NOT NULL DEFAULT 'autodiscovery'")?;
    ensure_column(connection, "service", "env_json", "env_json TEXT NOT NULL DEFAULT '{}'")?;
    ensure_column(connection, "service", "last_signal_text", "last_signal_text TEXT NOT NULL DEFAULT ''")?;
    ensure_column(connection, "service", "last_issue_json", "last_issue_json TEXT NOT NULL DEFAULT 'null'")?;
    ensure_column(connection, "process_instance", "trigger_action", "trigger_action TEXT NOT NULL DEFAULT 'run'")?;
    ensure_column(connection, "process_instance", "command_line", "command_line TEXT NOT NULL DEFAULT ''")?;
    ensure_column(connection, "process_instance", "detected_port", "detected_port INTEGER")?;
    ensure_column(connection, "process_instance", "last_signal_text", "last_signal_text TEXT NOT NULL DEFAULT ''")?;
    ensure_column(connection, "process_instance", "last_issue_json", "last_issue_json TEXT NOT NULL DEFAULT 'null'")?;
    ensure_column(connection, "k6_script", "source", "source TEXT NOT NULL DEFAULT 'autodiscovery'")?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), AppError> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection.prepare(&pragma)?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;

    let exists = columns
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .any(|name| name == column_name);

    if !exists {
        connection.execute(&format!("ALTER TABLE {table_name} ADD COLUMN {definition}"), [])?;
    }

    Ok(())
}

fn persist_workspace_catalog(
    connection: &mut Connection,
    workspace: &Workspace,
    services: &[PersistedServiceSeed],
) -> Result<(), AppError> {
    let tx = connection.unchecked_transaction()?;
    tx.execute("UPDATE workspace SET is_active = 0", [])?;
    tx.execute(
        "INSERT INTO workspace (
            id, name, root_path, created_at, updated_at, last_scanned_at, is_active
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(root_path) DO UPDATE SET
            id = excluded.id,
            name = excluded.name,
            updated_at = excluded.updated_at,
            last_scanned_at = excluded.last_scanned_at,
            is_active = excluded.is_active",
        params![
            workspace.id.as_str(),
            workspace.name.as_str(),
            workspace.root_path.as_str(),
            workspace.created_at.as_str(),
            workspace.updated_at.as_str(),
            workspace.last_scanned_at.as_deref(),
            if workspace.is_active { 1 } else { 0 }
        ],
    )?;

    let incoming_service_ids = services
        .iter()
        .map(|service| service.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut existing_statement = tx.prepare("SELECT id FROM service WHERE workspace_id = ?1")?;
    let existing_rows = existing_statement.query_map([workspace.id.as_str()], |row| row.get::<_, String>(0))?;
    let existing_service_ids = existing_rows.collect::<Result<Vec<_>, _>>()?;
    drop(existing_statement);

    for service_id in existing_service_ids {
        if !incoming_service_ids.contains(service_id.as_str()) {
            tx.execute("DELETE FROM service WHERE id = ?1", [service_id.as_str()])?;
        }
    }

    for service in services {
        let tags_json = serde_json::to_string(&service.tags)?;
        let env_json = serde_json::to_string(&service.env)?;
        let now = Utc::now().to_rfc3339();
        let default_last_signal = default_last_signal_for_source(&service.source);
        tx.execute(
            "INSERT INTO service (
                id,
                workspace_id,
                name,
                path,
                runtime_type,
                framework_type,
                expected_port,
                detected_port,
                start_command,
                stop_strategy,
                tags_json,
                env_json,
                source,
                auto_detected,
                last_known_status,
                last_signal_text,
                last_issue_json,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL, ?9, ?10, ?11, ?12, 'stopped', ?13, 'null', ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                name = excluded.name,
                path = excluded.path,
                runtime_type = excluded.runtime_type,
                framework_type = excluded.framework_type,
                expected_port = excluded.expected_port,
                start_command = excluded.start_command,
                tags_json = excluded.tags_json,
                env_json = excluded.env_json,
                source = excluded.source,
                auto_detected = excluded.auto_detected,
                updated_at = excluded.updated_at",
            params![
                service.id.as_str(),
                service.workspace_id.as_str(),
                service.name.as_str(),
                service.path.as_str(),
                service.runtime_type.as_str(),
                service.framework_type.as_str(),
                service.expected_port.map(i64::from),
                service.start_command.as_deref(),
                tags_json,
                env_json,
                service.source.as_str(),
                if service.source == "autodiscovery" { 1 } else { 0 },
                default_last_signal,
                now.as_str(),
                now.as_str()
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

fn load_workspaces(connection: &Connection) -> Result<Vec<Workspace>, AppError> {
    let mut statement = connection.prepare(
        "SELECT id, name, root_path, created_at, updated_at, last_scanned_at, is_active
         FROM workspace
         ORDER BY is_active DESC, updated_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            root_path: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            last_scanned_at: row.get(5)?,
            is_active: row.get::<_, i64>(6)? == 1,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_services(connection: &Connection) -> Result<Vec<ServiceRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            id,
            workspace_id,
            name,
            path,
            created_at,
            runtime_type,
            framework_type,
            expected_port,
            detected_port,
            start_command,
            last_known_status,
            last_signal_text,
            last_issue_json,
            tags_json,
            source
         FROM service
         ORDER BY path ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let expected_port = row
            .get::<_, Option<i64>>(7)?
            .and_then(|value| u16::try_from(value).ok());
        let detected_port = row
            .get::<_, Option<i64>>(8)?
            .and_then(|value| u16::try_from(value).ok());
        let start_command: Option<String> = row.get(9)?;
        let last_signal_text: String = row.get(11)?;
        let last_issue_json: String = row.get(12)?;
        let tags_json: String = row.get(13)?;
        let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
        let source: String = row.get(14)?;
        let issue = serde_json::from_str::<Option<ServiceActionIssue>>(&last_issue_json).unwrap_or(None);
        let last_signal = if last_signal_text.trim().is_empty() {
            default_last_signal_for_source(&source)
        } else {
            last_signal_text
        };

        Ok(ServiceRecord {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            path: row.get(3)?,
            created_at: row.get(4)?,
            runtime_type: row.get(5)?,
            framework_type: row.get(6)?,
            expected_port,
            detected_port,
            start_command,
            status: row.get(10)?,
            pid: None,
            uptime_seconds: 0,
            cpu_percent: 0.0,
            memory_bytes: 0,
            gpu_percent: None,
            gpu_memory_bytes: None,
            last_signal,
            tags,
            source,
            issue,
            port_conflict: false,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn scan_services(root: &Path, workspace_id: &str) -> Result<Vec<PersistedServiceSeed>, AppError> {
    let mut services_by_path = BTreeMap::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| should_walk(entry))
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file() {
            let file_name = entry.file_name().to_string_lossy();

            if file_name == "nest-cli.json" {
                for service in build_services_from_nest_config(root, workspace_id, entry.path())? {
                    upsert_service_seed(&mut services_by_path, service);
                }
                continue;
            }

            if file_name == "package.json" {
                if let Some(service) = build_service_seed(root, workspace_id, entry.path())? {
                    upsert_service_seed(&mut services_by_path, service);
                }
            }
        }
    }

    apply_manifest_services(root, workspace_id, &mut services_by_path)?;
    Ok(services_by_path.into_values().collect())
}

fn apply_manifest_services(
    root: &Path,
    workspace_id: &str,
    services_by_path: &mut BTreeMap<String, PersistedServiceSeed>,
) -> Result<(), AppError> {
    let manifest = load_service_manifest_document(root)?;

    for entry in manifest.services {
        let normalized_path = resolve_manifest_relative_path(root, &entry.path)?;
        let fallback_name = normalized_path
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("service");
        let existing = services_by_path.remove(&normalized_path);
        let resolved_name = entry
            .name
            .as_deref()
            .map(normalize_service_name)
            .or_else(|| existing.as_ref().map(|service| service.name.clone()))
            .unwrap_or_else(|| normalize_service_name(fallback_name));
        let tags = if entry.tags.is_empty() {
            existing
                .as_ref()
                .map(|service| service.tags.clone())
                .unwrap_or_else(|| infer_tags(&resolved_name))
        } else {
            normalize_tags(entry.tags)
        };
        let env = if entry.env.is_empty() {
            existing
                .as_ref()
                .map(|service| service.env.clone())
                .unwrap_or_default()
        } else {
            normalize_env_map(entry.env)
        };

        let merged = PersistedServiceSeed {
            id: format!("{workspace_id}::{normalized_path}"),
            workspace_id: workspace_id.to_string(),
            name: resolved_name,
            path: normalized_path.clone(),
            runtime_type: entry
                .runtime_type
                .map(|value| normalize_manifest_string(&value, "node"))
                .or_else(|| existing.as_ref().map(|service| service.runtime_type.clone()))
                .unwrap_or_else(|| "node".into()),
            framework_type: entry
                .framework_type
                .map(|value| normalize_manifest_string(&value, "custom"))
                .or_else(|| existing.as_ref().map(|service| service.framework_type.clone()))
                .unwrap_or_else(|| "custom".into()),
            expected_port: entry
                .expected_port
                .or_else(|| existing.as_ref().and_then(|service| service.expected_port)),
            start_command: entry
                .start_command
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| existing.as_ref().and_then(|service| service.start_command.clone())),
            tags,
            env,
            source: "manifest".into(),
        };

        services_by_path.insert(normalized_path, merged);
    }

    Ok(())
}

fn build_services_from_nest_config(
    root: &Path,
    workspace_id: &str,
    nest_config_path: &Path,
) -> Result<Vec<PersistedServiceSeed>, AppError> {
    let config_dir = nest_config_path
        .parent()
        .ok_or_else(|| AppError::RelativePath(normalize_path(nest_config_path)))?;
    let nest_config = read_json_file(nest_config_path)?.unwrap_or(Value::Null);
    let projects = nest_config
        .get("projects")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    if projects.is_empty() {
        return Ok(Vec::new());
    }

    let root_package_json = read_json_file(&config_dir.join("package.json"))?;
    let mut services = Vec::new();

    for (project_name, project_config) in projects {
        let project_type = project_config
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("application");
        if project_type.eq_ignore_ascii_case("library") {
            continue;
        }

        let service_dir = resolve_project_dir(config_dir, &project_config);
        let normalized_path = normalize_relative_path(
            service_dir
                .strip_prefix(root)
                .map_err(|_| AppError::RelativePath(normalize_path(&service_dir)))?,
        );
        let package_json = read_json_file(&service_dir.join("package.json"))?;
        let expected_port = detect_expected_port(&service_dir)
            .or_else(|| detect_expected_port(config_dir))
            .or_else(|| detect_expected_port_from_source(config_dir, Some(&project_config)));
        let display_name = package_json
            .as_ref()
            .and_then(|package_json| package_json.get("name"))
            .and_then(Value::as_str)
            .map(normalize_service_name)
            .unwrap_or_else(|| normalize_service_name(&project_name));

        services.push(PersistedServiceSeed {
            id: format!("{workspace_id}::{normalized_path}"),
            workspace_id: workspace_id.to_string(),
            name: display_name.clone(),
            path: normalized_path,
            runtime_type: "node".into(),
            framework_type: "nestjs".into(),
            expected_port,
            start_command: resolve_start_command(
                package_json.as_ref(),
                root_package_json.as_ref(),
                Some(project_name.as_str()),
            ),
            tags: infer_tags(&display_name),
            env: BTreeMap::new(),
            source: "autodiscovery".into(),
        });
    }

    Ok(services)
}

fn build_service_seed(
    root: &Path,
    workspace_id: &str,
    package_path: &Path,
) -> Result<Option<PersistedServiceSeed>, AppError> {
    let package_dir = package_path
        .parent()
        .ok_or_else(|| AppError::RelativePath(normalize_path(package_path)))?;
    let contents = fs::read_to_string(package_path)?;
    let package_json: Value = serde_json::from_str(&contents)?;

    if package_dir.join("nest-cli.json").exists() && nest_config_has_projects(&package_dir.join("nest-cli.json"))? {
        return Ok(None);
    }

    if !is_nest_candidate(package_dir, &package_json) {
        return Ok(None);
    }

    let relative_path = package_dir
        .strip_prefix(root)
        .map_err(|_| AppError::RelativePath(normalize_path(package_dir)))?;
    let normalized_relative = normalize_relative_path(relative_path);
    let name = package_json
        .get("name")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| workspace_name_from_path(package_dir));
    let expected_port = detect_expected_port(package_dir);

    Ok(Some(PersistedServiceSeed {
        id: format!("{workspace_id}::{normalized_relative}"),
        workspace_id: workspace_id.to_string(),
        name: normalize_service_name(&name),
        path: normalized_relative,
        runtime_type: "node".into(),
        framework_type: "nestjs".into(),
        expected_port: expected_port.or_else(|| detect_expected_port_from_source(package_dir, None)),
        start_command: resolve_start_command(Some(&package_json), None, None),
        tags: infer_tags(&name),
        env: BTreeMap::new(),
        source: "autodiscovery".into(),
    }))
}

fn is_nest_candidate(package_dir: &Path, package_json: &Value) -> bool {
    if package_dir.join("nest-cli.json").exists() {
        return true;
    }

    let dependencies = package_json
        .get("dependencies")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|map| map.keys())
        .chain(
            package_json
                .get("devDependencies")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|map| map.keys()),
        )
        .collect::<Vec<_>>();

    if dependencies.iter().any(|dependency| dependency.as_str() == "@nestjs/core") {
        return true;
    }

    package_json
        .get("scripts")
        .and_then(Value::as_object)
        .map(|scripts| {
            scripts.values().any(|value| {
                value
                    .as_str()
                    .map(|script| script.contains("nest"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
        || has_typical_nest_structure(package_dir)
}

fn has_typical_nest_structure(package_dir: &Path) -> bool {
    let has_main = [
        package_dir.join("src").join("main.ts"),
        package_dir.join("src").join("main.js"),
        package_dir.join("main.ts"),
        package_dir.join("main.js"),
    ]
    .into_iter()
    .any(|candidate| candidate.exists());

    if !has_main {
        return false;
    }

    [
        package_dir.join("src").join("app.module.ts"),
        package_dir.join("src").join("app.module.js"),
        package_dir.join("app.module.ts"),
        package_dir.join("app.module.js"),
    ]
    .into_iter()
    .any(|candidate| candidate.exists())
}

fn select_start_command(package_json: &Value) -> Option<String> {
    let scripts = package_json.get("scripts")?.as_object()?;
    for key in ["start:dev", "dev", "start"] {
        if let Some(value) = scripts.get(key).and_then(Value::as_str) {
            return Some(value.to_string());
        }
    }

    None
}

fn resolve_start_command(
    package_json: Option<&Value>,
    root_package_json: Option<&Value>,
    project_name: Option<&str>,
) -> Option<String> {
    if let Some(package_json) = package_json {
        if let Some(command) = select_start_command(package_json) {
            return Some(command);
        }
    }

    let Some(root_package_json) = root_package_json else {
        return project_name
            .map(|name| format!("nest start {name} --watch"))
            .or_else(|| Some("nest start --watch".into()));
    };
    let Some(project_name) = project_name else {
        return select_start_command(root_package_json);
    };
    let scripts = root_package_json.get("scripts")?.as_object()?;

    for key in [
        format!("start:dev:{project_name}"),
        format!("dev:{project_name}"),
        format!("start:{project_name}"),
    ] {
        if scripts.contains_key(&key) {
            return Some(format!("npm run {key}"));
        }
    }

    if scripts.contains_key("start:dev") {
        return Some(format!("npm run start:dev -- {project_name}"));
    }

    if scripts.contains_key("start") {
        return Some(format!("npm run start -- {project_name}"));
    }

    Some(format!("nest start {project_name} --watch"))
}

fn detect_expected_port(service_dir: &Path) -> Option<u16> {
    for candidate in [".env.local", ".env"] {
        let file_path = service_dir.join(candidate);
        let Ok(contents) = fs::read_to_string(file_path) else {
            continue;
        };

        for line in contents.lines() {
            let trimmed = line.trim();
            for key in ["PORT", "APP_PORT"] {
                let prefix = format!("{key}=");
                if let Some(value) = trimmed.strip_prefix(&prefix) {
                    if let Ok(port) = value.trim().parse::<u16>() {
                        return Some(port);
                    }
                }
            }
        }
    }

    None
}

fn detect_expected_port_from_source(service_dir: &Path, project_config: Option<&Value>) -> Option<u16> {
    let mut candidates = Vec::new();

    if let Some(project_config) = project_config {
        if let Some(source_root) = project_config.get("sourceRoot").and_then(Value::as_str) {
            let source_root_path = service_dir.join(relative_source_root(source_root));
            candidates.push(source_root_path.join("main.ts"));
            candidates.push(source_root_path.join("main.js"));
        }
    }

    candidates.push(service_dir.join("src").join("main.ts"));
    candidates.push(service_dir.join("src").join("main.js"));
    candidates.push(service_dir.join("main.ts"));
    candidates.push(service_dir.join("main.js"));

    for candidate in candidates {
        let Ok(contents) = fs::read_to_string(candidate) else {
            continue;
        };

        if let Some(port) = extract_first_port_hint(&contents) {
            return Some(port);
        }
    }

    None
}

fn extract_first_port_hint(contents: &str) -> Option<u16> {
    let listen_index = contents.find("listen(")?;
    let tail = &contents[listen_index..];
    let mut digits = String::new();
    let mut collecting = false;

    for character in tail.chars() {
        if character.is_ascii_digit() {
            collecting = true;
            digits.push(character);
            continue;
        }

        if collecting {
            break;
        }
    }

    if digits.len() < 2 {
        return None;
    }

    digits.parse::<u16>().ok()
}

fn infer_tags(service_name: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let lowercase = service_name.to_lowercase();

    for part in lowercase
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
    {
        if matches!(part, "app" | "service" | "api" | "ms") {
            continue;
        }

        if !tags.iter().any(|tag| tag == part) {
            tags.push(part.to_string());
        }
    }

    tags
}

fn load_service_manifest_document(root: &Path) -> Result<ServiceManifestDocument, AppError> {
    let manifest_path = service_manifest_path(root);
    if !manifest_path.exists() {
        return Ok(ServiceManifestDocument {
            schema_version: default_manifest_schema_version(),
            services: Vec::new(),
        });
    }

    let contents = fs::read_to_string(manifest_path)?;
    let mut manifest = serde_json::from_str::<ServiceManifestDocument>(&contents)?;
    if manifest.schema_version == 0 {
        manifest.schema_version = default_manifest_schema_version();
    }
    Ok(manifest)
}

fn save_service_manifest_document(root: &Path, manifest: &ServiceManifestDocument) -> Result<(), AppError> {
    let manifest_path = service_manifest_path(root);
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let contents = serde_json::to_string_pretty(manifest)?;
    fs::write(manifest_path, contents)?;
    Ok(())
}

fn service_manifest_path(root: &Path) -> PathBuf {
    root.join(MANIFEST_DIRECTORY_NAME).join(MANIFEST_FILE_NAME)
}

fn upsert_manifest_entry(entries: &mut Vec<ManualServiceManifest>, incoming: ManualServiceManifest) {
    if let Some(existing) = entries.iter_mut().find(|entry| entry.path == incoming.path) {
        *existing = incoming;
    } else {
        entries.push(incoming);
    }
}

fn validate_manual_service_path(root: &Path, raw_path: &str) -> Result<String, AppError> {
    let normalized = resolve_manifest_relative_path(root, raw_path)?;
    let candidate_dir = root.join(relative_source_root(&normalized));

    if !candidate_dir.exists() || !candidate_dir.is_dir() {
        return Err(AppError::InvalidManualServicePath(format!(
            "{} no existe dentro del workspace activo.",
            normalized
        )));
    }

    ensure_path_within_root(root, &candidate_dir)?;

    Ok(normalized)
}

fn resolve_manifest_relative_path(root: &Path, raw_path: &str) -> Result<String, AppError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidManualServicePath("Debe indicar una ruta relativa o absoluta.".into()));
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        let canonical_root = fs::canonicalize(root)?;
        let canonical_candidate = fs::canonicalize(&candidate)?;
        let relative = canonical_candidate
            .strip_prefix(&canonical_root)
            .map_err(|_| AppError::InvalidManualServicePath(normalize_path(&candidate)))?;
        return Ok(normalize_relative_path(relative));
    }

    let normalized = normalize_relative_path(&relative_source_root(trimmed));
    if normalized.split('/').any(|segment| segment == "..") {
        return Err(AppError::InvalidManualServicePath(normalized));
    }

    Ok(normalized)
}

fn normalize_manifest_string(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.into()
    } else {
        trimmed.to_lowercase()
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();

    for tag in tags
        .into_iter()
        .flat_map(|value| value.split(',').map(str::to_string).collect::<Vec<_>>())
    {
        let trimmed = tag.trim().to_lowercase();
        if trimmed.is_empty() || normalized.iter().any(|existing| existing == &trimmed) {
            continue;
        }
        normalized.push(trimmed);
    }

    normalized
}

fn normalize_env_map(env: BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut normalized = BTreeMap::new();

    for (key, value) in env {
        let normalized_key = key.trim().to_uppercase();
        let normalized_value = value.trim().to_string();
        if normalized_key.is_empty() || normalized_value.is_empty() {
            continue;
        }
        normalized.insert(normalized_key, normalized_value);
    }

    normalized
}

fn workspace_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "workspace".into())
}

fn normalize_service_name(name: &str) -> String {
    name.trim_matches('@').replace('/', "-")
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_relative_path(path: &Path) -> String {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        ".".into()
    } else {
        normalized
    }
}

fn upsert_service_seed(
    services_by_path: &mut BTreeMap<String, PersistedServiceSeed>,
    incoming: PersistedServiceSeed,
) {
    let key = incoming.path.clone();

    match services_by_path.get_mut(&key) {
        Some(existing) => {
            if existing.start_command.is_none() {
                existing.start_command = incoming.start_command;
            }

            if existing.expected_port.is_none() {
                existing.expected_port = incoming.expected_port;
            }

            if existing.name == key || existing.name.trim().is_empty() {
                existing.name = incoming.name;
            }

            if existing.tags.is_empty() {
                existing.tags = incoming.tags;
            }

            if existing.env.is_empty() {
                existing.env = incoming.env;
            }
        }
        None => {
            services_by_path.insert(key, incoming);
        }
    }
}

fn read_json_file(path: &Path) -> Result<Option<Value>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&contents)?))
}

fn nest_config_has_projects(path: &Path) -> Result<bool, AppError> {
    let Some(config) = read_json_file(path)? else {
        return Ok(false);
    };

    Ok(config
        .get("projects")
        .and_then(Value::as_object)
        .map(|projects| !projects.is_empty())
        .unwrap_or(false))
}

fn resolve_project_dir(config_dir: &Path, project_config: &Value) -> PathBuf {
    if let Some(root) = project_config.get("root").and_then(Value::as_str) {
        return config_dir.join(relative_source_root(root));
    }

    if let Some(source_root) = project_config.get("sourceRoot").and_then(Value::as_str) {
        let source_root = config_dir.join(relative_source_root(source_root));
        if let Some(parent) = source_root.parent() {
            return parent.to_path_buf();
        }
    }

    config_dir.to_path_buf()
}

fn relative_source_root(raw_path: &str) -> PathBuf {
    let normalized = raw_path.replace('\\', "/");
    let trimmed = normalized.trim_start_matches("./").trim_start_matches('/');
    PathBuf::from(trimmed)
}

fn should_walk(entry: &DirEntry) -> bool {
    let ignored = [".git", "node_modules", "dist", "coverage", "target"];
    !ignored
        .iter()
        .any(|candidate| entry.file_name().to_string_lossy().eq_ignore_ascii_case(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestWorkspace {
        root: PathBuf,
    }

    impl TestWorkspace {
        fn new(prefix: &str) -> Self {
            let unique = format!(
                "{prefix}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("system time should be after unix epoch")
                    .as_nanos()
            );
            let root = std::env::temp_dir().join(unique);
            fs::create_dir_all(&root).expect("temp workspace should be created");
            Self { root }
        }

        fn path(&self) -> &Path {
            &self.root
        }

        fn write_file(&self, relative_path: &str, contents: &str) {
            let target = self.root.join(relative_path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).expect("parent directory should be created");
            }
            fs::write(target, contents).expect("test file should be written");
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn create_test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        ensure_schema(&connection).expect("schema should initialize");
        connection
    }

    fn seed_workspace_and_service(connection: &Connection, service_id: &str) {
        connection
            .execute(
                "INSERT INTO workspace (id, name, root_path, created_at, updated_at, last_scanned_at, is_active)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                params![
                    "ws-1",
                    "Workspace",
                    "C:/workspace",
                    "2026-03-13T08:00:00Z",
                    "2026-03-13T08:00:00Z",
                    "2026-03-13T08:00:00Z",
                ],
            )
            .expect("workspace should seed");
        connection
            .execute(
                "INSERT INTO service (
                    id,
                    workspace_id,
                    name,
                    path,
                    runtime_type,
                    framework_type,
                    expected_port,
                    detected_port,
                    start_command,
                    stop_strategy,
                    tags_json,
                    env_json,
                    source,
                    auto_detected,
                    last_known_status,
                    last_signal_text,
                    last_issue_json,
                    created_at,
                    updated_at
                ) VALUES (?1, 'ws-1', 'Auth', 'services/auth', 'node', 'nestjs', 3010, NULL, 'npm run start:dev', NULL, '[]', '{}', 'autodiscovery', 1, 'stopped', 'Catalog restored from local metadata', 'null', '2026-03-13T08:00:00Z', '2026-03-13T08:00:00Z')",
                [service_id],
            )
            .expect("service should seed");
    }

    fn seed_k6_script(connection: &Connection, service_id: &str, script_id: &str, script_name: &str, script_path: &str) {
        connection
            .execute(
                "INSERT INTO k6_script (
                    id,
                    service_id,
                    name,
                    path,
                    source,
                    default_config_json,
                    created_at,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, 'manual', '{}', '2026-03-13T08:00:00Z', '2026-03-13T08:00:00Z')",
                params![script_id, service_id, script_name, script_path],
            )
            .expect("k6 script should seed");
    }

    #[test]
    fn scan_services_detects_separate_nested_repos() {
        let workspace = TestWorkspace::new("scan-services-nested");
        workspace.write_file(
            "services/auth/package.json",
            r#"{
              "name": "@acme/auth-service",
              "scripts": { "start:dev": "nest start --watch" },
              "dependencies": { "@nestjs/core": "^10.0.0" }
            }"#,
        );
        workspace.write_file(
            "services/auth/src/main.ts",
            "async function bootstrap(){ await app.listen(3001); }",
        );
        workspace.write_file(
            "services/payments/package.json",
            r#"{
              "name": "@acme/payments-service",
              "scripts": { "start": "nest start" },
              "dependencies": { "@nestjs/core": "^10.0.0" }
            }"#,
        );
        workspace.write_file(
            "services/payments/src/main.ts",
            "async function bootstrap(){ await app.listen(process.env.PORT ?? 3020); }",
        );

        let services = scan_services(workspace.path(), "ws-1").expect("scan should succeed");

        assert_eq!(services.len(), 2);

        let auth = services
            .iter()
            .find(|service| service.path == "services/auth")
            .expect("auth service should be discovered");
        assert_eq!(auth.name, "acme-auth-service");
        assert_eq!(auth.expected_port, Some(3001));
        assert_eq!(auth.framework_type, "nestjs");
        assert_eq!(auth.runtime_type, "node");
        assert_eq!(auth.start_command.as_deref(), Some("nest start --watch"));

        let payments = services
            .iter()
            .find(|service| service.path == "services/payments")
            .expect("payments service should be discovered");
        assert_eq!(payments.name, "acme-payments-service");
        assert_eq!(payments.expected_port, Some(3020));
        assert_eq!(payments.start_command.as_deref(), Some("nest start"));
    }

    #[test]
    fn scan_services_detects_monorepo_projects_from_nest_cli() {
        let workspace = TestWorkspace::new("scan-services-monorepo");
        workspace.write_file(
            "package.json",
            r#"{
              "name": "workspace-root",
              "scripts": {
                "start:dev:auth": "nest start auth --watch",
                "start:dev": "nest start --watch"
              }
            }"#,
        );
        workspace.write_file(
            "nest-cli.json",
            r#"{
              "projects": {
                "auth": {
                  "type": "application",
                  "root": "apps/auth",
                  "sourceRoot": "apps/auth/src"
                },
                "billing": {
                  "type": "application",
                  "root": "apps/billing",
                  "sourceRoot": "apps/billing/src"
                },
                "shared": {
                  "type": "library",
                  "root": "libs/shared",
                  "sourceRoot": "libs/shared/src"
                }
              }
            }"#,
        );
        workspace.write_file(
            "apps/auth/src/main.ts",
            "async function bootstrap(){ await app.listen(3010); }",
        );
        workspace.write_file(
            "apps/billing/src/main.ts",
            "async function bootstrap(){ await app.listen(3025); }",
        );

        let services = scan_services(workspace.path(), "ws-2").expect("scan should succeed");

        assert_eq!(services.len(), 2);

        let auth = services
            .iter()
            .find(|service| service.path == "apps/auth")
            .expect("auth project should be discovered");
        assert_eq!(auth.name, "auth");
        assert_eq!(auth.expected_port, Some(3010));
        assert_eq!(auth.start_command.as_deref(), Some("npm run start:dev:auth"));

        let billing = services
            .iter()
            .find(|service| service.path == "apps/billing")
            .expect("billing project should be discovered");
        assert_eq!(billing.name, "billing");
        assert_eq!(billing.expected_port, Some(3025));
        assert_eq!(billing.start_command.as_deref(), Some("npm run start:dev -- billing"));
    }

    #[test]
    fn package_with_typical_nest_structure_is_detected_without_nest_dependency() {
        let workspace = TestWorkspace::new("scan-services-structure");
        workspace.write_file(
            "package.json",
            r#"{
              "name": "gateway-service"
            }"#,
        );
        workspace.write_file(
            "src/main.ts",
            "async function bootstrap(){ await app.listen(3090); }",
        );
        workspace.write_file(
            "src/app.module.ts",
            "export class AppModule {}",
        );

        let services = scan_services(workspace.path(), "ws-3").expect("scan should succeed");

        assert_eq!(services.len(), 1);
        let service = services.first().expect("one service should exist");
        assert_eq!(service.name, "gateway-service");
        assert_eq!(service.path, ".");
        assert_eq!(service.expected_port, Some(3090));
        assert_eq!(service.start_command.as_deref(), Some("nest start --watch"));
    }

    #[test]
    fn manifest_overrides_autodiscovery_metadata_by_path() {
        let workspace = TestWorkspace::new("scan-services-manifest-override");
        workspace.write_file(
            "services/auth/package.json",
            r#"{
              "name": "@acme/auth-service",
              "scripts": { "start:dev": "nest start --watch" },
              "dependencies": { "@nestjs/core": "^10.0.0" }
            }"#,
        );
        workspace.write_file(
            "services/auth/src/main.ts",
            "async function bootstrap(){ await app.listen(3001); }",
        );
        workspace.write_file(
            ".ms-control-center/services.manifest.json",
            r#"{
              "schemaVersion": 1,
              "services": [
                {
                  "path": "services/auth",
                  "name": "Auth Edge",
                  "frameworkType": "custom",
                  "expectedPort": 4010,
                  "startCommand": "pnpm --dir services/auth dev",
                  "tags": ["edge", "auth"],
                  "env": { "NODE_ENV": "development" }
                }
              ]
            }"#,
        );

        let services = scan_services(workspace.path(), "ws-4").expect("scan should succeed");

        assert_eq!(services.len(), 1);
        let service = services.first().expect("manifest override should exist");
        assert_eq!(service.source, "manifest");
        assert_eq!(service.name, "Auth Edge");
        assert_eq!(service.framework_type, "custom");
        assert_eq!(service.expected_port, Some(4010));
        assert_eq!(service.start_command.as_deref(), Some("pnpm --dir services/auth dev"));
        assert_eq!(service.tags, vec!["edge".to_string(), "auth".to_string()]);
        assert_eq!(
            service.env.get("NODE_ENV"),
            Some(&"development".to_string())
        );
    }

    #[test]
    fn manifest_can_register_manual_service_without_autodiscovery() {
        let workspace = TestWorkspace::new("scan-services-manifest-manual-only");
        workspace.write_file(
            "legacy/gateway/package.json",
            r#"{
              "name": "legacy-gateway"
            }"#,
        );
        workspace.write_file(
            ".ms-control-center/services.manifest.json",
            r#"{
              "schemaVersion": 1,
              "services": [
                {
                  "path": "legacy/gateway",
                  "name": "Legacy Gateway",
                  "runtimeType": "node",
                  "frameworkType": "express",
                  "expectedPort": 8088,
                  "startCommand": "npm --prefix legacy/gateway run dev",
                  "tags": ["gateway", "legacy"],
                  "env": { "PORT": "8088" }
                }
              ]
            }"#,
        );

        let services = scan_services(workspace.path(), "ws-5").expect("scan should succeed");

        assert_eq!(services.len(), 1);
        let service = services.first().expect("manual manifest service should exist");
        assert_eq!(service.source, "manifest");
        assert_eq!(service.name, "Legacy Gateway");
        assert_eq!(service.path, "legacy/gateway");
        assert_eq!(service.runtime_type, "node");
        assert_eq!(service.framework_type, "express");
        assert_eq!(service.expected_port, Some(8088));
        assert_eq!(
            service.start_command.as_deref(),
            Some("npm --prefix legacy/gateway run dev")
        );
    }

    #[cfg(windows)]
    #[test]
    fn parse_nvidia_gpu_total_averages_visible_gpus() {
        let parsed = parse_nvidia_gpu_total("35\n65\n").expect("gpu total should parse");
        assert!((parsed - 50.0).abs() < f64::EPSILON);
    }

    #[cfg(windows)]
    #[test]
    fn parse_nvidia_pmon_filters_pid_list_and_keeps_highest_utilization() {
        let parsed = parse_nvidia_pmon(
            "# gpu        pid  type    sm   mem   enc   dec   command\n0      1200     C    15     2     0     0   node\n0      4444     G    60     5     0     0   chrome\n1      1200     C    41     0     0     0   node\n",
            &[1200],
        );

        let process = parsed.get(&1200).expect("pid 1200 should be present");
        assert_eq!(process.gpu_percent, Some(41.0));
        assert!(!parsed.contains_key(&4444));
    }

    #[cfg(windows)]
    #[test]
    fn parse_nvidia_compute_apps_memory_converts_mib_to_bytes() {
        let parsed = parse_nvidia_compute_apps_memory("1200, 256\n1200, 128\n", &[1200]);
        let process = parsed.get(&1200).expect("pid 1200 should be present");
        assert_eq!(process.gpu_memory_bytes, Some(384 * 1024 * 1024));
    }

    #[test]
    fn infer_log_level_uses_keywords_and_stderr_fallback() {
        assert_eq!(infer_log_level("stdout", "WARN bootstrap drift"), "warn");
        assert_eq!(infer_log_level("stdout", "DEBUG cache miss"), "debug");
        assert_eq!(infer_log_level("stderr", "plain stderr line"), "error");
        assert_eq!(infer_log_level("stdout", "plain stdout line"), "info");
    }

    #[test]
    fn push_log_entry_trims_buffer_at_limit() {
        let mut buffer = ServiceLogBuffer::default();

        for index in 0..=MAX_LOG_ENTRIES {
            push_log_entry(
                &mut buffer,
                ServiceLogEntry {
                    sequence: index as u64,
                    timestamp: "2026-03-13T00:00:00Z".into(),
                    stream: "stdout".into(),
                    level: "info".into(),
                    message: format!("line {index}"),
                },
            );
        }

        assert_eq!(buffer.entries.len(), MAX_LOG_ENTRIES);
        assert_eq!(buffer.dropped_entries, 1);
        assert_eq!(buffer.entries.front().map(|entry| entry.sequence), Some(1));
        assert_eq!(buffer.entries.back().map(|entry| entry.sequence), Some(MAX_LOG_ENTRIES as u64));
    }

    #[test]
    fn append_service_log_line_ignores_stale_generation() {
        let logs = Arc::new(Mutex::new(BTreeMap::from([(
            "svc-1".to_string(),
            ServiceLogBuffer {
                generation: 2,
                next_sequence: 0,
                dropped_entries: 0,
                entries: VecDeque::new(),
                last_updated_at: "2026-03-13T00:00:00Z".into(),
            },
        )])));

        append_service_log_line(&logs, "svc-1", 1, "stdout", "stale line");

        let guard = logs.lock().expect("test lock should not be poisoned");
        let buffer = guard.get("svc-1").expect("buffer should exist");
        assert!(buffer.entries.is_empty());
    }

    #[test]
    fn discover_k6_scripts_detects_paths_and_imports() {
        let workspace = TestWorkspace::new("scan-k6-scripts");
        workspace.write_file(
            "services/auth/perf/smoke.js",
            "export const options = {}; export default function () { return true; }",
        );
        workspace.write_file(
            "services/auth/tests/load-test.ts",
            "import http from 'k6/http'; export default function () { http.get('http://localhost'); }",
        );
        workspace.write_file(
            "services/auth/src/app.service.ts",
            "export class AppService {}",
        );

        let scripts = discover_k6_scripts_for_service(&workspace.path().join("services/auth"))
            .expect("k6 script discovery should succeed");

        let normalized = scripts
            .iter()
            .map(|path| normalize_relative_path(path.strip_prefix(workspace.path()).expect("path should be inside workspace")))
            .collect::<Vec<_>>();

        assert_eq!(
            normalized,
            vec![
                "services/auth/perf/smoke.js".to_string(),
                "services/auth/tests/load-test.ts".to_string(),
            ]
        );
    }

    #[test]
    fn validate_k6_threshold_accepts_basic_metric_expression() {
        let validation = validate_k6_threshold("http_req_failed<0.01");
        assert!(validation.is_valid);
        assert_eq!(validation.detail, "Threshold valido.");
    }

    #[test]
    fn validate_k6_threshold_rejects_invalid_metric_expression() {
        let validation = validate_k6_threshold("http req failed < nope");
        assert!(!validation.is_valid);
        assert_eq!(validation.detail, "El nombre de la metrica contiene caracteres no soportados.");
    }

    #[test]
    fn k6_duration_accepts_compound_units_and_rejects_invalid_values() {
        assert!(is_valid_k6_duration("30s"));
        assert!(is_valid_k6_duration("1m30s"));
        assert!(is_valid_k6_duration("250ms"));
        assert!(!is_valid_k6_duration("0"));
        assert!(!is_valid_k6_duration("10x"));
        assert!(!is_valid_k6_duration("1m 30s"));
    }

    #[test]
    fn build_k6_run_arguments_includes_optional_rate_and_artifact_paths() {
        let arguments = build_k6_run_arguments(
            12,
            "45s",
            Some(30),
            Path::new("C:/tmp/run-1/result.json"),
            Path::new("C:/tmp/run-1/summary.json"),
            Path::new("C:/workspace/services/auth/perf/smoke.js"),
        );

        assert_eq!(
            arguments,
            vec![
                "run".to_string(),
                "--vus".to_string(),
                "12".to_string(),
                "--duration".to_string(),
                "45s".to_string(),
                "--rps".to_string(),
                "30".to_string(),
                "--out".to_string(),
                "json=C:/tmp/run-1/result.json".to_string(),
                "--summary-export".to_string(),
                "C:/tmp/run-1/summary.json".to_string(),
                "--summary-mode=full".to_string(),
                "C:/workspace/services/auth/perf/smoke.js".to_string(),
            ]
        );
    }

    #[test]
    fn build_k6_run_arguments_omits_rate_when_not_provided() {
        let arguments = build_k6_run_arguments(
            1,
            "30s",
            None,
            Path::new("C:/tmp/run-2/result.json"),
            Path::new("C:/tmp/run-2/summary.json"),
            Path::new("C:/workspace/services/auth/perf/smoke.js"),
        );

        assert!(!arguments.iter().any(|argument| argument == "--rps"));
        assert_eq!(arguments[0], "run");
        assert_eq!(arguments[1], "--vus");
        assert_eq!(arguments[2], "1");
    }

    #[test]
    fn parse_k6_duration_seconds_supports_compound_units() {
        let parsed = parse_k6_duration_seconds("1m30s").expect("duration should parse");
        assert!((parsed - 90.0).abs() < f64::EPSILON);

        let parsed_ms = parse_k6_duration_seconds("250ms").expect("duration should parse");
        assert!((parsed_ms - 0.25).abs() < f64::EPSILON);
    }

    #[test]
    fn compute_progress_percent_caps_values() {
        assert!((compute_progress_percent(15.0, 30.0) - 50.0).abs() < f64::EPSILON);
        assert!((compute_progress_percent(45.0, 30.0) - 100.0).abs() < f64::EPSILON);
        assert_eq!(compute_progress_percent(10.0, 0.0), 0.0);
    }

    #[test]
    fn load_service_execution_history_returns_recent_entries_with_duration_and_issue() {
        let connection = create_test_connection();
        seed_workspace_and_service(&connection, "ws-1::services/auth");
        let timeout_issue = build_service_issue(
            "ws-1::services/auth",
            "startup_timeout",
            "Timeout de arranque",
            "El servicio no expuso su puerto esperado a tiempo.",
            Some("Verifica el puerto configurado."),
        );

        let _ = insert_process_instance_row(
            &connection,
            "ws-1::services/auth",
            "run",
            "npm run start:dev",
            Some(4200),
            Some(3010),
            "stopped",
            Some("2026-03-13T10:00:00Z"),
            Some("2026-03-13T10:00:45Z"),
            "Stop solicitado para Auth.",
            None,
        )
        .expect("first process instance should insert");
        let _ = insert_process_instance_row(
            &connection,
            "ws-1::services/auth",
            "restart",
            "npm run start:dev",
            Some(4300),
            Some(3010),
            "error",
            Some("2026-03-13T11:00:00Z"),
            Some("2026-03-13T11:01:00Z"),
            "El puerto esperado no estuvo disponible dentro del timeout.",
            Some(&timeout_issue),
        )
        .expect("second process instance should insert");

        let history = load_service_execution_history(&connection, "ws-1::services/auth", 5)
            .expect("history should load");

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].trigger_action, "restart");
        assert_eq!(history[0].status, "error");
        assert_eq!(history[0].pid, Some(4300));
        assert_eq!(history[0].duration_seconds, Some(60.0));
        assert_eq!(history[0].issue.as_ref().map(|issue| issue.code.as_str()), Some("startup_timeout"));
        assert_eq!(history[1].trigger_action, "run");
        assert_eq!(history[1].duration_seconds, Some(45.0));
    }

    #[test]
    fn persist_workspace_catalog_keeps_process_history_for_existing_service_ids() {
        let mut connection = create_test_connection();
        seed_workspace_and_service(&connection, "ws-1::services/auth");
        let _ = insert_process_instance_row(
            &connection,
            "ws-1::services/auth",
            "run",
            "npm run start:dev",
            Some(4200),
            Some(3010),
            "stopped",
            Some("2026-03-13T10:00:00Z"),
            Some("2026-03-13T10:00:45Z"),
            "Stop solicitado para Auth.",
            None,
        )
        .expect("process history should insert");

        let workspace = Workspace {
            id: "ws-1".into(),
            name: "Workspace".into(),
            root_path: "C:/workspace".into(),
            created_at: "2026-03-13T08:00:00Z".into(),
            updated_at: "2026-03-13T12:00:00Z".into(),
            last_scanned_at: Some("2026-03-13T12:00:00Z".into()),
            is_active: true,
        };
        let services = vec![PersistedServiceSeed {
            id: "ws-1::services/auth".into(),
            workspace_id: "ws-1".into(),
            name: "Auth Updated".into(),
            path: "services/auth".into(),
            runtime_type: "node".into(),
            framework_type: "nestjs".into(),
            expected_port: Some(3010),
            start_command: Some("npm run start:dev".into()),
            tags: vec!["auth".into()],
            env: BTreeMap::new(),
            source: "autodiscovery".into(),
        }];

        persist_workspace_catalog(&mut connection, &workspace, &services)
            .expect("catalog upsert should succeed");

        let process_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM process_instance WHERE service_id = 'ws-1::services/auth'",
                [],
                |row| row.get(0),
            )
            .expect("process history count should load");
        let service_name: String = connection
            .query_row(
                "SELECT name FROM service WHERE id = 'ws-1::services/auth'",
                [],
                |row| row.get(0),
            )
            .expect("service name should load");

        assert_eq!(process_count, 1);
        assert_eq!(service_name, "Auth Updated");
    }

    #[test]
    fn persist_k6_lab_preferences_saves_workspace_and_global_scope() {
        let connection = create_test_connection();
        seed_workspace_and_service(&connection, "ws-1::services/auth");
        seed_k6_script(
            &connection,
            "ws-1::services/auth",
            "ws-1::services/auth::perf/smoke.js",
            "Auth smoke",
            "services/auth/perf/smoke.js",
        );
        let workspace_context = load_active_workspace_k6_context(&connection)
            .expect("workspace context should load");
        let preferences = K6LabPreferences {
            selected_service_id: Some("ws-1::services/auth".into()),
            script_id: Some("ws-1::services/auth::perf/smoke.js".into()),
            profile_id: "load".into(),
            vus: 12,
            duration: "45s".into(),
            rate: Some(15),
            thresholds: vec!["p(95)<500".into()],
            k6_binary_path: "C:/missing/k6.exe".into(),
        };

        persist_k6_lab_preferences(&connection, workspace_context.as_ref(), preferences)
            .expect("preferences should persist");

        let workspace_json: String = connection
            .query_row(
                "SELECT value_json FROM user_preference WHERE key = ?1 AND scope_type = ?2 AND scope_id = ?3",
                params![
                    USER_PREFERENCE_KEY_K6_LAB_CONTEXT,
                    USER_PREFERENCE_SCOPE_WORKSPACE,
                    "ws-1"
                ],
                |row| row.get(0),
            )
            .expect("workspace preference should exist");
        let global_json: String = connection
            .query_row(
                "SELECT value_json FROM user_preference WHERE key = ?1 AND scope_type = ?2 AND scope_id = ''",
                params![
                    USER_PREFERENCE_KEY_K6_BINARY_PATH,
                    USER_PREFERENCE_SCOPE_GLOBAL
                ],
                |row| row.get(0),
            )
            .expect("global preference should exist");

        let workspace_value = serde_json::from_str::<PersistedK6LabContextPreference>(&workspace_json)
            .expect("workspace preference should parse");
        let global_value = serde_json::from_str::<PersistedGlobalK6BinaryPreference>(&global_json)
            .expect("global preference should parse");

        assert_eq!(workspace_value.profile_id, "load");
        assert_eq!(workspace_value.vus, 12);
        assert_eq!(workspace_value.script_id.as_deref(), Some("ws-1::services/auth::perf/smoke.js"));
        assert_eq!(global_value.k6_binary_path, "C:/missing/k6.exe");
    }

    #[test]
    fn load_effective_k6_lab_preferences_merges_scope_and_sanitizes_invalid_refs() {
        let connection = create_test_connection();
        seed_workspace_and_service(&connection, "ws-1::services/auth");
        seed_k6_script(
            &connection,
            "ws-1::services/auth",
            "ws-1::services/auth::perf/smoke.js",
            "Auth smoke",
            "services/auth/perf/smoke.js",
        );
        save_user_preference_json(
            &connection,
            USER_PREFERENCE_KEY_K6_LAB_CONTEXT,
            USER_PREFERENCE_SCOPE_WORKSPACE,
            "ws-1",
            &PersistedK6LabContextPreference {
                selected_service_id: Some("ws-1::missing".into()),
                script_id: Some("missing-script".into()),
                profile_id: "load".into(),
                vus: 8,
                duration: "1m".into(),
                rate: Some(9),
                thresholds: vec!["checks>0.95".into()],
            },
        )
        .expect("workspace preference should save");
        save_user_preference_json(
            &connection,
            USER_PREFERENCE_KEY_K6_BINARY_PATH,
            USER_PREFERENCE_SCOPE_GLOBAL,
            "",
            &PersistedGlobalK6BinaryPreference {
                k6_binary_path: "C:/missing/k6.exe".into(),
            },
        )
        .expect("global binary preference should save");

        let workspace_context = load_active_workspace_k6_context(&connection)
            .expect("workspace context should load");
        let scripts = load_k6_scripts(&connection).expect("scripts should load");
        let profiles = default_k6_profiles();
        let preferences = load_effective_k6_lab_preferences(
            &connection,
            workspace_context.as_ref(),
            &scripts,
            &profiles,
        )
        .expect("effective preferences should load");

        assert_eq!(preferences.selected_service_id.as_deref(), Some("ws-1::services/auth"));
        assert_eq!(preferences.script_id.as_deref(), Some("ws-1::services/auth::perf/smoke.js"));
        assert_eq!(preferences.profile_id, "load");
        assert_eq!(preferences.vus, 8);
        assert_eq!(preferences.duration, "1m");
        assert_eq!(preferences.rate, Some(9));
        assert_eq!(preferences.k6_binary_path, "C:/missing/k6.exe");
    }

    #[test]
    fn resolve_k6_binary_status_uses_global_preference_when_override_missing() {
        let connection = create_test_connection();
        save_user_preference_json(
            &connection,
            USER_PREFERENCE_KEY_K6_BINARY_PATH,
            USER_PREFERENCE_SCOPE_GLOBAL,
            "",
            &PersistedGlobalK6BinaryPreference {
                k6_binary_path: "C:/missing/k6.exe".into(),
            },
        )
        .expect("global binary preference should save");

        let status = resolve_k6_binary_status(Some(&connection), None);

        assert!(!status.is_available);
        assert_eq!(status.resolved_path.as_deref(), Some("C:/missing/k6.exe"));
    }

    #[test]
    fn validate_service_start_command_accepts_allowlisted_launchers() {
        let workspace = TestWorkspace::new("allowlist-command-ok");
        workspace.write_file("services/auth/package.json", r#"{"name":"auth"}"#);
        let service_dir = workspace.path().join("services/auth");

        let normalized = validate_service_start_command(
            workspace.path(),
            &service_dir,
            "pnpm --dir services/auth dev",
        )
        .expect("pnpm command should be accepted");

        assert_eq!(normalized, "pnpm");
    }

    #[test]
    fn validate_service_start_command_rejects_disallowed_launchers() {
        let workspace = TestWorkspace::new("allowlist-command-bad-launcher");
        workspace.write_file("services/auth/package.json", r#"{"name":"auth"}"#);
        let service_dir = workspace.path().join("services/auth");

        let error = validate_service_start_command(
            workspace.path(),
            &service_dir,
            "python manage.py runserver",
        )
        .expect_err("python should be rejected by the MVP allowlist");

        assert!(matches!(error, AppError::DisallowedStartCommand(_)));
    }

    #[test]
    fn validate_service_start_command_rejects_shell_chaining() {
        let workspace = TestWorkspace::new("allowlist-command-chaining");
        workspace.write_file("services/auth/package.json", r#"{"name":"auth"}"#);
        let service_dir = workspace.path().join("services/auth");

        let error = validate_service_start_command(
            workspace.path(),
            &service_dir,
            "npm run start:dev && whoami",
        )
        .expect_err("shell chaining should be rejected");

        assert!(matches!(error, AppError::DisallowedStartCommand(_)));
    }

    #[test]
    fn validate_service_start_command_rejects_relative_launcher_outside_workspace() {
        let workspace = TestWorkspace::new("allowlist-command-path-escape");
        workspace.write_file("services/auth/package.json", r#"{"name":"auth"}"#);
        let service_dir = workspace.path().join("services/auth");

        let error = validate_service_start_command(
            workspace.path(),
            &service_dir,
            "../tools/npm.cmd run start:dev",
        )
        .expect_err("relative launcher should not escape the service directory");

        assert!(matches!(error, AppError::DisallowedStartCommand(_)));
    }

    #[test]
    fn resolve_allowed_terminal_shell_rejects_non_allowlisted_shell() {
        let error = resolve_allowed_terminal_shell(&AppSettings {
            default_workspace_root: String::new(),
            default_log_export_root: String::new(),
            allowed_shells: vec!["cmd.exe".into()],
            preferred_shell: "powershell.exe".into(),
            dashboard_refresh_seconds: 2,
            realtime_refresh_seconds: 1,
            theme: "midnight".into(),
            gpu_mode: "auto".into(),
            k6_binary_path: String::new(),
        })
        .expect_err("preferred shell should be rejected when not allowlisted");

        assert!(matches!(error, AppError::DisallowedShell(_)));
    }

    #[test]
    fn resolve_k6_binary_status_rejects_non_k6_override_names() {
        let status = resolve_k6_binary_status(None, Some("C:/tools/not-k6.exe"));

        assert!(!status.is_available);
        assert_eq!(status.resolved_path.as_deref(), Some("C:/tools/not-k6.exe"));
        assert!(status.detail.contains("k6"));
    }

    #[test]
    fn load_app_settings_merges_global_k6_path_and_sanitizes_values() {
        let connection = create_test_connection();
        save_user_preference_json(
            &connection,
            USER_PREFERENCE_KEY_APP_SETTINGS,
            USER_PREFERENCE_SCOPE_GLOBAL,
            "",
            &PersistedAppSettingsPreference {
                default_workspace_root: "  C:/dev/workspaces  ".into(),
                default_log_export_root: " C:/exports ".into(),
                allowed_shells: vec![" powershell.exe ".into(), "cmd.exe".into(), "powershell.exe".into()],
                preferred_shell: "pwsh.exe".into(),
                dashboard_refresh_seconds: 0,
                realtime_refresh_seconds: 15,
                theme: "unknown".into(),
                gpu_mode: "mystery".into(),
            },
        )
        .expect("app settings preference should save");
        save_global_k6_binary_path_preference(&connection, " C:/Program Files/k6/k6.exe ")
            .expect("global k6 path should save");

        let settings = load_app_settings(&connection).expect("app settings should load");

        assert_eq!(settings.default_workspace_root, "C:/dev/workspaces");
        assert_eq!(settings.default_log_export_root, "C:/exports");
        assert_eq!(settings.allowed_shells, vec!["powershell.exe".to_string(), "cmd.exe".to_string()]);
        assert_eq!(settings.preferred_shell, "powershell.exe");
        assert_eq!(settings.dashboard_refresh_seconds, 1);
        assert_eq!(settings.realtime_refresh_seconds, 10);
        assert_eq!(settings.theme, "midnight");
        assert_eq!(settings.gpu_mode, "auto");
        assert_eq!(settings.k6_binary_path, "C:/Program Files/k6/k6.exe");
    }

    #[test]
    fn persist_app_settings_stores_global_payload_and_k6_path() {
        let connection = create_test_connection();
        persist_app_settings(
            &connection,
            AppSettings {
                default_workspace_root: "C:/dev/microservices".into(),
                default_log_export_root: "C:/dev/exports".into(),
                allowed_shells: vec!["cmd.exe".into(), "pwsh.exe".into()],
                preferred_shell: "pwsh.exe".into(),
                dashboard_refresh_seconds: 3,
                realtime_refresh_seconds: 2,
                theme: "ember".into(),
                gpu_mode: "disabled".into(),
                k6_binary_path: "C:/Program Files/k6/k6.exe".into(),
            },
        )
        .expect("app settings should persist");

        let stored_settings = load_user_preference_json::<PersistedAppSettingsPreference>(
            &connection,
            USER_PREFERENCE_KEY_APP_SETTINGS,
            USER_PREFERENCE_SCOPE_GLOBAL,
            "",
        )
        .expect("settings query should work")
        .expect("app settings row should exist");
        let stored_binary = load_global_k6_binary_path_preference(&connection)
            .expect("global binary should load")
            .expect("global binary should exist");

        assert_eq!(stored_settings.default_workspace_root, "C:/dev/microservices");
        assert_eq!(stored_settings.preferred_shell, "pwsh.exe");
        assert_eq!(stored_settings.dashboard_refresh_seconds, 3);
        assert_eq!(stored_settings.theme, "ember");
        assert_eq!(stored_settings.gpu_mode, "disabled");
        assert_eq!(stored_binary, "C:/Program Files/k6/k6.exe");
    }

    #[test]
    fn build_k6_run_summary_metrics_extracts_core_values_and_threshold_states() {
        let summary = PersistedK6RunSummary {
            config: PersistedK6RunConfig {
                profile_id: "load".into(),
                vus: 10,
                duration: "30s".into(),
                rate: Some(10),
                thresholds: vec!["p(95)<500".into(), "http_req_failed<0.01".into(), "checks>0.95".into()],
                binary_path: "C:/Program Files/k6/k6.exe".into(),
                command_line: "k6 run".into(),
                configured_duration_seconds: 30.0,
            },
            outcome: PersistedK6RunOutcome {
                status: "completed".into(),
                exit_code: Some(0),
                warning_service_stopped: false,
                started_at: "2026-03-13T00:00:00Z".into(),
                finished_at: Some("2026-03-13T00:00:30Z".into()),
            },
            summary_export_path: Some("C:/tmp/summary.json".into()),
            summary_export_json: Some(serde_json::json!({
                "metrics": {
                    "http_req_duration": { "avg": 120.0, "p(95)": 420.0, "p(99)": 510.0 },
                    "http_reqs": { "rate": 18.5, "count": 555 },
                    "http_req_failed": { "value": 0.005 },
                    "vus": { "max": 10, "value": 10 },
                    "checks": { "passes": 54, "fails": 2, "value": 0.9643 }
                }
            })),
            output_tail: Vec::new(),
            external_dashboard_url: None,
            interrupted_by_app_restart: false,
        };

        let metrics = build_k6_run_summary_metrics(&summary, 28.0);

        assert_eq!(metrics.latency_avg_ms, Some(120.0));
        assert_eq!(metrics.latency_p95_ms, Some(420.0));
        assert_eq!(metrics.latency_p99_ms, Some(510.0));
        assert_eq!(metrics.requests_per_second, Some(18.5));
        assert_eq!(metrics.error_rate, Some(0.005));
        assert_eq!(metrics.active_vus, Some(10.0));
        assert_eq!(metrics.checks_pass, 54);
        assert_eq!(metrics.checks_fail, 2);
        assert_eq!(metrics.thresholds[0].status, "passed");
        assert_eq!(metrics.thresholds[1].status, "passed");
        assert_eq!(metrics.thresholds[2].status, "passed");
    }

    #[test]
    fn build_k6_run_charts_from_ndjson_aggregates_latency_rps_vus_and_checks() {
        let charts = build_k6_run_charts_from_ndjson(
            r#"{"metric":"http_reqs","type":"Point","data":{"time":"2026-03-13T10:00:00Z","value":1}}
{"metric":"http_reqs","type":"Point","data":{"time":"2026-03-13T10:00:00.400Z","value":1}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-03-13T10:00:00Z","value":100}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-03-13T10:00:00.400Z","value":200}}
{"metric":"http_req_failed","type":"Point","data":{"time":"2026-03-13T10:00:00.400Z","value":1}}
{"metric":"checks","type":"Point","data":{"time":"2026-03-13T10:00:00.500Z","value":1}}
{"metric":"vus","type":"Point","data":{"time":"2026-03-13T10:00:00.500Z","value":5}}
{"metric":"http_reqs","type":"Point","data":{"time":"2026-03-13T10:00:01Z","value":1}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-03-13T10:00:01Z","value":300}}
{"metric":"http_req_failed","type":"Point","data":{"time":"2026-03-13T10:00:01Z","value":0}}
{"metric":"checks","type":"Point","data":{"time":"2026-03-13T10:00:01Z","value":0}}
{"metric":"vus","type":"Point","data":{"time":"2026-03-13T10:00:01Z","value":4}}"#,
        );

        assert_eq!(charts.requests_per_second.len(), 2);
        assert_eq!(charts.requests_per_second[0].value, 2.0);
        assert_eq!(charts.latency_avg_ms[0].value, 150.0);
        assert_eq!(charts.latency_p95_ms[1].value, 300.0);
        assert_eq!(charts.error_rate[0].value, 1.0);
        assert_eq!(charts.checks_pass_rate[1].value, 0.0);
        assert_eq!(charts.vus_active[0].value, 5.0);
    }
}
