// ---------------------------------------------------------------------------
// storage/runtime.rs — supervisión de procesos hijos.
// Responsabilidad: tipos de runtime (RuntimeSupervisor, TelemetryCache,
// LogBuffer), spawn/stop/restart de procesos, captura de logs en memoria,
// limpieza al cerrar la app y evaluación del estado en vivo de un servicio.
//
// Cambios respecto a la versión anterior:
//   • run_service emite "service-log-line" desde los hilos lectores de I/O.
//   • run_service / stop_service / restart_service emiten "dashboard-update".
// ---------------------------------------------------------------------------

use crate::models::{
    RunServiceResponse, ServiceActionIssue, ServiceActionResponse, ServiceLogEntry,
    ServiceLogLineEvent, ServiceLogSnapshot,
};
use chrono::Utc;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    iter::Peekable,
    process::{Child, Command, Stdio},
    str::Chars,
    sync::{Arc, Mutex},
    thread,
};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Emitter, Manager};

use super::db::{build_snapshot, open_db};
use super::events::emit_dashboard_update;
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
        let Some(message) = sanitize_log_message(&message) else {
            return;
        };
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
    pub issue: Option<crate::models::ServiceActionIssue>,
    pub port_conflict: bool,
}

/// Calcula el estado en tiempo real de un servicio cruzando el supervisor
/// de procesos con sysinfo.
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
// Helpers privados para emitir log line
// ---------------------------------------------------------------------------

/// Emite el evento "service-log-line" con la última entrada del buffer.
/// Llamado desde los hilos lectores de stdout/stderr.
fn emit_log_line(app: &AppHandle, service_id: &str, entry: ServiceLogEntry) {
    let _ = app.emit(
        "service-log-line",
        ServiceLogLineEvent {
            service_id: service_id.to_string(),
            entry,
        },
    );
}

fn sanitize_log_message(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return Some(String::new());
    }

    let mut sanitized = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => skip_escape_sequence(&mut chars),
            '\r' => sanitized.clear(),
            '\u{8}' => {
                sanitized.pop();
            }
            '\t' => sanitized.push('\t'),
            c if c.is_control() => {}
            c => sanitized.push(c),
        }
    }

    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn skip_escape_sequence(chars: &mut Peekable<Chars<'_>>) {
    match chars.next() {
        Some('[') => skip_csi(chars),
        Some(']') => skip_osc(chars),
        Some('P' | 'X' | '^' | '_') => skip_st(chars),
        Some(_) | None => {}
    }
}

fn skip_csi(chars: &mut Peekable<Chars<'_>>) {
    for ch in chars.by_ref() {
        if ('@'..='~').contains(&ch) {
            break;
        }
    }
}

fn skip_osc(chars: &mut Peekable<Chars<'_>>) {
    while let Some(ch) = chars.next() {
        match ch {
            '\u{7}' => break,
            '\u{1b}' if matches!(chars.peek(), Some('\\')) => {
                chars.next();
                break;
            }
            _ => {}
        }
    }
}

fn skip_st(chars: &mut Peekable<Chars<'_>>) {
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && matches!(chars.peek(), Some('\\')) {
            chars.next();
            break;
        }
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

    let _ = stop_service(app, service_id);

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

            // ── Hilo lector de stdout ──────────────────────────────────────
            if let Some(out) = child.stdout.take() {
                let buf = Arc::clone(&log_buf);
                let app_clone = app.clone();
                let sid = service_id.to_string();
                thread::spawn(move || {
                    for line in BufReader::new(out).lines().flatten() {
                        let mut locked = buf.lock().unwrap();
                        locked.append("stdout", line);
                        // Emitir la entrada recién añadida al frontend
                        if let Some(entry) = locked.entries.last().cloned() {
                            drop(locked);
                            emit_log_line(&app_clone, &sid, entry);
                        }
                    }
                });
            }

            // ── Hilo lector de stderr ──────────────────────────────────────
            if let Some(err) = child.stderr.take() {
                let buf = Arc::clone(&log_buf);
                let app_clone = app.clone();
                let sid = service_id.to_string();
                thread::spawn(move || {
                    for line in BufReader::new(err).lines().flatten() {
                        let mut locked = buf.lock().unwrap();
                        locked.append("stderr", line);
                        if let Some(entry) = locked.entries.last().cloned() {
                            drop(locked);
                            emit_log_line(&app_clone, &sid, entry);
                        }
                    }
                });
            }

            let supervisor = app.state::<RuntimeSupervisor>();
            supervisor
                .processes
                .lock()
                .unwrap()
                .insert(service_id.to_string(), ProcessEntry { child, log_buf });

            let snapshot = build_snapshot(app)?;
            // Emitir evento push para sincronizar otros listeners del frontend
            emit_dashboard_update(app);
            Ok(RunServiceResponse {
                snapshot,
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
    let snapshot = build_snapshot(app)?;
    emit_dashboard_update(app);
    Ok(ServiceActionResponse {
        snapshot,
        issue: None,
    })
}

pub fn restart_service(app: &AppHandle, service_id: &str) -> Result<ServiceActionResponse, String> {
    let _ = stop_service(app, service_id)?;
    let run_result = run_service(app, service_id)?;
    // emit_dashboard_update ya fue llamado dentro de stop_service y run_service
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

pub fn clear_service_logs(app: &AppHandle, service_id: &str) -> Result<ServiceLogSnapshot, String> {
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

#[cfg(test)]
mod tests {
    use super::sanitize_log_message;

    #[test]
    fn strips_ansi_sequences_from_log_lines() {
        let raw = "\u{1b}[2J\u{1b}[3J\u{1b}[H[\u{1b}[90m3:45:28 p. m.\u{1b}[0m] Starting compilation in watch mode...";
        assert_eq!(
            sanitize_log_message(raw),
            Some("[3:45:28 p. m.] Starting compilation in watch mode...".to_string())
        );
    }

    #[test]
    fn drops_lines_that_only_contain_terminal_control_sequences() {
        assert_eq!(sanitize_log_message("\u{1b}[2J\u{1b}[3J\u{1b}[H"), None);
    }

    #[test]
    fn resets_line_on_carriage_return_and_applies_backspace() {
        assert_eq!(
            sanitize_log_message("booting\rready\u{8}!"),
            Some("read!".to_string())
        );
    }
}
