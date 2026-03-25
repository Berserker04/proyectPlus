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
    PortKillResponse, RunServiceResponse, ServiceActionIssue, ServiceActionResponse,
    ServiceLogEntry, ServiceLogLineEvent, ServiceLogSnapshot,
};
use chrono::Utc;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{BufRead, BufReader},
    iter::Peekable,
    process::{Child, Command, Stdio},
    str::Chars,
    sync::{Arc, Mutex},
    thread,
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
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

#[derive(Clone)]
struct BlockingSignal {
    code: &'static str,
    title: &'static str,
    message: String,
    detail: Option<String>,
    port_conflict: bool,
}

#[derive(Clone, Default)]
pub(crate) struct LogBuffer {
    pub entries: Vec<ServiceLogEntry>,
    pub sequence: u64,
    pub dropped: u64,
    pub has_error: bool,
    blocking_signal: Option<BlockingSignal>,
}

impl LogBuffer {
    pub fn append(&mut self, stream: &str, message: String) -> Option<(ServiceLogEntry, bool)> {
        let Some(message) = sanitize_log_message(&message) else {
            return None;
        };
        let level = detect_log_level(stream, &message);
        let mut notify_dashboard = false;
        if !self.has_error && level == "error" {
            self.has_error = true;
            notify_dashboard = true;
        }
        if self.blocking_signal.is_none() {
            if let Some(signal) = detect_blocking_signal(stream, &message) {
                self.blocking_signal = Some(signal);
                notify_dashboard = true;
            }
        }
        self.sequence += 1;
        if self.entries.len() >= MAX_LOG_ENTRIES {
            self.entries.remove(0);
            self.dropped += 1;
        }
        let entry = ServiceLogEntry {
            sequence: self.sequence,
            timestamp: Utc::now().to_rfc3339(),
            stream: stream.to_string(),
            level: level.to_string(),
            message,
        };
        self.entries.push(entry.clone());
        Some((entry, notify_dashboard))
    }
}

/// Estado de Tauri que supervisa todos los procesos hijos lanzados por la app.
#[derive(Default)]
pub struct RuntimeSupervisor {
    pub(crate) processes: Mutex<HashMap<String, ProcessEntry>>,
}

/// Cache de métricas del sistema (sysinfo::System) compartido entre polls.
pub struct TelemetryCache {
    pub(crate) system: Mutex<System>,
}

impl Default for TelemetryCache {
    fn default() -> Self {
        let mut system = System::new();
        system.refresh_memory();
        // Prime CPU counters once so the next poll can compute a stable usage delta.
        system.refresh_cpu_all();
        Self {
            system: Mutex::new(system),
        }
    }
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
    pub has_log_error: bool,
    pub last_signal: String,
    pub issue: Option<crate::models::ServiceActionIssue>,
    pub port_conflict: bool,
}

