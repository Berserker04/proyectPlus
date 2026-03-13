import { startTransition, useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { K6LabPanel } from "@/components/K6LabPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import type {
  AppSettings,
  DashboardSnapshot,
  ManualServiceDraft,
  ServiceExecutionHistorySnapshot,
  ServiceLogSnapshot,
  ServiceRecord,
  ServiceStatus,
} from "@/lib/domain/models";
import { fallbackSnapshot } from "@/lib/domain/mock-state";
import {
  clearServiceLogs,
  exportServiceLogs,
  getServiceLogs,
  loadAppSettings,
  loadDashboardSnapshot,
  loadServiceExecutionHistory,
  openServiceFolder,
  openServiceTerminal,
  registerManualService,
  rescanActiveWorkspace,
  restartService,
  runService,
  selectWorkspaceRoot,
  stopService,
} from "@/lib/platform/desktop";

type SortKey = "name" | "status" | "port" | "cpu" | "ram" | "startedAt" | "uptime";
type SyncAction = "select" | "rescan" | "manual" | null;
type StatusFilter = "all" | ServiceStatus;
type ManualServiceFormState = {
  name: string;
  path: string;
  runtimeType: string;
  frameworkType: string;
  expectedPort: string;
  startCommand: string;
  tags: string;
  env: string;
};
type FeedbackState = {
  tone: "info" | "error" | "success";
  message: string;
  detail?: string | null;
};
type PendingServiceActionState = {
  serviceId: string;
  action: "run" | "stop" | "restart";
};
type LogStreamFilter = "all" | "stdout" | "stderr";
type ActiveView = "dashboard" | "settings";

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "name", label: "Nombre" },
  { value: "status", label: "Estado" },
  { value: "port", label: "Puerto" },
  { value: "cpu", label: "CPU" },
  { value: "ram", label: "RAM" },
  { value: "startedAt", label: "Inicio" },
  { value: "uptime", label: "Uptime" },
];

const statusOrder: Record<ServiceRecord["status"], number> = {
  running: 0,
  starting: 1,
  stopped: 2,
  error: 3,
};

const initialManualServiceForm: ManualServiceFormState = {
  name: "",
  path: "",
  runtimeType: "node",
  frameworkType: "custom",
  expectedPort: "",
  startCommand: "",
  tags: "",
  env: "",
};

