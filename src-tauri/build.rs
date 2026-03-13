fn main() {
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=permissions");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_catalog_snapshot",
                "get_app_settings",
                "save_app_settings",
                "pick_app_settings_path",
                "select_workspace_root",
                "rescan_active_workspace",
                "register_manual_service",
                "run_service",
                "stop_service",
                "restart_service",
                "open_service_folder",
                "open_service_terminal",
                "get_service_logs",
                "clear_service_logs",
                "get_service_execution_history",
                "export_service_logs",
                "get_k6_lab_snapshot",
                "register_k6_script",
                "save_k6_lab_preferences",
                "validate_k6_setup",
                "get_k6_run_snapshot",
                "start_k6_run",
                "cancel_k6_run",
            ]),
        ),
    )
    .expect("failed to build tauri application manifest");
}
