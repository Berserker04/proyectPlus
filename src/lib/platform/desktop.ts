import { fallbackSnapshot } from "@/lib/domain/mock-state";
import type {
  AppSettings,
  AppSettingsPathKind,
  DashboardSnapshot,
  K6LabPreferences,
  K6LabSnapshot,
  K6RunActionResponse,
  K6RunRequest,
  K6RunSnapshot,
  K6ScriptDraft,
  K6ValidationRequest,
  K6ValidationResult,
  ManualServiceDraft,
  RunServiceResponse,
  ServiceActionResponse,
  ServiceExecutionHistorySnapshot,
  ServiceLogSnapshot,
} from "@/lib/domain/models";

function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function buildFallbackServiceLogs(serviceId: string): ServiceLogSnapshot {
  return {
    serviceId,
    entries: [],
    droppedEntries: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function buildFallbackServiceExecutionHistory(serviceId: string): ServiceExecutionHistorySnapshot {
  return {
    serviceId,
    entries: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

function buildFallbackK6LabSnapshot(): K6LabSnapshot {
  return {
    scripts: [],
    profiles: [
      {
        id: "smoke",
        label: "Smoke",
        vus: 1,
        duration: "30s",
        rate: 1,
        thresholds: ["http_req_failed<0.01", "checks>0.95"],
      },
      {
        id: "load",
        label: "Load",
        vus: 10,
        duration: "5m",
        rate: 10,
        thresholds: ["p(95)<500", "http_req_failed<0.02"],
      },
      {
        id: "stress",
        label: "Stress",
        vus: 50,
        duration: "10m",
        rate: 50,
        thresholds: ["p(95)<900", "http_req_failed<0.05"],
      },
      {
        id: "spike",
        label: "Spike",
        vus: 100,
        duration: "1m",
        rate: 100,
        thresholds: ["p(95)<1200", "http_req_failed<0.08"],
      },
    ],
    binary: {
      isAvailable: false,
      resolvedPath: null,
      detail: "La validacion de k6 esta disponible solo en la app de escritorio.",
    },
    preferences: {
      selectedServiceId: null,
      scriptId: null,
      profileId: "smoke",
      vus: 1,
      duration: "30s",
      rate: 1,
      thresholds: ["http_req_failed<0.01", "checks>0.95"],
      k6BinaryPath: "",
    },
  };
}

function buildFallbackK6RunSnapshot(): K6RunSnapshot {
  return {
    activeRun: null,
    latestRun: null,
    history: [],
    latestReport: null,
    outputEntries: [],
    droppedOutputEntries: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function buildFallbackAppSettings(): AppSettings {
  return {
    defaultWorkspaceRoot: "",
    defaultLogExportRoot: "",
    allowedShells: ["cmd.exe", "powershell.exe", "pwsh.exe"],
    preferredShell: "cmd.exe",
    dashboardRefreshSeconds: 2,
    realtimeRefreshSeconds: 1,
    theme: "midnight",
    gpuMode: "auto",
    k6BinaryPath: "",
  };
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    return fallbackSnapshot;
  }

  return invokeDesktop<DashboardSnapshot>("get_catalog_snapshot");
}

export async function loadAppSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return buildFallbackAppSettings();
  }

  return invokeDesktop<AppSettings>("get_app_settings");
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return settings;
  }

  return invokeDesktop<AppSettings>("save_app_settings", { settings });
}

export async function pickAppSettingsPath(kind: AppSettingsPathKind): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return invokeDesktop<string | null>("pick_app_settings_path", { kind });
}

export async function selectWorkspaceRoot(): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("La seleccion de carpetas esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<DashboardSnapshot>("select_workspace_root");
}

export async function rescanActiveWorkspace(): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("El reescaneo del workspace esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<DashboardSnapshot>("rescan_active_workspace");
}

export async function registerManualService(draft: ManualServiceDraft): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("El registro manual de servicios esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<DashboardSnapshot>("register_manual_service", { draft });
}

export async function runService(serviceId: string): Promise<RunServiceResponse> {
  if (!isTauriRuntime()) {
    throw new Error("El arranque de servicios esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<RunServiceResponse>("run_service", { serviceId });
}

export async function stopService(serviceId: string): Promise<ServiceActionResponse> {
  if (!isTauriRuntime()) {
    throw new Error("La detencion de servicios esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<ServiceActionResponse>("stop_service", { serviceId });
}

export async function restartService(serviceId: string): Promise<ServiceActionResponse> {
  if (!isTauriRuntime()) {
    throw new Error("El reinicio de servicios esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<ServiceActionResponse>("restart_service", { serviceId });
}

export async function openServiceFolder(serviceId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Abrir carpetas del sistema esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<void>("open_service_folder", { serviceId });
}

export async function openServiceTerminal(serviceId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Abrir una terminal del sistema esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<void>("open_service_terminal", { serviceId });
}

export async function getServiceLogs(serviceId: string): Promise<ServiceLogSnapshot> {
  if (!isTauriRuntime()) {
    return buildFallbackServiceLogs(serviceId);
  }

  return invokeDesktop<ServiceLogSnapshot>("get_service_logs", { serviceId });
}

export async function clearServiceLogs(serviceId: string): Promise<ServiceLogSnapshot> {
  if (!isTauriRuntime()) {
    return buildFallbackServiceLogs(serviceId);
  }

  return invokeDesktop<ServiceLogSnapshot>("clear_service_logs", { serviceId });
}

export async function loadServiceExecutionHistory(serviceId: string): Promise<ServiceExecutionHistorySnapshot> {
  if (!isTauriRuntime()) {
    return buildFallbackServiceExecutionHistory(serviceId);
  }

  return invokeDesktop<ServiceExecutionHistorySnapshot>("get_service_execution_history", { serviceId });
}

export async function exportServiceLogs(serviceId: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("La exportacion de logs esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<string | null>("export_service_logs", { serviceId });
}

export async function loadK6LabSnapshot(): Promise<K6LabSnapshot> {
  if (!isTauriRuntime()) {
    return buildFallbackK6LabSnapshot();
  }

  return invokeDesktop<K6LabSnapshot>("get_k6_lab_snapshot");
}

export async function registerK6Script(draft: K6ScriptDraft): Promise<K6LabSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("El registro de scripts k6 esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<K6LabSnapshot>("register_k6_script", { draft });
}

export async function saveK6LabPreferences(preferences: K6LabPreferences): Promise<K6LabSnapshot> {
  if (!isTauriRuntime()) {
    return buildFallbackK6LabSnapshot();
  }

  return invokeDesktop<K6LabSnapshot>("save_k6_lab_preferences", { preferences });
}

export async function validateK6Setup(request: K6ValidationRequest): Promise<K6ValidationResult> {
  if (!isTauriRuntime()) {
    return {
      isValid: false,
      binary: {
        isAvailable: false,
        resolvedPath: null,
        detail: "La validacion de k6 esta disponible solo en la app de escritorio.",
      },
      thresholds: request.thresholds.map((expression) => ({
        expression,
        isValid: false,
        detail: "La validacion de thresholds esta disponible solo en la app de escritorio.",
      })),
      issues: ["La validacion de k6 esta disponible solo en la app de escritorio."],
    };
  }

  return invokeDesktop<K6ValidationResult>("validate_k6_setup", { request });
}

export async function loadK6RunSnapshot(): Promise<K6RunSnapshot> {
  if (!isTauriRuntime()) {
    return buildFallbackK6RunSnapshot();
  }

  return invokeDesktop<K6RunSnapshot>("get_k6_run_snapshot");
}

export async function startK6Run(request: K6RunRequest): Promise<K6RunActionResponse> {
  if (!isTauriRuntime()) {
    throw new Error("La ejecucion de k6 esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<K6RunActionResponse>("start_k6_run", { request });
}

export async function cancelK6Run(): Promise<K6RunActionResponse> {
  if (!isTauriRuntime()) {
    throw new Error("La cancelacion de k6 esta disponible solo en la app de escritorio.");
  }

  return invokeDesktop<K6RunActionResponse>("cancel_k6_run");
}
