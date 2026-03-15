// ---------------------------------------------------------------------------
// storage/db.rs — persistencia SQLite.
// Responsabilidad: abrir la conexión, inicializar el schema, CRUD de proyectos
// y microservicios, settings de la app y construcción del DashboardSnapshot.
// ---------------------------------------------------------------------------

use crate::models::{
    AppSettings, DashboardSnapshot, Microservice, MicroserviceDraft, Project, ProjectDraft,
    SystemMetrics,
};
use chrono::Utc;
use rusqlite::{params, Connection};
use sysinfo::System;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::runtime::{get_live_status, stop_service, RuntimeSupervisor, TelemetryCache};

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const SETTINGS_SCOPE: &str = "global";
const SETTINGS_KEY: &str = "app_settings";

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
// Conexión
// ---------------------------------------------------------------------------

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create_dir_all: {e}"))?;
    let db_path = data_dir.join("ms-control-center.db");
    Connection::open(&db_path).map_err(|e| format!("open db: {e}"))
}

pub fn initialize_database(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("schema: {e}"))?;
    // Migración proactiva: ignoramos el error si la columna ya existe.
    let _ = conn.execute(
        "ALTER TABLE microservice ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        [],
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Builders internos de snapshot
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
            "SELECT id, project_id, name, working_directory, start_command, expected_port,
                    sort_order, created_at, updated_at
             FROM microservice
             WHERE project_id = ?1
             ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,       // id
                row.get::<_, String>(1)?,       // project_id
                row.get::<_, String>(2)?,       // name
                row.get::<_, String>(3)?,       // working_directory
                row.get::<_, String>(4)?,       // start_command
                row.get::<_, Option<i64>>(5)?,  // expected_port
                row.get::<_, i64>(6)?,          // sort_order
                row.get::<_, String>(7)?,       // created_at
                row.get::<_, String>(8)?,       // updated_at
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

/// Construye el DashboardSnapshot completo. Llamado por CRUD y por runtime.
pub(crate) fn build_snapshot(app: &AppHandle) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let cache = app.state::<TelemetryCache>();
    let supervisor = app.state::<RuntimeSupervisor>();

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
    let active_id = projects.iter().find(|p| p.is_active).map(|p| p.id.clone());

    let services = if let Some(id) = active_id {
        let sys = cache.system.lock().unwrap();
        load_services_for_project(&conn, &id, &supervisor, &sys)?
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
// API pública — dashboard y settings
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
// API pública — proyectos
// ---------------------------------------------------------------------------

pub fn create_project(app: &AppHandle, draft: ProjectDraft) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
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

pub fn delete_project(app: &AppHandle, project_id: &str) -> Result<DashboardSnapshot, String> {
    // Detener todos los procesos del proyecto antes de eliminarlo.
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
        let _ = conn.execute(
            "UPDATE project SET is_active = 1 WHERE id = (SELECT id FROM project ORDER BY updated_at DESC LIMIT 1)",
            [],
        );
    }
    build_snapshot(app)
}

pub fn select_project(app: &AppHandle, project_id: &str) -> Result<DashboardSnapshot, String> {
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
// API pública — microservicios
// ---------------------------------------------------------------------------

pub fn create_microservice(
    app: &AppHandle,
    draft: MicroserviceDraft,
) -> Result<DashboardSnapshot, String> {
    let conn = open_db(app)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let next_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM microservice WHERE project_id = ?1",
            params![draft.project_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO microservice
         (id, project_id, name, working_directory, start_command, expected_port, sort_order, created_at, updated_at)
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
        "UPDATE microservice
         SET name=?1, working_directory=?2, start_command=?3, expected_port=?4, updated_at=?5
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
    conn.execute("DELETE FROM microservice WHERE id = ?1", params![service_id])
        .map_err(|e| e.to_string())?;
    build_snapshot(app)
}

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
