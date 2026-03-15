import type {
  AppSettings,
  DashboardSnapshot,
  MicroserviceDraft,
  ProjectDraft,
  RunServiceResponse,
  ServiceActionResponse,
  ServiceLogSnapshot,
} from "@/lib/domain/models";

function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

// ---------------------------------------------------------------------------
// Dashboard & settings
// ---------------------------------------------------------------------------

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    return emptySnapshot();
  }
  return invokeDesktop<DashboardSnapshot>("get_catalog_snapshot");
}

export async function loadAppSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return defaultSettings();
  }
  return invokeDesktop<AppSettings>("get_app_settings");
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return settings;
  }
  return invokeDesktop<AppSettings>("save_app_settings", { settings });
}

export async function openDirectoryDialog(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invokeDesktop<string | null>("select_directory");
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(draft: ProjectDraft): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("create_project", { draft });
}

export async function updateProject(projectId: string, draft: ProjectDraft): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("update_project", { projectId, draft });
}

export async function deleteProject(projectId: string): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("delete_project", { projectId });
}

export async function selectProject(projectId: string): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("select_project", { projectId });
}

// ---------------------------------------------------------------------------
// Microservices
// ---------------------------------------------------------------------------

export async function createMicroservice(draft: MicroserviceDraft): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("create_microservice", { draft });
}

export async function updateMicroservice(serviceId: string, draft: MicroserviceDraft): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("update_microservice", { serviceId, draft });
}

export async function deleteMicroservice(serviceId: string): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("delete_microservice", { serviceId });
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export async function runService(serviceId: string): Promise<RunServiceResponse> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<RunServiceResponse>("run_service", { serviceId });
}

export async function stopService(serviceId: string): Promise<ServiceActionResponse> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<ServiceActionResponse>("stop_service", { serviceId });
}

export async function restartService(serviceId: string): Promise<ServiceActionResponse> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<ServiceActionResponse>("restart_service", { serviceId });
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function getServiceLogs(serviceId: string): Promise<ServiceLogSnapshot> {
  if (!isTauriRuntime()) {
    return { serviceId, entries: [], droppedEntries: 0, lastUpdatedAt: new Date().toISOString() };
  }
  return invokeDesktop<ServiceLogSnapshot>("get_service_logs", { serviceId });
}

export async function clearServiceLogs(serviceId: string): Promise<ServiceLogSnapshot> {
  if (!isTauriRuntime()) {
    return { serviceId, entries: [], droppedEntries: 0, lastUpdatedAt: new Date().toISOString() };
  }
  return invokeDesktop<ServiceLogSnapshot>("clear_service_logs", { serviceId });
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

export async function openServiceFolder(serviceId: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<void>("open_service_folder", { serviceId });
}

export async function openServiceTerminal(serviceId: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<void>("open_service_terminal", { serviceId });
}

export async function checkPortInUse(port: number): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invokeDesktop<boolean>("check_port_in_use", { port });
}

export async function updateServiceOrder(projectId: string, serviceIds: string[]): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) throw new Error("Solo disponible en la app de escritorio.");
  return invokeDesktop<DashboardSnapshot>("update_service_order", { projectId, serviceIds });
}

// ---------------------------------------------------------------------------
// Fallback helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): DashboardSnapshot {
  return {
    projects: [],
    services: [],
    system: {
      cpuTotalPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      lastRefreshAt: new Date().toISOString(),
    },
  };
}

function defaultSettings(): AppSettings {
  return {
    dashboardRefreshSeconds: 2,
    realtimeRefreshSeconds: 1,
  };
}
