fn main() {
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=permissions");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // Dashboard & Settings
            "get_catalog_snapshot",
            "get_app_settings",
            "save_app_settings",
            "get_project_topology",
            "save_project_topology",
            // Projects
            "create_project",
            "update_project",
            "delete_project",
            "select_project",
            // Microservices
            "create_microservice",
            "update_microservice",
            "delete_microservice",
            // Service runtime
            "run_service",
            "stop_service",
            "restart_service",
            // Logs
            "get_service_logs",
            "clear_service_logs",
            // Quick actions
            "open_service_folder",
            "open_service_terminal",
            "select_directory",
            "check_port_in_use",
        ]),
    ))
    .expect("failed to build tauri application manifest");
}
