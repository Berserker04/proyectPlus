use crate::models::{
    AppSettings, DashboardSnapshot, Microservice, MicroserviceDraft, Project, ProjectDraft,
    RunServiceResponse, ServiceActionIssue, ServiceActionResponse, ServiceLogEntry,
    ServiceLogSnapshot, SystemMetrics,
};
use chrono::Utc;
use rusqlite::{Connection, params};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    net::{SocketAddr, TcpStream},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES: usize = 2_000;
const SETTINGS_SCOPE: &str = "global";
const SETTINGS_KEY: &str = "app_settings";

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

struct ProcessEntry {
    child: Child,
    /// Shared log buffer for this process (also held by reader threads)
    log_buf: Arc<Mutex<LogBuffer>>,
}

#[derive(Clone, Default)]
struct LogBuffer {
    entries: Vec<ServiceLogEntry>,
    sequence: u64,
    dropped: u64,
}

impl LogBuffer {
    fn append(&mut self, stream: &str, message: String) {
        self.sequence += 1;
        if self.entries.len() >= MAX_LOG_ENTRIES {
            self.entries.remove(0);
            self.dropped += 1;
        }
        let level = if stream == "stderr" { "error" } else { "info" };
        self.entries.push(ServiceLogEntry {
            sequence: self.sequence,
            timestamp: Utc::now().to_rfc3339(),
            stream: stream.to_string(),
            level: level.to_string(),
            message,
        });
    }
}

#[derive(Default)]
pub struct RuntimeSupervisor {
    /// Map from service_id -> (child process, shared log buffer)
    processes: Mutex<HashMap<String, ProcessEntry>>,
}

#[derive(Default)]
pub struct TelemetryCache {
    system: Mutex<System>,
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("create_dir_all: {e}"))?;
    let db_path = data_dir.join("ms-control-center.db");
    Connection::open(&db_path).map_err(|e| format!("open db: {e}"))
}

pub fn initialize_database(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("schema: {e}"))?;

    // Migración proactiva por si ya existía la tabla (ignoramos si falla porque ya existe)
    let _ = conn.execute(
        "ALTER TABLE microservice ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        [],
    );

    Ok(())
}

static SCHEMA_SQL: &str = "
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS microservice (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  start_command TEXT NOT NULL DEFAULT '',
  expected_port INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_preference (
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key, scope_type, scope_id)
);
";

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

struct LiveStatus {
    status: String,
    pid: Option<u32>,
    detected_port: Option<u16>,
    cpu_percent: f64,
    memory_bytes: u64,
    last_signal: String,
    issue: Option<ServiceActionIssue>,
    port_conflict: bool,
}

/// Comprueba si hay algo escuchando en 127.0.0.1:<port>.
/// Timeout corto (80 ms) para no bloquear el refresco del dashboard.
pub fn is_port_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(80)).is_ok()
}