const initialAppSettings: AppSettings = {
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

export default function App() {
  const isDesktopRuntime = Boolean(window.__TAURI_INTERNALS__);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(fallbackSnapshot);
  const [appSettings, setAppSettings] = useState<AppSettings>(initialAppSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [activeAction, setActiveAction] = useState<SyncAction>(null);
  const [pendingServiceAction, setPendingServiceAction] = useState<PendingServiceActionState | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [focusedServiceId, setFocusedServiceId] = useState<string | null>(null);
  const [logSnapshot, setLogSnapshot] = useState<ServiceLogSnapshot | null>(null);
  const [executionHistorySnapshot, setExecutionHistorySnapshot] = useState<ServiceExecutionHistorySnapshot | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingExecutionHistory, setIsLoadingExecutionHistory] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [logStreamFilter, setLogStreamFilter] = useState<LogStreamFilter>("all");
  const [isLogAutoscrollPaused, setIsLogAutoscrollPaused] = useState(false);
  const [manualServiceForm, setManualServiceForm] = useState<ManualServiceFormState>(initialManualServiceForm);
  const [feedback, setFeedback] = useState<FeedbackState | null>({
    tone: "info",
    message: window.__TAURI_INTERNALS__
      ? "Selecciona un workspace para empezar a operar tus servicios."
      : "Vista previa web: abre la app de escritorio para seleccionar carpetas y ejecutar acciones del sistema.",
  });

  const deferredQuery = useDeferredValue(query);
  const deferredLogQuery = useDeferredValue(logQuery);
  const hasStartingService = snapshot.services.some((service) => service.status === "starting");
  const dashboardRefreshMs = Math.max(1, appSettings.dashboardRefreshSeconds) * 1_000;
  const realtimeRefreshMs = Math.max(1, appSettings.realtimeRefreshSeconds) * 1_000;

  function applySnapshotUpdate(nextSnapshot: DashboardSnapshot) {
    setSnapshot(nextSnapshot);
    setPendingServiceAction((current) => {
      if (!current) {
        return null;
      }

      const pendingService = nextSnapshot.services.find((service) => service.id === current.serviceId);
      if (!pendingService) {
        return null;
      }

      if (pendingService.status === "running") {
        setFeedback({
          tone: "success",
          message: current.action === "restart"
            ? `${pendingService.name} fue reiniciado y ya esta corriendo.`
            : `${pendingService.name} ya esta corriendo.`,
          detail: pendingService.detectedPort
            ? `PID ${pendingService.pid ?? "-"} escuchando en ${pendingService.detectedPort}.`
            : `PID ${pendingService.pid ?? "-"} supervisado sin puerto detectado.`,
        });
        return null;
      }

      if (pendingService.status === "error") {
        setFeedback({
          tone: "error",
          message: pendingService.issue
            ? `${pendingService.issue.title}: ${pendingService.issue.message}`
            : `${pendingService.name} termino con error durante el arranque.`,
          detail: pendingService.issue?.detail ?? pendingService.lastSignal,
        });
        return null;
      }

      return pendingService.status === "starting" ? current : null;
    });
  }

  function applyLogSnapshotUpdate(nextSnapshot: ServiceLogSnapshot) {
    setLogSnapshot(nextSnapshot);
  }

  useEffect(() => {
    let ignore = false;

    void Promise.all([loadDashboardSnapshot(), loadAppSettings()])
      .then(([nextSnapshot, nextSettings]) => {
        if (ignore) {
          return;
        }

        applySnapshotUpdate(nextSnapshot);
        setAppSettings(nextSettings);
      })
      .catch((error: unknown) => {
        if (ignore) {
          return;
        }

        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "No fue posible cargar el catalogo.",
          detail: null,
        });
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = appSettings.theme;
  }, [appSettings.theme]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let ignore = false;
    const refreshIntervalMs = hasStartingService ? realtimeRefreshMs : dashboardRefreshMs;
    const interval = window.setInterval(() => {
      void loadDashboardSnapshot()
        .then((nextSnapshot) => {
          if (ignore) {
            return;
          }

          applySnapshotUpdate(nextSnapshot);
        })
        .catch((error: unknown) => {
          if (ignore) {
            return;
          }

          setFeedback({
            tone: "error",
            message: "No fue posible actualizar el estado de los servicios.",
            detail: error instanceof Error ? error.message : null,
          });
        });
    }, refreshIntervalMs);

    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, [dashboardRefreshMs, hasStartingService, isDesktopRuntime, realtimeRefreshMs]);

  useEffect(() => {
    if (!focusedServiceId) {
      setLogSnapshot(null);
      setExecutionHistorySnapshot(null);
      return;
    }

    let ignore = false;
    setIsLoadingLogs(true);

    void getServiceLogs(focusedServiceId)
      .then((nextLogSnapshot) => {
        if (!ignore) {
          applyLogSnapshotUpdate(nextLogSnapshot);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setFeedback({
            tone: "error",
            message: "No fue posible cargar los logs del servicio enfocado.",
            detail: error instanceof Error ? error.message : null,
          });
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingLogs(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [focusedServiceId]);

  useEffect(() => {
    if (!focusedServiceId) {
      setExecutionHistorySnapshot(null);
      return;
    }

    let ignore = false;
    setIsLoadingExecutionHistory(true);

    void loadServiceExecutionHistory(focusedServiceId)
      .then((nextHistorySnapshot) => {
        if (!ignore) {
          setExecutionHistorySnapshot(nextHistorySnapshot);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setFeedback({
            tone: "error",
            message: "No fue posible cargar el historial operativo del servicio enfocado.",
            detail: error instanceof Error ? error.message : null,
          });
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingExecutionHistory(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [focusedServiceId]);

  useEffect(() => {
    if (!focusedServiceId || !isDesktopRuntime) {
      return;
    }

    let ignore = false;
    const interval = window.setInterval(() => {
      void getServiceLogs(focusedServiceId)
        .then((nextLogSnapshot) => {
          if (!ignore) {
            applyLogSnapshotUpdate(nextLogSnapshot);
          }
        })
        .catch((error: unknown) => {
          if (!ignore) {
            setFeedback({
              tone: "error",
              message: "No fue posible refrescar los logs del servicio enfocado.",
              detail: error instanceof Error ? error.message : null,
            });
          }
        });
    }, realtimeRefreshMs);

    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, [focusedServiceId, isDesktopRuntime, realtimeRefreshMs]);

  useEffect(() => {
    if (!focusedServiceId || !isDesktopRuntime) {
      return;
    }

    let ignore = false;
    const interval = window.setInterval(() => {
      void loadServiceExecutionHistory(focusedServiceId)
        .then((nextHistorySnapshot) => {
          if (!ignore) {
            setExecutionHistorySnapshot(nextHistorySnapshot);
          }
        })
        .catch((error: unknown) => {
          if (!ignore) {
            setFeedback({
              tone: "error",
              message: "No fue posible refrescar el historial operativo del servicio enfocado.",
              detail: error instanceof Error ? error.message : null,
            });
          }
        });
    }, dashboardRefreshMs);

    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, [dashboardRefreshMs, focusedServiceId, isDesktopRuntime]);

  useEffect(() => {
    if (isLogAutoscrollPaused || !logSnapshot) {
      return;
    }

    const viewport = logViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    });
  }, [isLogAutoscrollPaused, logSnapshot]);

  const activeWorkspace = snapshot.workspaces.find((workspace) => workspace.isActive);
  const serviceTypes = buildServiceTypes(snapshot.services);
  const serviceTags = buildServiceTags(snapshot.services);
  const visibleServices = buildVisibleServices(snapshot.services, {
    query: deferredQuery,
    sortKey,
    statusFilter,
    typeFilter,
    tagFilter,
  });
  const activeFilterCount = [statusFilter !== "all", typeFilter !== "all", tagFilter !== "all", deferredQuery.trim().length > 0]
    .filter(Boolean)
    .length;
  const portConflictCount = snapshot.services.filter((service) => service.portConflict).length;
  const runningServicesCount = snapshot.services.filter((service) => service.status === "running").length;
  const focusedService = snapshot.services.find((service) => service.id === focusedServiceId) ?? null;
  const serviceCatalogKey = snapshot.services.map((service) => service.id).join("|");
  const visibleLogEntries = (logSnapshot?.entries ?? []).filter((entry) => {
    if (logStreamFilter !== "all" && entry.stream !== logStreamFilter) {
      return false;
    }

    if (deferredLogQuery.trim()) {
      const haystack = [entry.message, entry.level, entry.stream].join(" ").toLowerCase();
      return haystack.includes(deferredLogQuery.trim().toLowerCase());
    }

    return true;
  });
  const executionEntries = executionHistorySnapshot?.entries ?? [];

  async function runWorkspaceAction(action: SyncAction) {
    if (!action) {
      return;
    }

    setActiveAction(action);
    setFeedback(null);

    try {
      const nextSnapshot = action === "select"
        ? await selectWorkspaceRoot()
        : await rescanActiveWorkspace();

      setSnapshot(nextSnapshot);
      setFeedback({
        tone: "success",
        message: action === "select"
          ? "Workspace listo para trabajar."
          : "Catalogo actualizado.",
        detail: null,
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No fue posible completar la accion.",
        detail: null,
      });
    } finally {
      setActiveAction(null);
    }
  }

  async function submitManualService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeWorkspace) {
      setFeedback({
        tone: "error",
        message: "Selecciona primero un workspace activo para guardar un manifest manual.",
        detail: null,
      });
      return;
    }

    setActiveAction("manual");
    setFeedback(null);

    try {
      const draft: ManualServiceDraft = {
        name: manualServiceForm.name.trim(),
        path: manualServiceForm.path.trim(),
        runtimeType: manualServiceForm.runtimeType.trim(),
        frameworkType: manualServiceForm.frameworkType.trim(),
        expectedPort: manualServiceForm.expectedPort.trim()
          ? Number(manualServiceForm.expectedPort.trim())
          : null,
        startCommand: manualServiceForm.startCommand.trim(),
        tags: parseTagsInput(manualServiceForm.tags),
        env: parseEnvInput(manualServiceForm.env),
      };

      const nextSnapshot = await registerManualService(draft);
      setSnapshot(nextSnapshot);
      setManualServiceForm({
        ...initialManualServiceForm,
        runtimeType: manualServiceForm.runtimeType.trim() || "node",
        frameworkType: manualServiceForm.frameworkType.trim() || "custom",
      });
      setFeedback({
        tone: "success",
        message: "Servicio manual agregado al catalogo.",
        detail: null,
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No fue posible guardar el servicio manual.",
        detail: null,
      });
    } finally {
      setActiveAction(null);
    }
  }

  async function handleRunService(service: ServiceRecord) {
    setPendingServiceAction({
      serviceId: service.id,
      action: "run",
    });
    setFeedback({
      tone: "info",
      message: `Solicitando arranque de ${service.name}.`,
      detail: `La app refresca el dashboard cada ${appSettings.dashboardRefreshSeconds}s y acelera a ${appSettings.realtimeRefreshSeconds}s durante el arranque.`,
    });

    try {
      const response = await runService(service.id);
      setSnapshot(response.snapshot);

      if (response.issue) {
        setPendingServiceAction(null);
        setFeedback({
          tone: "error",
          message: `${response.issue.title}: ${response.issue.message}`,
          detail: response.issue.detail ?? null,
        });
        return;
      }

      setFeedback({
        tone: "info",
        message: `${service.name} paso a supervision con estado starting.`,
        detail: `La UI seguira refrescando el snapshot cada ${appSettings.realtimeRefreshSeconds}s hasta que el servicio transicione a running o error.`,
      });
    } catch (error: unknown) {
      setPendingServiceAction(null);
      setFeedback({
        tone: "error",
        message: `No fue posible iniciar ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleStopService(service: ServiceRecord) {
    setPendingServiceAction({
      serviceId: service.id,
      action: "stop",
    });
    setFeedback({
      tone: "info",
      message: `Solicitando Stop para ${service.name}.`,
      detail: "La app cerrara el arbol de procesos supervisado y actualizara el catalogo al terminar.",
    });

    try {
      const response = await stopService(service.id);
      setSnapshot(response.snapshot);
      setPendingServiceAction(null);

      if (response.issue) {
        setFeedback({
          tone: "error",
          message: `${response.issue.title}: ${response.issue.message}`,
          detail: response.issue.detail ?? null,
        });
        return;
      }

      setFeedback({
        tone: "success",
        message: `${service.name} quedo detenido.`,
        detail: "El proceso se detuvo y el estado ya fue actualizado.",
      });
    } catch (error: unknown) {
      setPendingServiceAction(null);
      setFeedback({
        tone: "error",
        message: `No fue posible detener ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleRestartService(service: ServiceRecord) {
    setPendingServiceAction({
      serviceId: service.id,
      action: "restart",
    });
    setFeedback({
      tone: "info",
      message: `Solicitando Restart para ${service.name}.`,
      detail: "La app detendra el proceso actual y lanzara un nuevo intento supervisado.",
    });

    try {
      const response = await restartService(service.id);
      setSnapshot(response.snapshot);

      if (response.issue) {
        setPendingServiceAction(null);
        setFeedback({
          tone: "error",
          message: `${response.issue.title}: ${response.issue.message}`,
          detail: response.issue.detail ?? null,
        });
        return;
      }

      setFeedback({
        tone: "info",
        message: `${service.name} entro en secuencia de restart.`,
        detail: "La UI seguira refrescando el snapshot hasta confirmar running o error.",
      });
    } catch (error: unknown) {
      setPendingServiceAction(null);
      setFeedback({
        tone: "error",
        message: `No fue posible reiniciar ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleOpenServiceFolder(service: ServiceRecord) {
    try {
      await openServiceFolder(service.id);
      setFeedback({
        tone: "success",
        message: `Carpeta abierta para ${service.name}.`,
        detail: service.path,
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: `No fue posible abrir la carpeta de ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleOpenServiceTerminal(service: ServiceRecord) {
    try {
      await openServiceTerminal(service.id);
      setFeedback({
        tone: "success",
        message: `Terminal abierta en ${service.name}.`,
        detail: service.startCommand
          ? `Comando sugerido: ${service.startCommand}`
          : "La terminal se abrio en la carpeta del servicio sin comando sugerido.",
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: `No fue posible abrir una terminal para ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleCopyPort(service: ServiceRecord) {
    const resolvedPort = service.detectedPort ?? service.expectedPort;
    if (!resolvedPort) {
      setFeedback({
        tone: "error",
        message: `${service.name} no tiene un puerto para copiar.`,
        detail: "Configura expectedPort en el manifest o deja que autodiscovery lo resuelva.",
      });
      return;
    }

    try {
      await copyTextToClipboard(String(resolvedPort));
      setFeedback({
        tone: "success",
        message: `Puerto ${resolvedPort} copiado para ${service.name}.`,
        detail: service.portConflict
          ? "Advertencia: el puerto aparece ocupado fuera del supervisor o en estado inconsistente."
          : null,
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: `No fue posible copiar el puerto de ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleCopyCommand(service: ServiceRecord) {
    if (!service.startCommand) {
      setFeedback({
        tone: "error",
        message: `${service.name} no tiene un start command para copiar.`,
        detail: "Configura startCommand en el manifest o deja que autodiscovery detecte scripts del proyecto.",
      });
      return;
    }

    try {
      await copyTextToClipboard(service.startCommand);
      setFeedback({
        tone: "success",
        message: `Start command copiado para ${service.name}.`,
        detail: service.startCommand,
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: `No fue posible copiar el comando de ${service.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  function handleViewLogs(service: ServiceRecord) {
    setFocusedServiceId(service.id);
    setLogQuery("");
    setIsLogAutoscrollPaused(false);
    setLogStreamFilter("all");
    setFeedback({
      tone: service.issue || service.portConflict ? "error" : "info",
      message: `Detalle operativo preparado para ${service.name}.`,
      detail: service.issue?.detail
        ?? (service.portConflict
          ? `El puerto esperado ${service.expectedPort ?? "-"} aparece ocupado fuera del supervisor.`
          : "El panel mostrara logs recientes y el historial de ejecuciones."),
    });

    window.requestAnimationFrame(() => {
      document.getElementById("service-log-handoff")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }

  async function handleClearLogs() {
    if (!focusedService) {
      return;
    }

    try {
      const nextLogSnapshot = await clearServiceLogs(focusedService.id);
      applyLogSnapshotUpdate(nextLogSnapshot);
      setFeedback({
        tone: "success",
        message: `Buffer de logs limpiado para ${focusedService.name}.`,
        detail: "La vista se limpio y seguira mostrando lineas nuevas si el servicio sigue activo.",
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: `No fue posible limpiar los logs de ${focusedService.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  async function handleExportLogs() {
    if (!focusedService) {
      return;
    }

    try {
      const exportedPath = await exportServiceLogs(focusedService.id);
      if (!exportedPath) {
        setFeedback({
          tone: "info",
          message: `Exportacion cancelada para ${focusedService.name}.`,
          detail: null,
        });
        return;
      }

      setFeedback({
        tone: "success",
        message: `Logs exportados para ${focusedService.name}.`,
        detail: exportedPath,
      });
    } catch (error: unknown) {
      setFeedback({
        tone: "error",
        message: `No fue posible exportar los logs de ${focusedService.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar panel">
        <div className="sidebar-header">
          <p className="eyebrow">Control local</p>
          <h1>MS Control Center</h1>
          <p className="lede">
            Opera servicios, revisa estado local y ejecuta pruebas desde un solo panel.
          </p>
        </div>

        <section className="sidebar-section">
          <div className="section-heading">
            <h2>Workspaces</h2>
            <span>{snapshot.workspaces.length}</span>
          </div>
          <div className="workspace-list">
            {snapshot.workspaces.length === 0 ? (
              <article className="workspace-card">
                <div>
                  <strong>Sin workspace</strong>
                  <p>Selecciona una carpeta raiz para crear el catalogo local.</p>
                </div>
              </article>
            ) : (
              snapshot.workspaces.map((workspace) => (
                <article
                  key={workspace.id}
                  className={`workspace-card ${workspace.isActive ? "is-active" : ""}`}
                >
                  <div>
                    <strong>{workspace.name}</strong>
                    <p>{workspace.rootPath}</p>
                  </div>
                  <span className="meta-pill">
                    {workspace.lastScannedAt ? "Escaneado" : "Pendiente"}
                  </span>
                </article>
              ))
            )}
          </div>
          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => void runWorkspaceAction("select")}
              disabled={activeAction !== null}
            >
              {activeAction === "select" ? "Selecting..." : "Select root"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void runWorkspaceAction("rescan")}
              disabled={activeAction !== null || !activeWorkspace}
            >
              {activeAction === "rescan" ? "Rescanning..." : "Rescan"}
            </button>
          </div>
        </section>
      </aside>

      <main className="main-column">
        <section className="hero panel">
          <div className="hero-copy">
            <p className="eyebrow">Panel operativo</p>
            <h2>Descubre, controla y prueba tus microservicios locales desde una sola vista.</h2>
            <p className="lede">
              Selecciona un workspace, revisa estado, PID, puertos y consumo de recursos,
              arranca o reinicia servicios, consulta logs en vivo y prepara corridas k6
              sin salir del flujo local de desarrollo.
            </p>
          </div>
          <div className="hero-metrics">
            <MetricCard
              label="Workspace activo"
              value={activeWorkspace?.name ?? "Ninguno"}
              accent="amber"
            />
            <MetricCard
              label="Servicios visibles"
              value={String(visibleServices.length)}
              accent="cyan"
            />
            <MetricCard
              label="Ultimo refresh"
              value={formatTimestamp(snapshot.system.lastRefreshAt)}
              accent="lime"
            />
            <MetricCard
              label="Servicios corriendo"
              value={String(runningServicesCount)}
              accent="rose"
            />
          </div>
        </section>

        {feedback ? (
          <section className={`feedback-banner ${feedback.tone}`}>
            <strong>{feedback.tone === "error" ? "Error" : feedback.tone === "success" ? "OK" : "Info"}</strong>
            <div className="feedback-copy">
              <span>{feedback.message}</span>
              {feedback.detail ? <small>{feedback.detail}</small> : null}
            </div>
          </section>
        ) : null}

        <section className="view-switcher">
          <button
            type="button"
            className={`ghost-button ${activeView === "dashboard" ? "is-selected" : ""}`}
            onClick={() => setActiveView("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`ghost-button ${activeView === "settings" ? "is-selected" : ""}`}
            onClick={() => setActiveView("settings")}
          >
            Settings
          </button>
        </section>

        <section className="summary-strip">
          <SummaryBadge label="Refresh" value={formatTimestamp(snapshot.system.lastRefreshAt)} />
          <SummaryBadge label="Catalogo" value={String(snapshot.services.length)} />
          <SummaryBadge label="Filtros" value={activeFilterCount === 0 ? "Sin filtros" : String(activeFilterCount)} />
          <SummaryBadge label="CPU" value={`${snapshot.system.cpuTotalPercent.toFixed(0)}%`} />
          <SummaryBadge
            label="Puertos"
            value={portConflictCount === 0 ? "Sin conflictos" : `${portConflictCount} en conflicto`}
          />
          <SummaryBadge
            label="RAM"
            value={`${formatBytes(snapshot.system.memoryUsedBytes)} / ${formatBytes(snapshot.system.memoryTotalBytes)}`}
          />
          <SummaryBadge
            label="GPU"
            value={
              appSettings.gpuMode === "disabled"
                ? "Disabled"
                : snapshot.system.gpuTotalPercent === null
                ? "Not available"
                : `${snapshot.system.gpuTotalPercent.toFixed(0)}%`
            }
          />
          <SummaryBadge label="Tema" value={appSettings.theme} />
          <SummaryBadge label="Modo" value={isDesktopRuntime ? "Desktop" : "Vista web"} />
        </section>

        {activeView === "settings" ? (
          <SettingsPanel
            isDesktopRuntime={isDesktopRuntime}
            settings={appSettings}
            onFeedback={(nextFeedback) => setFeedback(nextFeedback)}
            onSettingsSaved={(nextSettings) => setAppSettings(nextSettings)}
          />
        ) : (
        <section className="content-grid">
          <div className="panel service-panel">
            <div className="service-panel-head">
              <div>
                <p className="eyebrow">Servicios</p>
                <h3>Vista principal de servicios</h3>
              </div>
              <div className="controls">
                <label className="control">
                  <span>Buscar</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      startTransition(() => {
                        setQuery(nextValue);
                      });
                    }}
                    placeholder="auth, payments, gateway..."
                  />
                </label>
                <label className="control">
                  <span>Ordenar por</span>
                  <select
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as SortKey)}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control">
                  <span>Estado</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  >
                    <option value="all">Todos</option>
                    <option value="running">Running</option>
                    <option value="starting">Starting</option>
                    <option value="stopped">Stopped</option>
                    <option value="error">Error</option>
                  </select>
                </label>
                <label className="control">
                  <span>Tipo</span>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                  >
                    <option value="all">Todos</option>
                    {serviceTypes.map((serviceType) => (
                      <option key={serviceType} value={serviceType}>
                        {serviceType}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control">
                  <span>Tag</span>
                  <select
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value)}
                  >
                    <option value="all">Todas</option>
                    {serviceTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Servicio</th>
                    <th>Ruta</th>
                    <th>Framework</th>
                    <th>Estado</th>
                    <th>PID</th>
                    <th>Puerto</th>
                    <th>Uptime</th>
                    <th>CPU</th>
                    <th>RAM</th>
                    <th>GPU</th>
                    <th>Ultima senal</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleServices.length === 0 ? (
                    <tr>
                      <td className="empty-row" colSpan={12}>
                        {snapshot.services.length === 0
                          ? "Selecciona un workspace para poblar el catalogo con servicios detectados."
                          : "No hay servicios que coincidan con los filtros activos."}
                      </td>
                    </tr>
                  ) : (
                    visibleServices.map((service) => (
                      <tr key={service.id}>
                        <td>
                          <div className="service-primary">
                            <strong>{service.name}</strong>
                            <div className="tag-row">
                              <span className={`tag-chip source-chip ${service.source}`}>
                                {service.source === "manifest" ? "manifest" : "auto"}
                              </span>
                              {service.portConflict ? (
                                <span className="tag-chip warning-chip">port busy</span>
                              ) : null}
                              {service.tags.length === 0 ? (
                                <span className="tag-chip">sin tags</span>
                              ) : (
                                service.tags.map((tag) => (
                                  <span key={tag} className="tag-chip">
                                    {tag}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{service.path}</td>
                        <td>
                          <span className="framework-pill">
                            {service.frameworkType} / {service.runtimeType}
                          </span>
                        </td>
                        <td>
                          <span className={`status-pill ${service.status}`}>{service.status}</span>
                        </td>
                        <td>{service.pid ?? "-"}</td>
                        <td>{service.detectedPort ?? service.expectedPort ?? "-"}</td>
                        <td>{formatUptime(service.uptimeSeconds)}</td>
                        <td>{service.cpuPercent.toFixed(1)}%</td>
                        <td>{formatBytes(service.memoryBytes)}</td>
                        <td>{formatGpuUsage(service)}</td>
                        <td>{service.lastSignal}</td>
                        <td>
                          <div className="service-actions">
                            {service.status === "running" || service.status === "starting" ? (
                              <>
                                <div className="service-main-actions">
                                  <button
                                    type="button"
                                    className="ghost-button table-button"
                                    onClick={() => void handleStopService(service)}
                                    disabled={
                                      !window.__TAURI_INTERNALS__ ||
                                      pendingServiceAction?.serviceId === service.id
                                    }
                                  >
                                    {pendingServiceAction?.serviceId === service.id && pendingServiceAction.action === "stop"
                                      ? "Stopping..."
                                      : "Stop"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button table-button"
                                    onClick={() => void handleRestartService(service)}
                                    disabled={
                                      !window.__TAURI_INTERNALS__ ||
                                      pendingServiceAction?.serviceId === service.id
                                    }
                                  >
                                    {pendingServiceAction?.serviceId === service.id && pendingServiceAction.action === "restart"
                                      ? "Restarting..."
                                      : "Restart"}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="ghost-button table-button"
                                onClick={() => void handleRunService(service)}
                                disabled={
                                  !window.__TAURI_INTERNALS__ ||
                                  pendingServiceAction?.serviceId === service.id ||
                                  service.status === "starting"
                                }
                              >
                                {pendingServiceAction?.serviceId === service.id && pendingServiceAction.action === "run"
                                  ? "Starting..."
                                  : service.status === "starting"
                                  ? "Starting..."
                                  : "Run"}
                              </button>
                            )}
                            <div className="service-utility-actions">
                              <button
                                type="button"
                                className="utility-button"
                                onClick={() => void handleOpenServiceFolder(service)}
                                disabled={!window.__TAURI_INTERNALS__}
                              >
                                Folder
                              </button>
                              <button
                                type="button"
                                className="utility-button"
                                onClick={() => void handleOpenServiceTerminal(service)}
                                disabled={!window.__TAURI_INTERNALS__}
                              >
                                Terminal
                              </button>
                              <button
                                type="button"
                                className="utility-button"
                                onClick={() => void handleCopyPort(service)}
                              >
                                Copy port
                              </button>
                              <button
                                type="button"
                                className="utility-button"
                                onClick={() => void handleCopyCommand(service)}
                              >
                                Copy cmd
                              </button>
                              <button
                                type="button"
                                className="utility-button"
                                onClick={() => handleViewLogs(service)}
                              >
                                Logs
                              </button>
                            </div>
                            {service.portConflict ? (
                              <p className="action-note">
                                Puerto esperado ocupado: {service.expectedPort ?? "-"}.
                              </p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {isLoading ? (
              <p className="lede">Cargando catalogo inicial...</p>
            ) : null}
          </div>

          <div className="rail-column">
            <div className="panel rail-panel">
              <div className="section-heading">
                <h3>Manifest manual</h3>
                <span>{activeWorkspace ? "Activo" : "Sin workspace"}</span>
              </div>
              <p className="form-hint">
                Guarda overrides en <code>.ms-control-center/services.manifest.json</code> del
                workspace activo. Si la ruta coincide con un servicio detectado, el manifest
                gana; si no existe por heuristica, se crea como servicio manual. El
                <code>startCommand</code> solo admite launchers en allowlist y bloquea chaining,
                redirecciones o escapes fuera del workspace.
              </p>
              <form className="manual-form" onSubmit={(event) => void submitManualService(event)}>
                <div className="manual-form-grid">
                  <label className="control">
                    <span>Nombre</span>
                    <input
                      type="text"
                      value={manualServiceForm.name}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))}
                      placeholder="Legacy Gateway"
                    />
                  </label>
                  <label className="control">
                    <span>Ruta relativa</span>
                    <input
                      type="text"
                      value={manualServiceForm.path}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        path: event.target.value,
                      }))}
                      placeholder="legacy/gateway"
                    />
                  </label>
                  <label className="control">
                    <span>Runtime</span>
                    <input
                      type="text"
                      value={manualServiceForm.runtimeType}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        runtimeType: event.target.value,
                      }))}
                      placeholder="node"
                    />
                  </label>
                  <label className="control">
                    <span>Framework</span>
                    <input
                      type="text"
                      value={manualServiceForm.frameworkType}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        frameworkType: event.target.value,
                      }))}
                      placeholder="express"
                    />
                  </label>
                  <label className="control">
                    <span>Puerto</span>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={manualServiceForm.expectedPort}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        expectedPort: event.target.value,
                      }))}
                      placeholder="8088"
                    />
                  </label>
                  <label className="control control-wide">
                    <span>Start command</span>
                    <input
                      type="text"
                      value={manualServiceForm.startCommand}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        startCommand: event.target.value,
                      }))}
                      placeholder="npm --prefix legacy/gateway run dev"
                    />
                  </label>
                  <label className="control control-wide">
                    <span>Tags</span>
                    <input
                      type="text"
                      value={manualServiceForm.tags}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        tags: event.target.value,
                      }))}
                      placeholder="gateway, legacy"
                    />
                  </label>
                  <label className="control control-wide">
                    <span>Env</span>
                    <textarea
                      value={manualServiceForm.env}
                      onChange={(event) => setManualServiceForm((current) => ({
                        ...current,
                        env: event.target.value,
                      }))}
                      rows={4}
                      placeholder={"PORT=8088\nNODE_ENV=development"}
                    />
                  </label>
                </div>
                <div className="action-row">
                  <button
                    type="submit"
                    className="ghost-button"
                    disabled={activeAction !== null || !activeWorkspace}
                  >
                    {activeAction === "manual" ? "Saving..." : "Save manual service"}
                  </button>
                </div>
              </form>
            </div>

            <K6LabPanel
              activeWorkspacePath={activeWorkspace?.rootPath ?? null}
              catalogKey={serviceCatalogKey}
              isDesktopRuntime={isDesktopRuntime}
              realtimeRefreshSeconds={appSettings.realtimeRefreshSeconds}
              services={snapshot.services}
              onFeedback={(nextFeedback) => setFeedback(nextFeedback)}
            />

            <div className="panel rail-panel">
              <div className="section-heading">
                <h3>Logs live</h3>
                <span>{focusedService ? `${visibleLogEntries.length}/${logSnapshot?.entries.length ?? 0}` : "Sin foco"}</span>
              </div>
              <div id="service-log-handoff" className="log-handoff">
                {focusedService ? (
                  <>
                    <div className="handoff-head">
                      <div>
                        <strong>{focusedService.name}</strong>
                        <p className="form-hint">
                          Salida reciente de <code>stdout</code> y <code>stderr</code> con busqueda,
                          limpieza manual y exportacion puntual.
                        </p>
                      </div>
                      <span className={`status-pill ${focusedService.status}`}>{focusedService.status}</span>
                    </div>
                    <div className="log-toolbar">
                      <label className="control log-control">
                        <span>Buscar</span>
                        <input
                          type="text"
                          value={logQuery}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            startTransition(() => {
                              setLogQuery(nextValue);
                            });
                          }}
                          placeholder="error, warn, migration..."
                        />
                      </label>
                      <label className="control log-control">
                        <span>Stream</span>
                        <select
                          value={logStreamFilter}
                          onChange={(event) => setLogStreamFilter(event.target.value as LogStreamFilter)}
                        >
                          <option value="all">Todos</option>
                          <option value="stdout">stdout</option>
                          <option value="stderr">stderr</option>
                        </select>
                      </label>
                      <div className="log-toolbar-actions">
                        <button
                          type="button"
                          className="utility-button"
                          onClick={() => setIsLogAutoscrollPaused((current) => !current)}
                        >
                          {isLogAutoscrollPaused ? "Resume autoscroll" : "Pause autoscroll"}
                        </button>
                        <button
                          type="button"
                          className="utility-button"
                          onClick={() => void handleClearLogs()}
                          disabled={!isDesktopRuntime}
                        >
                          Clear buffer
                        </button>
                        <button
                          type="button"
                          className="utility-button"
                          onClick={() => void handleExportLogs()}
                          disabled={!isDesktopRuntime}
                        >
                          Export .log
                        </button>
                      </div>
                    </div>
                    <ul className="architecture-list">
                      <li>
                        <strong>Ultima senal</strong>
                        <p>{focusedService.lastSignal}</p>
                      </li>
                      <li>
                        <strong>Ruta</strong>
                        <p>{focusedService.path}</p>
                      </li>
                      <li>
                        <strong>Start command</strong>
                        <p>{focusedService.startCommand ?? "No configurado"}</p>
                      </li>
                      <li>
                        <strong>Puerto</strong>
                        <p>
                          {focusedService.detectedPort ?? focusedService.expectedPort ?? "No resuelto"}
                          {focusedService.portConflict ? " - ocupado fuera del supervisor" : ""}
                        </p>
                      </li>
                      <li>
                        <strong>GPU</strong>
                        <p>{formatGpuUsage(focusedService)}</p>
                      </li>
                      <li>
                        <strong>Buffer</strong>
                        <p>
                          {logSnapshot?.entries.length ?? 0} lineas disponibles
                          {logSnapshot && logSnapshot.droppedEntries > 0
                            ? ` (${logSnapshot.droppedEntries} descartadas por limite)`
                            : ""}
                          {logSnapshot ? ` - ${formatLogTimestamp(logSnapshot.lastUpdatedAt)}` : ""}
                        </p>
                      </li>
                    </ul>
                    <div ref={logViewportRef} className={`log-stream ${isLogAutoscrollPaused ? "paused" : ""}`}>
                      {isLoadingLogs ? (
                        <p className="form-hint">Cargando logs del servicio seleccionado...</p>
                      ) : visibleLogEntries.length === 0 ? (
                        <p className="form-hint">
                          {logSnapshot && logSnapshot.entries.length > 0
                            ? "No hay lineas que coincidan con el filtro actual."
                            : "Todavia no hay salida capturada para este servicio."}
                        </p>
                      ) : (
                        visibleLogEntries.map((entry) => (
                          <article key={entry.sequence} className={`log-entry ${entry.level}`}>
                            <div className="log-entry-meta">
                              <span className={`log-stream-pill ${entry.stream}`}>{entry.stream}</span>
                              <span className={`log-level-pill ${entry.level}`}>{entry.level}</span>
                              <time>{formatLogTimestamp(entry.timestamp)}</time>
                            </div>
                            <pre>{entry.message}</pre>
                          </article>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <p className="form-hint">
                    Selecciona <code>Logs</code> en cualquier servicio para ver <code>stdout</code>,
                    <code>stderr</code>, filtrar el buffer y exportarlo manualmente.
                  </p>
                )}
              </div>
            </div>

            <div className="panel rail-panel">
              <div className="section-heading">
                <h3>Historial operativo</h3>
                <span>{focusedService ? executionEntries.length : "Sin foco"}</span>
              </div>
              {focusedService ? (
                <div className="service-execution-history">
                    <div className="handoff-head">
                      <div>
                        <strong>{focusedService.name}</strong>
                        <p className="form-hint">
                        Registro local de intentos <code>Run</code> y <code>Restart</code> del
                        servicio enfocado.
                        </p>
                      </div>
                    <span className={`status-pill ${focusedService.status}`}>{focusedService.status}</span>
                  </div>
                  {isLoadingExecutionHistory ? (
                    <p className="form-hint">Cargando historial del servicio seleccionado...</p>
                  ) : executionEntries.length === 0 ? (
                    <p className="form-hint">
                      Todavia no hay ejecuciones registradas para este servicio.
                    </p>
                  ) : (
                    <div className="service-execution-history-list">
                      {executionEntries.map((entry) => (
                        <article key={entry.id} className={`service-execution-card ${entry.status}`}>
                          <div className="service-execution-head">
                            <div>
                              <strong>{formatExecutionTrigger(entry.triggerAction)}</strong>
                              <p>{formatTimestamp(entry.startedAt ?? entry.stoppedAt ?? executionHistorySnapshot?.lastUpdatedAt ?? new Date().toISOString())}</p>
                            </div>
                            <span className={`status-pill ${normalizeExecutionStatus(entry.status)}`}>{entry.status}</span>
                          </div>
                          <div className="service-execution-meta">
                            <span>PID {entry.pid ?? "-"}</span>
                            <span>Puerto {entry.detectedPort ?? focusedService.expectedPort ?? "-"}</span>
                            <span>Duracion {entry.durationSeconds === null ? "-" : formatUptime(Math.max(0, Math.round(entry.durationSeconds)))}</span>
                          </div>
                          <p className="service-execution-signal">{entry.lastSignal}</p>
                          {entry.issue?.detail ? (
                            <p className="form-hint">{entry.issue.detail}</p>
                          ) : null}
                          {entry.commandLine ? (
                            <code className="service-execution-command">{entry.commandLine}</code>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="form-hint">
                  Selecciona <code>Logs</code> en cualquier servicio para revisar tambien su
                  historial de ejecuciones.
                </p>
              )}
            </div>
          </div>
        </section>
        )}
      </main>
    </div>
  );
}

function buildVisibleServices(
  services: ServiceRecord[],
  filters: {
    query: string;
    sortKey: SortKey;
    statusFilter: StatusFilter;
    typeFilter: string;
    tagFilter: string;
  },
): ServiceRecord[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const filtered = services.filter((service) => {
    if (filters.statusFilter !== "all" && service.status !== filters.statusFilter) {
      return false;
    }

    if (filters.typeFilter !== "all" && buildServiceTypeLabel(service) !== filters.typeFilter) {
      return false;
    }

    if (filters.tagFilter !== "all" && !service.tags.includes(filters.tagFilter)) {
      return false;
    }

    if (normalizedQuery) {
      const haystack = [
        service.name,
        service.path,
        buildServiceTypeLabel(service),
        service.tags.join(" "),
        service.source,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    }

    return true;
  });

  return [...filtered].sort((left, right) => {
    switch (filters.sortKey) {
      case "status":
        return compareNumbers(statusOrder[left.status], statusOrder[right.status]) ||
          left.name.localeCompare(right.name);
      case "port":
        return compareNumbers(
          left.detectedPort ?? left.expectedPort ?? Number.MAX_SAFE_INTEGER,
          right.detectedPort ?? right.expectedPort ?? Number.MAX_SAFE_INTEGER,
        ) || left.name.localeCompare(right.name);
      case "cpu":
        return compareNumbers(right.cpuPercent, left.cpuPercent) || left.name.localeCompare(right.name);
      case "ram":
        return compareNumbers(right.memoryBytes, left.memoryBytes) || left.name.localeCompare(right.name);
      case "startedAt":
        return compareNumbers(
          toSortableTimestamp(right.createdAt),
          toSortableTimestamp(left.createdAt),
        ) || left.name.localeCompare(right.name);
      case "uptime":
        return compareNumbers(right.uptimeSeconds, left.uptimeSeconds) || left.name.localeCompare(right.name);
      case "name":
      default:
        return left.name.localeCompare(right.name);
    }
  });
}

function buildServiceTypes(services: ServiceRecord[]) {
  return Array.from(new Set(services.map(buildServiceTypeLabel))).sort((left, right) => left.localeCompare(right));
}

function buildServiceTags(services: ServiceRecord[]) {
  return Array.from(new Set(services.flatMap((service) => service.tags))).sort((left, right) => left.localeCompare(right));
}

function buildServiceTypeLabel(service: ServiceRecord) {
  return `${service.frameworkType} / ${service.runtimeType}`;
}

function MetricCard(props: { label: string; value: string; accent: string }) {
  return (
    <article className={`metric-card ${props.accent}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function SummaryBadge(props: { label: string; value: string }) {
  return (
    <div className="summary-badge">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}


function formatBytes(value: number) {
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let currentValue = value;
  let unitIndex = 0;

  while (currentValue >= 1024 && unitIndex < units.length - 1) {
    currentValue /= 1024;
    unitIndex += 1;
  }

  return `${currentValue.toFixed(currentValue >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatGpuUsage(service: ServiceRecord) {
  if (service.gpuPercent === null && service.gpuMemoryBytes === null) {
    return "Not available";
  }

  if (service.gpuPercent !== null && service.gpuMemoryBytes !== null) {
    return `${service.gpuPercent.toFixed(0)}% / ${formatBytes(service.gpuMemoryBytes)}`;
  }

  if (service.gpuPercent !== null) {
    return `${service.gpuPercent.toFixed(0)}%`;
  }

  return formatBytes(service.gpuMemoryBytes ?? 0);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function formatLogTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function formatUptime(value: number) {
  if (value <= 0) {
    return "0s";
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatExecutionTrigger(value: string) {
  switch (value) {
    case "restart":
      return "Restart";
    case "run":
      return "Run";
    default:
      return value || "Run";
  }
}

function normalizeExecutionStatus(value: string): ServiceStatus {
  if (value === "running" || value === "starting" || value === "stopped" || value === "error") {
    return value;
  }

  return "error";
}

function compareNumbers(left: number, right: number) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function toSortableTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function parseTagsInput(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index);
}

function parseEnvInput(value: string) {
  const env: Record<string, string> = {};

  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim().toUpperCase();
    const envValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key || !envValue) {
      continue;
    }

    env[key] = envValue;
  }

  return env;
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("El navegador no pudo copiar el texto al portapapeles.");
  }
}