/// Calcula el estado en tiempo real de un servicio cruzando el supervisor
/// de procesos con sysinfo.
pub(crate) fn get_live_status(
    service_id: &str,
    expected_port: Option<u16>,
    detected_port: Option<u16>,
    supervisor: &RuntimeSupervisor,
    sys: &System,
) -> LiveStatus {
    let procs = supervisor.processes.lock().unwrap();

    if let Some(entry) = procs.get(service_id) {
        let (has_log_error, blocking_signal) = entry
            .log_buf
            .lock()
            .map(|buf| (buf.has_error, buf.blocking_signal.clone()))
            .unwrap_or((false, None));
        let pid_raw = entry.child.id();
        let pid = Pid::from_u32(pid_raw);
        if let Some(proc_info) = sys.process(pid) {
            if let Some(signal) = blocking_signal.filter(|_| detected_port.is_none()) {
                return LiveStatus {
                    status: "error".to_string(),
                    pid: Some(pid_raw),
                    detected_port: None,
                    cpu_percent: proc_info.cpu_usage() as f64,
                    memory_bytes: proc_info.memory(),
                    has_log_error,
                    last_signal: signal.message.clone(),
                    issue: Some(ServiceActionIssue {
                        service_id: service_id.to_string(),
                        code: signal.code.to_string(),
                        title: signal.title.to_string(),
                        message: signal.message,
                        detail: signal.detail,
                    }),
                    port_conflict: signal.port_conflict,
                };
            }
            return LiveStatus {
                status: "running".to_string(),
                pid: Some(pid_raw),
                detected_port,
                cpu_percent: proc_info.cpu_usage() as f64,
                memory_bytes: proc_info.memory(),
                has_log_error,
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
            has_log_error,
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
                has_log_error: false,
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
        has_log_error: false,
        last_signal: String::new(),
        issue: None,
        port_conflict: false,
    }
}

pub(crate) fn resolve_supervised_ports(
    supervisor: &RuntimeSupervisor,
) -> HashMap<String, Option<u16>> {
    let root_pids: Vec<(String, u32)> = {
        let procs = supervisor.processes.lock().unwrap();
        procs
            .iter()
            .map(|(service_id, entry)| (service_id.clone(), entry.child.id()))
            .collect()
    };

    if root_pids.is_empty() {
        return HashMap::new();
    }

    #[cfg(target_os = "windows")]
    {
        resolve_supervised_ports_windows(&root_pids)
    }

    #[cfg(not(target_os = "windows"))]
    {
        root_pids
            .into_iter()
            .map(|(service_id, _)| (service_id, None))
            .collect()
    }
}

#[cfg(target_os = "windows")]
fn resolve_supervised_ports_windows(root_pids: &[(String, u32)]) -> HashMap<String, Option<u16>> {
    let (children_by_parent, ports_by_pid) = load_windows_process_runtime_state();

    root_pids
        .iter()
        .map(|(service_id, root_pid)| {
            let mut ports: Vec<u16> = collect_process_tree_pids(*root_pid, &children_by_parent)
                .into_iter()
                .flat_map(|pid| ports_by_pid.get(&pid).into_iter().flatten().copied())
                .collect();
            ports.sort_unstable();
            ports.dedup();
            (service_id.clone(), ports.into_iter().next())
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn load_windows_process_runtime_state() -> (HashMap<u32, Vec<u32>>, HashMap<u32, Vec<u16>>) {
    let (children_by_parent, mut ports_by_pid) = query_windows_process_runtime_state();
    if ports_by_pid.is_empty() {
        populate_ports_from_netstat(&mut ports_by_pid);
    }
    (children_by_parent, ports_by_pid)
}

#[cfg(target_os = "windows")]
fn query_windows_process_runtime_state() -> (HashMap<u32, Vec<u32>>, HashMap<u32, Vec<u16>>) {
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut ports_by_pid: HashMap<u32, Vec<u16>> = HashMap::new();

    let output = Command::new("powershell")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='SilentlyContinue'; \
             Get-CimInstance Win32_Process | ForEach-Object { \"PROC {0} {1}\" -f $_.ParentProcessId, $_.ProcessId }; \
             Get-NetTCPConnection -State Listen | ForEach-Object { \"PORT {0} {1}\" -f $_.OwningProcess, $_.LocalPort }",
        ])
        .output();

    let Ok(output) = output else {
        return (children_by_parent, ports_by_pid);
    };

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split_whitespace();
        match parts.next() {
            Some("PROC") => {
                let Some(parent_raw) = parts.next() else {
                    continue;
                };
                let Some(child_raw) = parts.next() else {
                    continue;
                };
                let Ok(parent_pid) = parent_raw.parse::<u32>() else {
                    continue;
                };
                let Ok(child_pid) = child_raw.parse::<u32>() else {
                    continue;
                };
                children_by_parent
                    .entry(parent_pid)
                    .or_default()
                    .push(child_pid);
            }
            Some("PORT") => {
                let Some(pid_raw) = parts.next() else {
                    continue;
                };
                let Some(port_raw) = parts.next() else {
                    continue;
                };
                let Ok(pid) = pid_raw.parse::<u32>() else {
                    continue;
                };
                let Ok(port) = port_raw.parse::<u16>() else {
                    continue;
                };
                ports_by_pid.entry(pid).or_default().push(port);
            }
            _ => {}
        }
    }

    (children_by_parent, ports_by_pid)
}

#[cfg(target_os = "windows")]
fn collect_process_tree_pids(
    root_pid: u32,
    children_by_parent: &HashMap<u32, Vec<u32>>,
) -> HashSet<u32> {
    let mut queue = VecDeque::from([root_pid]);
    let mut seen = HashSet::new();

    while let Some(pid) = queue.pop_front() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(children) = children_by_parent.get(&pid) {
            queue.extend(children.iter().copied());
        }
    }

    seen
}

#[cfg(target_os = "windows")]
fn populate_ports_from_netstat(ports_by_pid: &mut HashMap<u32, Vec<u16>>) {
    let Ok(output) = Command::new("netstat").args(["-ano", "-p", "tcp"]).output() else {
        return;
    };

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let columns: Vec<&str> = line.split_whitespace().collect();
        if columns.len() < 5 || !columns[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !columns[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        let Some(port) = parse_local_port(columns[1]) else {
            continue;
        };
        let Ok(pid) = columns[4].parse::<u32>() else {
            continue;
        };
        ports_by_pid.entry(pid).or_default().push(port);
    }
}

#[cfg(target_os = "windows")]
fn parse_local_port(local_address: &str) -> Option<u16> {
    local_address
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

#[cfg(target_os = "windows")]
fn listener_pids_for_port(ports_by_pid: &HashMap<u32, Vec<u16>>, port: u16) -> Vec<u32> {
    let mut pids: Vec<u32> = ports_by_pid
        .iter()
        .filter_map(|(pid, ports)| ports.contains(&port).then_some(*pid))
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

#[cfg(target_os = "windows")]
fn supervised_service_matches_for_listener_pids(
    supervisor: &RuntimeSupervisor,
    children_by_parent: &HashMap<u32, Vec<u32>>,
    listener_pids: &[u32],
) -> (Vec<String>, HashSet<u32>) {
    let listener_pid_set: HashSet<u32> = listener_pids.iter().copied().collect();
    let procs = supervisor.processes.lock().unwrap();
    let mut matched_service_ids = Vec::new();
    let mut covered_pids = HashSet::new();

    for (service_id, entry) in procs.iter() {
        let process_tree = collect_process_tree_pids(entry.child.id(), children_by_parent);
        if process_tree
            .iter()
            .any(|pid| listener_pid_set.contains(pid))
        {
            matched_service_ids.push(service_id.clone());
            covered_pids.extend(process_tree);
        }
    }

    matched_service_ids.sort();
    matched_service_ids.dedup();
    (matched_service_ids, covered_pids)
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    let output = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output()
        .map_err(|error| format!("failed to execute taskkill for PID {pid}: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("taskkill exited with status {}", output.status)
    };

    Err(format!("failed to kill PID {pid}: {detail}"))
}

pub(crate) fn refresh_system_telemetry(supervisor: &RuntimeSupervisor, sys: &mut System) {
    let pids: Vec<Pid> = {
        let procs = supervisor.processes.lock().unwrap();
        procs
            .values()
            .map(|entry| Pid::from_u32(entry.child.id()))
            .collect()
    };

    sys.refresh_memory();
    sys.refresh_cpu_usage();

    if pids.is_empty() {
        return;
    }

    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );
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

fn detect_log_level(stream: &str, message: &str) -> &'static str {
    let mut saw_info = false;
    let mut saw_debug = false;
    let mut saw_trace = false;

    for token in message.split(|ch: char| !ch.is_alphanumeric()) {
        if token.is_empty() {
            continue;
        }

        match token.to_ascii_lowercase().as_str() {
            "error" | "fatal" | "panic" | "exception" | "failed" | "failure" => return "error",
            "warn" | "warning" => return "warn",
            "debug" => saw_debug = true,
            "trace" | "verbose" => saw_trace = true,
            "info" | "log" => saw_info = true,
            _ => {}
        }
    }

    if stream == "stderr" {
        return "error";
    }
    if saw_debug {
        return "debug";
    }
    if saw_trace {
        return "trace";
    }
    if saw_info {
        return "info";
    }
    "info"
}

fn detect_blocking_signal(stream: &str, message: &str) -> Option<BlockingSignal> {
    let normalized = message.to_ascii_lowercase();

    if normalized.contains("eaddrinuse") || normalized.contains("address already in use") {
        return Some(BlockingSignal {
            code: "PORT_IN_USE",
            title: "Port busy",
            message: message.to_string(),
            detail: Some("The service failed to bind its listening port.".to_string()),
            port_conflict: true,
        });
    }

    if normalized.contains("can't resolve dependencies")
        || normalized.contains("unknowndependenciesexception")
    {
        return Some(BlockingSignal {
            code: "DEPENDENCY_RESOLUTION_FAILED",
            title: "Nest bootstrap failed",
            message: message.to_string(),
            detail: Some(
                "Nest could not resolve one or more providers required to finish startup."
                    .to_string(),
            ),
            port_conflict: false,
        });
    }

    if normalized.contains("[exceptionhandler]") {
        let detail = if stream == "stderr" {
            Some("Nest reported an exception during bootstrap/runtime handling.".to_string())
        } else {
            None
        };
        return Some(BlockingSignal {
            code: "RUNTIME_EXCEPTION_HANDLER",
            title: "Service bootstrap blocked",
            message: message.to_string(),
            detail,
            port_conflict: false,
        });
    }

    if normalized.contains("triggeruncaughtexception")
        || normalized.contains("uncaughtexception")
        || normalized.contains("unhandledrejection")
    {
        return Some(BlockingSignal {
            code: "UNCAUGHT_RUNTIME_EXCEPTION",
            title: "Process crashed",
            message: message.to_string(),
            detail: Some(
                "The runtime raised an uncaught exception and stopped serving traffic.".to_string(),
            ),
            port_conflict: false,
        });
    }

    None
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
                        if let Some((entry, promoted_to_error)) = locked.append("stdout", line) {
                            drop(locked);
                            emit_log_line(&app_clone, &sid, entry);
                            if promoted_to_error {
                                emit_dashboard_update(&app_clone);
                            }
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
                        if let Some((entry, promoted_to_error)) = locked.append("stderr", line) {
                            drop(locked);
                            emit_log_line(&app_clone, &sid, entry);
                            if promoted_to_error {
                                emit_dashboard_update(&app_clone);
                            }
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

#[cfg(target_os = "windows")]
pub fn kill_process_on_port(app: &AppHandle, port: u16) -> Result<PortKillResponse, String> {
    let (children_by_parent, ports_by_pid) = load_windows_process_runtime_state();
    let listener_pids = listener_pids_for_port(&ports_by_pid, port);

    if listener_pids.is_empty() {
        return Err(format!("No process is listening on port {port}."));
    }

    let (matched_service_ids, covered_supervised_pids) = {
        let supervisor = app.state::<RuntimeSupervisor>();
        supervised_service_matches_for_listener_pids(
            &supervisor,
            &children_by_parent,
            &listener_pids,
        )
    };

    for service_id in &matched_service_ids {
        stop_service(app, service_id)?;
    }

    for pid in listener_pids
        .iter()
        .copied()
        .filter(|pid| !covered_supervised_pids.contains(pid))
    {
        kill_process_tree(pid)?;
    }

    let snapshot = build_snapshot(app)?;
    emit_dashboard_update(app);

    Ok(PortKillResponse {
        snapshot,
        port,
        killed_pids: listener_pids,
        matched_service_ids,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn kill_process_on_port(_app: &AppHandle, _port: u16) -> Result<PortKillResponse, String> {
    Err("kill_process_on_port is only available on Windows.".to_string())
}

pub fn stop_service(app: &AppHandle, service_id: &str) -> Result<ServiceActionResponse, String> {
    let supervisor = app.state::<RuntimeSupervisor>();
    let mut procs = supervisor.processes.lock().unwrap();
    if let Some(mut entry) = procs.remove(service_id) {
        let pid = entry.child.id();
        #[cfg(target_os = "windows")]
        {
            let _ = kill_process_tree(pid);
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
        buf.has_error = false;
    }
    drop(procs);
    emit_dashboard_update(app);
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
            let _ = kill_process_tree(pid);
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
    #[cfg(target_os = "windows")]
    use super::listener_pids_for_port;
    use super::{detect_blocking_signal, detect_log_level, sanitize_log_message};
    #[cfg(target_os = "windows")]
    use std::collections::HashMap;

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

    #[test]
    fn detects_error_keywords_from_stdout_messages() {
        assert_eq!(
            detect_log_level(
                "stdout",
                "[Nest] 128072  - 21/03/2026, 7:54:37 p. m.   ERROR : cuando en la log salga un error"
            ),
            "error"
        );
    }

    #[test]
    fn keeps_stderr_as_error_without_explicit_keyword() {
        assert_eq!(detect_log_level("stderr", "listen EADDRINUSE"), "error");
    }

    #[test]
    fn detects_blocking_signal_from_exception_handler_logs() {
        let signal = detect_blocking_signal(
            "stderr",
            "[Nest] 43168  - 25/03/2026, 2:57:32 p. m.   ERROR [ExceptionHandler] EXPORT_STORAGE_PATH is required",
        )
        .expect("expected blocking signal");

        assert_eq!(signal.code, "RUNTIME_EXCEPTION_HANDLER");
        assert!(!signal.port_conflict);
    }

    #[test]
    fn detects_dependency_resolution_failures_as_blocking() {
        let signal = detect_blocking_signal(
            "stderr",
            "UnknownDependenciesException [Error]: Nest can't resolve dependencies of the PrismaService (?)",
        )
        .expect("expected blocking signal");

        assert_eq!(signal.code, "DEPENDENCY_RESOLUTION_FAILED");
    }

    #[test]
    fn detects_eaddrinuse_as_port_conflict() {
        let signal = detect_blocking_signal(
            "stderr",
            "Error: listen EADDRINUSE: address already in use :::3012",
        )
        .expect("expected blocking signal");

        assert_eq!(signal.code, "PORT_IN_USE");
        assert!(signal.port_conflict);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_listener_pids_for_a_port() {
        let mut ports_by_pid = HashMap::new();
        ports_by_pid.insert(101, vec![3000, 4000]);
        ports_by_pid.insert(202, vec![4000]);
        ports_by_pid.insert(303, vec![8080]);

        assert_eq!(listener_pids_for_port(&ports_by_pid, 4000), vec![101, 202]);
    }
}