fn get_live_status(
    service_id: &str,
    expected_port: Option<u16>,
    supervisor: &RuntimeSupervisor,
    sys: &System,
) -> LiveStatus {
    let procs = supervisor.processes.lock().unwrap();
    if let Some(entry) = procs.get(service_id) {
        let pid_raw = entry.child.id();
        let pid = Pid::from_u32(pid_raw);
        if let Some(proc_info) = sys.process(pid) {
            let cpu = proc_info.cpu_usage() as f64;
            let mem = proc_info.memory();
            return LiveStatus {
                status: "running".to_string(),
                pid: Some(pid_raw),
                detected_port: expected_port,
                cpu_percent: cpu,
                memory_bytes: mem,
                last_signal: String::new(),
                issue: None,
                port_conflict: false,
            };
        }
        // El proceso murió de forma inesperada
        return LiveStatus {
            status: "error".to_string(),
            pid: None,
            detected_port: None,
            cpu_percent: 0.0,
            memory_bytes: 0,
            last_signal: "Process exited unexpectedly".to_string(),
            issue: None,
            port_conflict: false,
        };
    }

    // El proceso NO fue iniciado por nosotros.
    // Verificar si el puerto configurado está siendo usado por un proceso externo.
    if let Some(port) = expected_port {
        if is_port_open(port) {
            return LiveStatus {
                status: "external".to_string(),
                pid: None,
                detected_port: Some(port),
                cpu_percent: 0.0,
                memory_bytes: 0,
                last_signal: String::new(),
                issue: None,
                port_conflict: false,
            };
        }
    }

    LiveStatus {
        status: "stopped".to_string(),
        pid: None,
        detected_port: None,
        cpu_percent: 0.0,
        memory_bytes: 0,
        last_signal: String::new(),
        issue: None,
        port_conflict: false,
    }
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

fn load_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, updated_at, is_active FROM project ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                is_active: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn load_services_for_project(
    conn: &Connection,
    project_id: &str,
    supervisor: &RuntimeSupervisor,
    sys: &System,
) -> Result<Vec<Microservice>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, name, working_directory, start_command, expected_port, sort_order, created_at, updated_at
             FROM microservice
             WHERE project_id = ?1
             ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,  // id
                row.get::<_, String>(1)?,  // project_id
                row.get::<_, String>(2)?,  // name
                row.get::<_, String>(3)?,  // working_directory
                row.get::<_, String>(4)?,  // start_command
                row.get::<_, Option<i64>>(5)?,  // expected_port
                row.get::<_, i64>(6)?,  // sort_order
                row.get::<_, String>(7)?,  // created_at
                row.get::<_, String>(8)?,  // updated_at
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let (id, proj_id, name, wd, cmd, port, order, created, updated) =
            row.map_err(|e| e.to_string())?;
        let expected_port = port.map(|p| p as u16);
        let live = get_live_status(&id, expected_port, supervisor, sys);
        result.push(Microservice {
            id,
            project_id: proj_id,
            name,
            working_directory: wd,
            start_command: cmd,
            expected_port,
            detected_port: live.detected_port,
            status: live.status,
            pid: live.pid,
            cpu_percent: live.cpu_percent,
            memory_bytes: live.memory_bytes,
            last_signal: live.last_signal,
            issue: live.issue,
            port_conflict: live.port_conflict,
            sort_order: order,
            created_at: created,
            updated_at: updated,
        });
    }
    Ok(result)
}

fn build_snapshot(app: &AppHandle) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let cache = app.state::<TelemetryCache>();
    let supervisor = app.state::<RuntimeSupervisor>();

    // Refresh system metrics
    let (cpu_total, mem_used, mem_total) = {
        let mut sys = cache.system.lock().unwrap();
        sys.refresh_all();
        (
            sys.global_cpu_usage() as f64,
            sys.used_memory(),
            sys.total_memory(),
        )
    };

    let sys_snapshot = SystemMetrics {
        cpu_total_percent: cpu_total,
        memory_used_bytes: mem_used,
        memory_total_bytes: mem_total,
        last_refresh_at: Utc::now().to_rfc3339(),
    };

    let projects = load_projects(&conn)?;

    let active_project_id = projects
        .iter()
        .find(|p| p.is_active)
        .map(|p| p.id.clone());

    let services = if let Some(active_id) = active_project_id {
        let sys = cache.system.lock().unwrap();
        load_services_for_project(&conn, &active_id, &supervisor, &sys)?
    } else {
        vec![]
    };

    Ok(DashboardSnapshot {
        projects,
        services,
        system: sys_snapshot,
    })
}

// ---------------------------------------------------------------------------
// Public API — dashboard & settings
// ---------------------------------------------------------------------------

pub fn get_dashboard_snapshot(app: &AppHandle) -> Result<DashboardSnapshot, String> {
    build_snapshot(app)
}

