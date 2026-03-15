// ---------------------------------------------------------------------------
// storage/actions.rs — acciones rápidas del sistema operativo.
// Responsabilidad: abrir el explorador de archivos y abrir una terminal
// en el directorio de trabajo de un microservicio.
// ---------------------------------------------------------------------------

use std::process::Command;
use tauri::AppHandle;

use super::db::open_db;

pub fn open_service_folder(app: &AppHandle, service_id: &str) -> Result<(), String> {
    let conn = open_db(app)?;
    let wd: String = conn
        .query_row(
            "SELECT working_directory FROM microservice WHERE id = ?1",
            rusqlite::params![service_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("service not found: {e}"))?;

    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(&wd)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&wd)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
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
            rusqlite::params![service_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("service not found: {e}"))?;

    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args(["/C", "start", "cmd.exe"])
        .current_dir(&wd)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .args(["-a", "Terminal", &wd])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    Command::new("x-terminal-emulator")
        .current_dir(&wd)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}
