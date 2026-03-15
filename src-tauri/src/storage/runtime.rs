// ---------------------------------------------------------------------------
// storage/runtime.rs — supervisión de procesos hijos.
// Responsabilidad: tipos de runtime (RuntimeSupervisor, TelemetryCache,
// LogBuffer), spawn/stop/restart de procesos, captura de logs en memoria,
// limpieza al cerrar la app y evaluación del estado en vivo de un servicio.
// ---------------------------------------------------------------------------

use crate::models::{
    Microservice, RunServiceResponse, ServiceActionIssue, ServiceActionResponse,
    ServiceLogEntry, ServiceLogSnapshot,
};
use chrono::Utc;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Manager};

use super::db::{build_snapshot, open_db};
use super::metrics::is_port_open;

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES: usize = 2_000;

// ---------------------------------------------------------------------------
// Tipos de runtime gestionados por Tauri
// ---------------------------------------------------------------------------

pub(crate) struct ProcessEntry {
    pub child: Child,
    pub log_buf: Arc<Mutex<LogBuffer>>,
}

#[derive(Clone, Default)]
pub(crate) struct LogBuffer {
    pub entries: Vec<ServiceLogEntry>,
    pub sequence: u64,
    pub dropped: u64,
}

impl LogBuffer {
    pub fn append(&mut self, stream: &str, message: String) {
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

/// Estado de Tauri que supervisa todos los procesos hijos lanzados por la app.
#[derive(Default)]
pub struct RuntimeSupervisor {
    pub(crate) processes: Mutex<HashMap<String, ProcessEntry>>,
}

/// Cache de métricas del sistema (sysinfo::System) compartido entre polls.
#[derive(Default)]
pub struct TelemetryCache {
    pub(crate) system: Mutex<System>,
}

// ---------------------------------------------------------------------------
// Estado en vivo de un servicio
// ---------------------------------------------------------------------------

pub(crate) struct LiveStatus {
    pub status: String,
    pub pid: Option<u32>,
    pub detected_port: Option<u16>,
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub last_signal: String,
    pub issue: Option<ServiceActionIssue>,
    pub port_conflict: bool,
}

/// Calcula el estado en tiempo real de un servicio cruzando el supervisor
/// de procesos con la información de sysinfo.
pub(crate) fn get_live_status(
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
            return LiveStatus {
                status: "running".to_string(),
                pid: Some(pid_raw),
                detected_port: expected_port,
                cpu_percent: proc_info.cpu_usage() as f64,
                memory_bytes: proc_info.memory(),
                last_signal: String::new(),
                issue: None,
                port_conflict: false,
            };
        }
        // El proceso murió de forma inesperada.
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

    // El proceso no fue iniciado por nosotros — detectar si hay uno externo.
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
// API pública — runtime de servicios
// ---------------------------------------------------------------------------

pub fn run_service(app: &AppHandle, service_id: &str) -> Result<RunServiceResponse, String> {
    let conn = open_db(app)?;
    let row: Result<(String, String, String, Option<i64>), _> = conn.query_row(
        "SELECT name, working_directory, start_command, expected_port FROM microservice WHERE id = ?1",
        rusqlite::params![service_id],
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

    // Detener cualquier proceso previo.
    let _ = stop_service(app, service_id);

    // En Windows los wrappers de Node (npm.cmd, pnpm.cmd…) no son binarios
    // nativos. Se pasan siempre por `cmd /C` para que el PATH los resuelva.
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
            let log_buf = Arc::new(Mutex::new(LogBuffer::default()));

            // Hilo lector de stdout.
            if let Some(out) = child.stdout.take() {
                let buf = Arc::clone(&log_buf);
                thread::spawn(move || {
                    for line in BufReader::new(out).lines().flatten() {
                        buf.lock().unwrap().append("stdout", line);
                    }
                });
            }

            // Hilo lector de stderr.
            if let Some(err) = child.stderr.take() {
                let buf = Arc::clone(&log_buf);
                thread::spawn(move || {
                    for line in BufReader::new(err).lines().flatten() {
                        buf.lock().unwrap().append("stderr", line);
                    }
                });
            }

            let supervisor = app.state::<RuntimeSupervisor>();
            supervisor
                .processes
                .lock()
                .unwrap()
                .insert(service_id.to_string(), ProcessEntry { child, log_buf });

            Ok(RunServiceResponse {
                snapshot: build_snapshot(app)?,
                issue: None,
            })
        }
    }
}

pub fn stop_service(app: &AppHandle, service_id: &str) -> Result<ServiceActionResponse, String> {
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
    Ok(ServiceActionResponse {
        snapshot: build_snapshot(app)?,
        issue: None,
    })
}

pub fn restart_service(app: &AppHandle, service_id: &str) -> Result<ServiceActionResponse, String> {
    let _ = stop_service(app, service_id)?;
    let run_result = run_service(app, service_id)?;
    Ok(ServiceActionResponse {
        snapshot: run_result.snapshot,
        issue: run_result.issue,
    })
}

// ---------------------------------------------------------------------------
// API pública — logs
// ---------------------------------------------------------------------------

pub fn get_service_logs(app: &AppHandle, service_id: &str) -> Result<ServiceLogSnapshot, String> {
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
// Limpieza al cerrar la app
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
// Utilidades privadas
// ---------------------------------------------------------------------------

/// Parser simple de comandos con soporte básico de comillas.
/// Solo se usa en plataformas no-Windows.
#[allow(dead_code)]
fn split_command(cmd: &str) -> (String, Vec<String>) {
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