pub fn get_app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let conn = open_db(app)?;
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT value_json FROM user_preference WHERE key=?1 AND scope_type=?2 AND scope_id=''",
        params![SETTINGS_KEY, SETTINGS_SCOPE],
        |row| row.get(0),
    );

    match result {
        Ok(json) => serde_json::from_str::<AppSettings>(&json)
            .map_err(|e| format!("parse settings: {e}")),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(default_settings()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_app_settings(app: &AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let conn = open_db(app)?;
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO user_preference (key, scope_type, scope_id, value_json, updated_at)
         VALUES (?1, ?2, '', ?3, ?4)",
        params![SETTINGS_KEY, SETTINGS_SCOPE, json, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(settings)
}

fn default_settings() -> AppSettings {
    AppSettings {
        dashboard_refresh_seconds: 2,
        realtime_refresh_seconds: 1,
    }
}

// ---------------------------------------------------------------------------
// Public API — projects
// ---------------------------------------------------------------------------

pub fn create_project(app: &AppHandle, draft: ProjectDraft) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Deactivate all existing projects first
    conn.execute("UPDATE project SET is_active = 0", [])
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO project (id, name, created_at, updated_at, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
        params![id, draft.name.trim(), now, now],
    )
    .map_err(|e| e.to_string())?;

    build_snapshot(app)
}

pub fn update_project(
    app: &AppHandle,
    project_id: &str,
    draft: ProjectDraft,
) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE project SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![draft.name.trim(), now, project_id],
    )
    .map_err(|e| e.to_string())?;
    build_snapshot(app)
}

pub fn delete_project(
    app: &AppHandle,
    project_id: &str,
) -> Result<DashboardSnapshot, String> {
    // Stop any running services for this project first
    {
        let conn = open_db(app)?;
        let mut stmt = conn
            .prepare("SELECT id FROM microservice WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![project_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for sid in ids {
            let _ = stop_service(app, &sid);
        }
    }

    let conn = open_db(app)?;
    let was_active: i64 = conn
        .query_row(
            "SELECT is_active FROM project WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    conn.execute("DELETE FROM project WHERE id = ?1", params![project_id])
        .map_err(|e| e.to_string())?;

    if was_active != 0 {
        // Activate the most recently updated remaining project
        let _ = conn.execute(
            "UPDATE project SET is_active = 1 WHERE id = (SELECT id FROM project ORDER BY updated_at DESC LIMIT 1)",
            [],
        );
    }

    build_snapshot(app)
}

pub fn select_project(
    app: &AppHandle,
    project_id: &str,
) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let now = Utc::now().to_rfc3339();
    conn.execute("UPDATE project SET is_active = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE project SET is_active = 1, updated_at = ?1 WHERE id = ?2",
        params![now, project_id],
    )
    .map_err(|e| e.to_string())?;
    build_snapshot(app)
}

// ---------------------------------------------------------------------------
// Public API — microservices
// ---------------------------------------------------------------------------

pub fn create_microservice(
    app: &AppHandle,
    draft: MicroserviceDraft,
) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    
    // Assign order at the end of the list
    let next_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM microservice WHERE project_id = ?1",
            params![draft.project_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO microservice (id, project_id, name, working_directory, start_command, expected_port, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            draft.project_id,
            draft.name.trim(),
            draft.working_directory.trim(),
            draft.start_command.trim(),
            draft.expected_port.map(|p| p as i64),
            next_order,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    build_snapshot(app)
}

pub fn update_microservice(
    app: &AppHandle,
    service_id: &str,
    draft: MicroserviceDraft,
) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE microservice SET name=?1, working_directory=?2, start_command=?3, expected_port=?4, updated_at=?5
         WHERE id=?6",
        params![
            draft.name.trim(),
            draft.working_directory.trim(),
            draft.start_command.trim(),
            draft.expected_port.map(|p| p as i64),
            now,
            service_id
        ],
    )
    .map_err(|e| e.to_string())?;
    build_snapshot(app)
}

pub fn delete_microservice(
    app: &AppHandle,
    service_id: &str,
) -> Result<DashboardSnapshot, String> {
    let _ = stop_service(app, service_id);
    let conn = open_db(app)?;
    conn.execute(
        "DELETE FROM microservice WHERE id = ?1",
        params![service_id],
    )
    .map_err(|e| e.to_string())?;
    build_snapshot(app)
}

