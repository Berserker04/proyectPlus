// ---------------------------------------------------------------------------
// storage/mod.rs — declara submódulos y reexporta la API pública.
// lib.rs no necesita ningún cambio: `mod storage;` resuelve automáticamente
// este archivo cuando existe el directorio storage/.
// ---------------------------------------------------------------------------

mod actions;
mod db;
mod metrics;
mod runtime;

// Re-exports — superficie pública idéntica a la de storage.rs anterior
pub use db::{
    create_microservice, create_project, delete_microservice, delete_project,
    get_app_settings, get_dashboard_snapshot, initialize_database, save_app_settings,
    select_project, update_microservice, update_project, update_service_order,
};
pub use metrics::is_port_open;
pub use runtime::{
    cleanup_runtime, clear_service_logs, get_service_logs, restart_service,
    run_service, stop_service, RuntimeSupervisor, TelemetryCache,
};
pub use actions::{open_service_folder, open_service_terminal};
