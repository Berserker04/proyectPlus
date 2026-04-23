// ---------------------------------------------------------------------------
// storage/actions.rs — acciones rápidas del sistema operativo.
// Responsabilidad: abrir el explorador de archivos y abrir una terminal
// en el directorio de trabajo de un microservicio.
// ---------------------------------------------------------------------------

use std::process::Command;
use tauri::AppHandle;

use crate::models::TopologyEndpointResponse;

use super::db::open_db;

pub fn read_service_topology_manifest(
    app: &AppHandle,
    service_id: &str,
) -> Result<Option<String>, String> {
    let conn = open_db(app)?;
    let wd: String = conn
        .query_row(
            "SELECT working_directory FROM microservice WHERE id = ?1",
            rusqlite::params![service_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("service not found: {e}"))?;

    let manifest_path = std::path::Path::new(&wd).join("topology.manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }

    std::fs::read_to_string(&manifest_path)
        .map(Some)
        .map_err(|e| format!("failed to read {}: {e}", manifest_path.display()))
}

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

pub async fn fetch_service_topology_endpoint(
    url: &str,
    timeout_ms: Option<u64>,
) -> Result<TopologyEndpointResponse, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid topology url: {e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "topology url must include a host".to_string())?;

    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]";
    if !is_loopback {
        return Err("topology endpoint host must be localhost or loopback".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(1_500)))
        .build()
        .map_err(|e| format!("failed to build topology http client: {e}"))?;

    let response = client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("topology endpoint request failed: {e}"))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read topology endpoint body: {e}"))?;

    Ok(TopologyEndpointResponse { status, body })
}
