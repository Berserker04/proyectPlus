mod models;
mod storage;

use tauri::{AppHandle, RunEvent};

use models::{
    AppSettings, DashboardSnapshot, K6LabPreferences, K6LabSnapshot, K6RunActionResponse,
    K6RunRequest, K6RunSnapshot, K6ScriptDraft, K6ValidationRequest, K6ValidationResult,
    ManualServiceDraft, RunServiceResponse, ServiceActionResponse,
    ServiceExecutionHistorySnapshot, ServiceLogSnapshot,
};

#[tauri::command]
fn get_catalog_snapshot(app: AppHandle) -> Result<DashboardSnapshot, String> {
    storage::get_dashboard_snapshot(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    storage::get_app_settings(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    storage::save_app_settings(&app, settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_app_settings_path(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    storage::pick_app_settings_path(&app, &kind).map_err(|error| error.to_string())
}

#[tauri::command]
fn select_workspace_root(app: AppHandle) -> Result<DashboardSnapshot, String> {
    storage::select_workspace_root(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn rescan_active_workspace(app: AppHandle) -> Result<DashboardSnapshot, String> {
    storage::rescan_active_workspace(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn register_manual_service(app: AppHandle, draft: ManualServiceDraft) -> Result<DashboardSnapshot, String> {
    storage::register_manual_service(&app, draft).map_err(|error| error.to_string())
}

#[tauri::command]
fn run_service(app: AppHandle, service_id: String) -> Result<RunServiceResponse, String> {
    storage::run_service(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_service(app: AppHandle, service_id: String) -> Result<ServiceActionResponse, String> {
    storage::stop_service(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn restart_service(app: AppHandle, service_id: String) -> Result<ServiceActionResponse, String> {
    storage::restart_service(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_service_folder(app: AppHandle, service_id: String) -> Result<(), String> {
    storage::open_service_folder(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_service_terminal(app: AppHandle, service_id: String) -> Result<(), String> {
    storage::open_service_terminal(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_service_logs(app: AppHandle, service_id: String) -> Result<ServiceLogSnapshot, String> {
    storage::get_service_logs(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_service_logs(app: AppHandle, service_id: String) -> Result<ServiceLogSnapshot, String> {
    storage::clear_service_logs(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_service_execution_history(
    app: AppHandle,
    service_id: String,
) -> Result<ServiceExecutionHistorySnapshot, String> {
    storage::get_service_execution_history(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_service_logs(app: AppHandle, service_id: String) -> Result<Option<String>, String> {
    storage::export_service_logs(&app, &service_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_k6_lab_snapshot(app: AppHandle) -> Result<K6LabSnapshot, String> {
    storage::get_k6_lab_snapshot(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn register_k6_script(app: AppHandle, draft: K6ScriptDraft) -> Result<K6LabSnapshot, String> {
    storage::register_k6_script(&app, draft).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_k6_lab_preferences(app: AppHandle, preferences: K6LabPreferences) -> Result<K6LabSnapshot, String> {
    storage::save_k6_lab_preferences(&app, preferences).map_err(|error| error.to_string())
}

#[tauri::command]
fn validate_k6_setup(app: AppHandle, request: K6ValidationRequest) -> Result<K6ValidationResult, String> {
    storage::validate_k6_setup(&app, request).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_k6_run_snapshot(app: AppHandle) -> Result<K6RunSnapshot, String> {
    storage::get_k6_run_snapshot(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn start_k6_run(app: AppHandle, request: K6RunRequest) -> Result<K6RunActionResponse, String> {
    storage::start_k6_run(&app, request).map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_k6_run(app: AppHandle) -> Result<K6RunActionResponse, String> {
    storage::cancel_k6_run(&app).map_err(|error| error.to_string())
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(storage::RuntimeSupervisor::default())
        .manage(storage::K6RunnerSupervisor::default())
        .invoke_handler(tauri::generate_handler![
            get_catalog_snapshot,
            get_app_settings,
            save_app_settings,
            pick_app_settings_path,
            select_workspace_root,
            rescan_active_workspace,
            register_manual_service,
            run_service,
            stop_service,
            restart_service,
            open_service_folder,
            open_service_terminal,
            get_service_logs,
            clear_service_logs,
            get_service_execution_history,
            export_service_logs,
            get_k6_lab_snapshot,
            register_k6_script,
            save_k6_lab_preferences,
            validate_k6_setup,
            get_k6_run_snapshot,
            start_k6_run,
            cancel_k6_run
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            let _ = storage::cleanup_runtime_supervisor(app_handle);
            let _ = storage::cleanup_k6_runner(app_handle);
        }
    });
}
