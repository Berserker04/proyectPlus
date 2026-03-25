mod models;
mod storage;

use tauri::{AppHandle, RunEvent};

use models::{
    AppSettings, DashboardSnapshot, MicroserviceDraft, PortKillResponse, ProjectDraft,
    ProjectTopology, RunServiceResponse, ServiceActionResponse, ServiceLogSnapshot,
};

// ---------------------------------------------------------------------------
// Dashboard & settings
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_catalog_snapshot(app: AppHandle) -> Result<DashboardSnapshot, String> {
    storage::get_dashboard_snapshot(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    storage::get_app_settings(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    storage::save_app_settings(&app, settings).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_topology(app: AppHandle, project_id: String) -> Result<ProjectTopology, String> {
    storage::get_project_topology(&app, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project_topology(
    app: AppHandle,
    topology: ProjectTopology,
) -> Result<ProjectTopology, String> {
    storage::save_project_topology(&app, topology).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_project(app: AppHandle, draft: ProjectDraft) -> Result<DashboardSnapshot, String> {
    storage::create_project(&app, draft).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_project(
    app: AppHandle,
    project_id: String,
    draft: ProjectDraft,
) -> Result<DashboardSnapshot, String> {
    storage::update_project(&app, &project_id, draft).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project(app: AppHandle, project_id: String) -> Result<DashboardSnapshot, String> {
    storage::delete_project(&app, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn select_project(app: AppHandle, project_id: String) -> Result<DashboardSnapshot, String> {
    storage::select_project(&app, &project_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Microservices
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_microservice(
    app: AppHandle,
    draft: MicroserviceDraft,
) -> Result<DashboardSnapshot, String> {
    storage::create_microservice(&app, draft).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_microservice(
    app: AppHandle,
    service_id: String,
    draft: MicroserviceDraft,
) -> Result<DashboardSnapshot, String> {
    storage::update_microservice(&app, &service_id, draft).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_microservice(app: AppHandle, service_id: String) -> Result<DashboardSnapshot, String> {
    storage::delete_microservice(&app, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_service_order(
    app: AppHandle,
    project_id: String,
    service_ids: Vec<String>,
) -> Result<DashboardSnapshot, String> {
    storage::update_service_order(&app, &project_id, service_ids).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Service runtime
// ---------------------------------------------------------------------------

#[tauri::command]
fn run_service(app: AppHandle, service_id: String) -> Result<RunServiceResponse, String> {
    storage::run_service(&app, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_service(app: AppHandle, service_id: String) -> Result<ServiceActionResponse, String> {
    storage::stop_service(&app, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn restart_service(app: AppHandle, service_id: String) -> Result<ServiceActionResponse, String> {
    storage::restart_service(&app, &service_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_service_logs(app: AppHandle, service_id: String) -> Result<ServiceLogSnapshot, String> {
    storage::get_service_logs(&app, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_service_logs(app: AppHandle, service_id: String) -> Result<ServiceLogSnapshot, String> {
    storage::clear_service_logs(&app, &service_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_service_folder(app: AppHandle, service_id: String) -> Result<(), String> {
    storage::open_service_folder(&app, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_service_terminal(app: AppHandle, service_id: String) -> Result<(), String> {
    storage::open_service_terminal(&app, &service_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_process_on_port(app: AppHandle, port: u16) -> Result<PortKillResponse, String> {
    storage::kill_process_on_port(&app, port).map_err(|e| e.to_string())
}

#[tauri::command]
fn select_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

pub fn run() {
    let app = tauri::Builder::default()
        .manage(storage::RuntimeSupervisor::default())
        .manage(storage::TelemetryCache::default())
        .manage(storage::RefreshConfig::default())
        .invoke_handler(tauri::generate_handler![
            get_catalog_snapshot,
            get_app_settings,
            save_app_settings,
            get_project_topology,
            save_project_topology,
            create_project,
            update_project,
            delete_project,
            select_project,
            create_microservice,
            update_microservice,
            delete_microservice,
            update_service_order,
            run_service,
            stop_service,
            restart_service,
            get_service_logs,
            clear_service_logs,
            open_service_folder,
            open_service_terminal,
            kill_process_on_port,
            select_directory,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    storage::initialize_database(&app.handle()).expect("failed to initialize database");
    storage::start_background_ticker(app.handle().clone());

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            let _ = storage::cleanup_runtime(&app_handle);
        }
    });
}
