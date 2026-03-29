// ---------------------------------------------------------------------------
// storage/events.rs — emisión de eventos Tauri al frontend.
// Responsabilidad:
//   • RefreshConfig: estado Tauri con el intervalo de refresco (ajustable).
//   • start_background_ticker: hilo de fondo que emite dashboard-update.
//   • emit_dashboard_update: helper para emitir desde acciones de runtime.
// ---------------------------------------------------------------------------

use std::{sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

use crate::models::DashboardSnapshot;

use super::db::build_snapshot;

// ---------------------------------------------------------------------------
// Estado Tauri: intervalo de refresco configurable en runtime
// ---------------------------------------------------------------------------

/// Almacena el intervalo del ticker (ms). Se actualiza cuando el usuario
/// cambia los ajustes de refresco en la UI.
pub struct RefreshConfig {
    pub dashboard_ms: Mutex<u64>,
}

impl Default for RefreshConfig {
    fn default() -> Self {
        Self {
            // 2 segundos por defecto, igual que la configuración inicial de la app.
            dashboard_ms: Mutex::new(2_000),
        }
    }
}

// ---------------------------------------------------------------------------
// Ticker de fondo
// ---------------------------------------------------------------------------

/// Arranca un hilo que emite `dashboard-update` periódicamente.
/// El intervalo se lee en cada iteración desde `RefreshConfig` para que
/// los cambios en Ajustes sean efectivos sin reiniciar la app.
pub fn start_background_ticker(app: AppHandle) {
    thread::spawn(move || loop {
        let ms = {
            let config = app.state::<RefreshConfig>();
            let x = *config.dashboard_ms.lock().unwrap();
            x
        };
        thread::sleep(Duration::from_millis(ms));
        if let Ok(snapshot) = build_snapshot(&app) {
            emit_dashboard_snapshot(&app, &snapshot);
        }
    });
}

// ---------------------------------------------------------------------------
// Helper reutilizable
// ---------------------------------------------------------------------------

/// Emite un `dashboard-update` puntual. Llamado desde run/stop/restart
/// para actualizar la UI inmediatamente después de una acción.
pub fn emit_dashboard_snapshot(app: &AppHandle, snapshot: &DashboardSnapshot) {
    let _ = app.emit("dashboard-update", snapshot.clone());
}

pub fn emit_dashboard_update(app: &AppHandle) {
    if let Ok(snapshot) = build_snapshot(app) {
        emit_dashboard_snapshot(app, &snapshot);
    }
}