// ---------------------------------------------------------------------------
// Public API — runtime
// ---------------------------------------------------------------------------

pub fn update_service_order(
    app: &AppHandle,
    project_id: &str,
    service_ids: Vec<String>,
) -> Result<DashboardSnapshot, String> {
    let mut conn = open_db(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    
    let now = Utc::now().to_rfc3339();
    
    for (index, id) in service_ids.iter().enumerate() {
        tx.execute(
            "UPDATE microservice SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND project_id = ?4",
            params![index as i64, now, id, project_id],
        )
        .map_err(|e| e.to_string())?;
    }
    
    tx.commit().map_err(|e| e.to_string())?;
    
    build_snapshot(app)
}

pub fn run_service(
    app: &AppHandle,
    service_id: &str,
) -> Result<RunServiceResponse, String> {
    // Load service record
    let conn = open_db(app)?;
    let row: Result<(String, String, String, Option<i64>), _> = conn.query_row(
        "SELECT name, working_directory, start_command, expected_port FROM microservice WHERE id = ?1",
        params![service_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    );
    let (svc_name, wd, cmd, _port) = row.map_err(|e| format!("service not found: {e}"))?;

    if cmd.trim().is_empty() {
        return Ok(RunServiceResponse {
            snapshot: build_snapshot(app)?,
            issue: Some(ServiceActionIssue {
                service_id: service_id.to_string(),
                code: "NO_START_COMMAND".to_string(),
                title: "Comando de inicio vacío".to_string(),
                message: format!("`{svc_name}` no tiene un comando de inicio configurado."),
                detail: None,
            }),
        });
    }

    // Stop any existing process first
    let _ = stop_service(app, service_id);

    // En Windows los wrappers de Node (pnpm.cmd, npm.cmd, yarn.cmd, etc.)
    // no son binarios nativos y no se pueden lanzar directamente con Command::new.
    // Los pasamos siempre por `cmd /C` para que el PATH de Windows los resuelva.
    #[cfg(target_os = "windows")]
    let child_result = Command::new("cmd")
        .args(["/C", cmd.trim()])
        .current_dir(&wd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    #[cfg(not(target_os = "windows"))]
    let child_result = {
        let (prog, args) = split_command(&cmd);
        Command::new(&prog)
            .args(&args)
            .current_dir(&wd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    };

    match child_result {
        Err(e) => Ok(RunServiceResponse {
            snapshot: build_snapshot(app)?,
            issue: Some(ServiceActionIssue {
                service_id: service_id.to_string(),
                code: "SPAWN_FAILED".to_string(),
                title: "No se pudo iniciar el proceso".to_string(),
                message: format!("Error al ejecutar `{cmd}`: {e}"),
                detail: Some(format!("Programa: {cmd:?}, cwd: {wd}")),
            }),
        }),
        Ok(mut child) => {
            // Create a shared log buffer for this process
            let log_buf = Arc::new(Mutex::new(LogBuffer::default()));

            // Spawn stdout reader thread
            if let Some(out) = child.stdout.take() {
                let buf = Arc::clone(&log_buf);
                thread::spawn(move || {
                    let reader = BufReader::new(out);
                    for line in reader.lines().flatten() {
                        buf.lock().unwrap().append("stdout", line);
                    }
                });
            }

            // Spawn stderr reader thread
            if let Some(err) = child.stderr.take() {
                let buf = Arc::clone(&log_buf);
                thread::spawn(move || {
                    let reader = BufReader::new(err);
                    for line in reader.lines().flatten() {
                        buf.lock().unwrap().append("stderr", line);
                    }
                });
            }

            let supervisor = app.state::<RuntimeSupervisor>();
            supervisor.processes.lock().unwrap().insert(
                service_id.to_string(),
                ProcessEntry { child, log_buf },
            );

            let snapshot = build_snapshot(app)?;
            Ok(RunServiceResponse {
                snapshot,
                issue: None,
            })
        }
    }
}

pub fn stop_service(
    app: &AppHandle,
    service_id: &str,
) -> Result<ServiceActionResponse, String> {
    let supervisor = app.state::<RuntimeSupervisor>();
    let mut procs = supervisor.processes.lock().unwrap();
    if let Some(mut entry) = procs.remove(service_id) {
        let pid = entry.child.id();
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    drop(procs);

    let snapshot = build_snapshot(app)?;
    Ok(ServiceActionResponse {
        snapshot,
        issue: None,
    })
}

pub fn restart_service(
    app: &AppHandle,
    service_id: &str,
) -> Result<ServiceActionResponse, String> {
    let _ = stop_service(app, service_id)?;
    let run_result = run_service(app, service_id)?;
    Ok(ServiceActionResponse {
        snapshot: run_result.snapshot,
        issue: run_result.issue,
    })
}

// ---------------------------------------------------------------------------
// Public API — logs
// ---------------------------------------------------------------------------

pub fn get_service_logs(
    app: &AppHandle,
    service_id: &str,
) -> Result<ServiceLogSnapshot, String> {
    let supervisor = app.state::<RuntimeSupervisor>();
    let procs = supervisor.processes.lock().unwrap();
    let (entries, dropped) = if let Some(entry) = procs.get(service_id) {
        let buf = entry.log_buf.lock().unwrap();
        (buf.entries.clone(), buf.dropped)
    } else {
        (vec![], 0)
    };
    Ok(ServiceLogSnapshot {
        service_id: service_id.to_string(),
        entries,
        dropped_entries: dropped,
        last_updated_at: Utc::now().to_rfc3339(),
    })
}

pub fn clear_service_logs(
    app: &AppHandle,
    service_id: &str,
) -> Result<ServiceLogSnapshot, String> {
    let supervisor = app.state::<RuntimeSupervisor>();
    let procs = supervisor.processes.lock().unwrap();
    if let Some(entry) = procs.get(service_id) {
        let mut buf = entry.log_buf.lock().unwrap();
        buf.entries.clear();
        buf.dropped = 0;
    }
    Ok(ServiceLogSnapshot {
        service_id: service_id.to_string(),
        entries: vec![],
        dropped_entries: 0,
        last_updated_at: Utc::now().to_rfc3339(),
    })
}

// ---------------------------------------------------------------------------
// Public API — quick actions
// ---------------------------------------------------------------------------

pub fn open_service_folder(app: &AppHandle, service_id: &str) -> Result<(), String> {
    let conn = open_db(app)?;
    let wd: String = conn
        .query_row(
            "SELECT working_directory FROM microservice WHERE id = ?1",
            params![service_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("service not found: {e}"))?;

    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(&wd)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn open_service_terminal(app: &AppHandle, service_id: &str) -> Result<(), String> {
    let conn = open_db(app)?;
    let wd: String = conn
        .query_row(
            "SELECT working_directory FROM microservice WHERE id = ?1",
            params![service_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("service not found: {e}"))?;

    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args(["/C", "start", "cmd.exe"])
        .current_dir(&wd)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Cleanup on exit
// ---------------------------------------------------------------------------

pub fn cleanup_runtime(app: &AppHandle) -> Result<(), String> {
    let supervisor = app.state::<RuntimeSupervisor>();
    let mut procs = supervisor.processes.lock().unwrap();
    for (_sid, mut entry) in procs.drain() {
        let pid = entry.child.id();
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

#[allow(dead_code)]
fn split_command(cmd: &str) -> (String, Vec<String>) {
    // Simple shell-like split on whitespace; handles quoted strings naively
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut quote_char = '"';

    for ch in cmd.chars() {
        match ch {
            '"' | '\'' if !in_quotes => {
                in_quotes = true;
                quote_char = ch;
            }
            c if in_quotes && c == quote_char => {
                in_quotes = false;
            }
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }

    if parts.is_empty() {
        return (cmd.to_string(), vec![]);
    }

    let prog = parts.remove(0);
    (prog, parts)
}


