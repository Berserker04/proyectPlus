import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  AppSettings,
  DashboardSnapshot,
  Microservice,
  MicroserviceDraft,
  Project,
  ServiceLogSnapshot,
  ServiceStatus,
} from "@/lib/domain/models";
import {
  clearServiceLogs,
  createMicroservice,
  createProject,
  deleteProject,
  deleteMicroservice,
  getServiceLogs,
  loadAppSettings,
  loadDashboardSnapshot,
  openDirectoryDialog,
  openServiceFolder,
  openServiceTerminal,
  restartService,
  runService,
  saveAppSettings,
  selectProject,
  stopService,
  updateMicroservice,
  updateProject,
  checkPortInUse,
  updateServiceOrder,
} from "@/lib/platform/desktop";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastMessage = {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
  detail?: string | null;
  exiting?: boolean;
};

type AppView = "services" | "logs" | "settings";

type ServiceFormState = {
  name: string;
  workingDirectory: string;
  startCommand: string;
  expectedPort: string;
};

const emptyServiceForm: ServiceFormState = {
  name: "",
  workingDirectory: "",
  startCommand: "",
  expectedPort: "",
};

const statusLabel: Record<ServiceStatus, string> = {
  running: "Activo",
  starting: "Iniciando",
  stopped: "Detenido",
  error: "Error",
  external: "Externo",
};

const statusColor: Record<ServiceStatus, string> = {
  running: "var(--status-running)",
  starting: "var(--status-starting)",
  stopped: "var(--status-stopped)",
  error: "var(--status-error)",
  external: "var(--status-external)",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const isDesktop = Boolean(window.__TAURI_INTERNALS__);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  // Core state
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({
    projects: [],
    services: [],
    system: { cpuTotalPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 0, lastRefreshAt: "" },
  });
  const [settings, setSettings] = useState<AppSettings>({
    dashboardRefreshSeconds: 2,
    realtimeRefreshSeconds: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((tone: ToastMessage["tone"], message: string, detail?: string | null) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2);
    setToasts((prev) => [...prev, { id, tone, message, detail }]);
    setTimeout(() => removeToast(id), 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300); // match CSS animation duration
  }, []);

  const [portWarning, setPortWarning] = useState<string | null>(null);

  // Drag and Drop State
  const [draggedServiceId, setDraggedServiceId] = useState<string | null>(null);

  // UI state
  const [view, setView] = useState<AppView>("services");
  const [focusedServiceId, setFocusedServiceId] = useState<string | null>(null);
  const [logSnapshot, setLogSnapshot] = useState<ServiceLogSnapshot | null>(null);
  const [isLogAutoscroll, setIsLogAutoscroll] = useState(true);
  const [logQuery, setLogQuery] = useState("");
  const deferredLogQuery = useDeferredValue(logQuery);
  const [logFilter, setLogFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [isPendingAction, setIsPendingAction] = useState(false);

  // Forms
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Microservice | null>(null);
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(emptyServiceForm);

  // Settings form
  const [settingsForm, setSettingsForm] = useState({ dashboardRefresh: "2", realtimeRefresh: "1" });

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const activeProject = useMemo(
    () => snapshot.projects.find((p) => p.isActive) ?? null,
    [snapshot.projects],
  );

  const focusedService = useMemo(
    () => snapshot.services.find((s) => s.id === focusedServiceId) ?? null,
    [focusedServiceId, snapshot.services],
  );

  const visibleLogEntries = useMemo(() => {
    const entries = logSnapshot?.entries ?? [];
    const q = deferredLogQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.message.toLowerCase().includes(q));
  }, [logSnapshot?.entries, deferredLogQuery]);

  const hasStarting = snapshot.services.some((s) => s.status === "starting");
  const refreshMs = Math.max(1, (hasStarting ? settings.realtimeRefreshSeconds : settings.dashboardRefreshSeconds)) * 1000;

  // Compute stats per project (for the sidebar)
  // To avoid heavy computation on each render, we do a basic reduction over services if needed.
  // Actually, `snapshot.services` only contains services for the ACTIVE project.
  // We don't have the status of services for inactive projects in this snapshot model.
  // So we can only show stats for the active project, or we'd need to change the rust backend to return all services.
  // For the MVP, we will show stats for the active project, and just the count for others if we had it.
  // Since `snapshot.services` is only for active project, we'll just show active project stats.

  const activeProjectStats = useMemo(() => {
    let running = 0;
    let errors = 0;
    for (const s of snapshot.services) {
      if (s.status === "running" || s.status === "starting" || s.status === "external") running++;
      if (s.status === "error") errors++;
    }
    return { total: snapshot.services.length, running, errors };
  }, [snapshot.services]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Initial load
  useEffect(() => {
    let ignore = false;
    void Promise.all([loadDashboardSnapshot(), loadAppSettings()])
      .then(([snap, cfg]) => {
        if (ignore) return;
        setSnapshot(snap);
        setSettings(cfg);
        setSettingsForm({
          dashboardRefresh: String(cfg.dashboardRefreshSeconds),
          realtimeRefresh: String(cfg.realtimeRefreshSeconds),
        });
      })
      .catch((e: unknown) => {
        if (!ignore) addToast("error", String(e));
      })
      .finally(() => { if (!ignore) setIsLoading(false); });
    return () => { ignore = true; };
  }, [addToast]);

  // Polling
  useEffect(() => {
    if (!isDesktop) return;
    let ignore = false;
    const id = window.setInterval(() => {
      void loadDashboardSnapshot()
        .then((snap) => { if (!ignore) setSnapshot(snap); })
        .catch(() => undefined);
    }, refreshMs);
    return () => { ignore = true; window.clearInterval(id); };
  }, [isDesktop, refreshMs]);

  // Auto-select first service
  useEffect(() => {
    if (snapshot.services.length === 0) { setFocusedServiceId(null); return; }
    if (!focusedServiceId || !snapshot.services.some((s) => s.id === focusedServiceId)) {
      setFocusedServiceId(snapshot.services[0]?.id ?? null);
    }
  }, [focusedServiceId, snapshot.services]);

  // Log refresh when on logs view
  const isLogsView = view === "logs";
  useEffect(() => {
    if (!focusedServiceId || !isLogsView) return;
    let ignore = false;
    void getServiceLogs(focusedServiceId).then((ls) => { if (!ignore) setLogSnapshot(ls); });
    const id = window.setInterval(() => {
      void getServiceLogs(focusedServiceId).then((ls) => { if (!ignore) setLogSnapshot(ls); });
    }, Math.max(1, settings.realtimeRefreshSeconds) * 1000);
    return () => { ignore = true; window.clearInterval(id); };
  }, [focusedServiceId, isLogsView, settings.realtimeRefreshSeconds]);

  // Autoscroll logs
  useEffect(() => {
    if (!isLogAutoscroll || !isLogsView || !logSnapshot) return;
    const vp = logViewportRef.current;
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [isLogAutoscroll, isLogsView, logSnapshot]);

  // ---------------------------------------------------------------------------
  // Actions — projects
  // ---------------------------------------------------------------------------

  async function handleSubmitProject(e: FormEvent) {
    e.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setIsPendingAction(true);
    try {
      const next = editingProject
        ? await updateProject(editingProject.id, { name })
        : await createProject({ name });
      setSnapshot(next);
      setShowProjectForm(false);
      setEditingProject(null);
      setProjectName("");
      addToast("success", editingProject ? "Proyecto actualizado." : "Proyecto creado.");
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setIsPendingAction(false);
    }
  }

  function openEditProject(proj: Project) {
    setEditingProject(proj);
    setProjectName(proj.name);
    setShowProjectForm(true);
  }

  async function handleDeleteProject(proj: Project) {
    if (!window.confirm(`¿Eliminar el proyecto "${proj.name}"? Se perderán todos sus microservicios.`)) return;
    setIsPendingAction(true);
    try {
      const next = await deleteProject(proj.id);
      setSnapshot(next);
      addToast("success", `Proyecto "${proj.name}" eliminado.`);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setIsPendingAction(false);
    }
  }

  async function handleSelectProject(proj: Project) {
    if (proj.isActive) return;
    setIsPendingAction(true);
    try {
      setSnapshot(await selectProject(proj.id));
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setIsPendingAction(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — microservices
  // ---------------------------------------------------------------------------

  const checkPortWarning = useCallback(async (portStr: string) => {
    const port = portStr ? parseInt(portStr, 10) : null;
    if (!port) {
      setPortWarning(null);
      return;
    }
    try {
      const inUse = await checkPortInUse(port);
      if (inUse) {
        setPortWarning(`El puerto ${port} ya está en uso. Podría haber conflictos.`);
      } else {
        setPortWarning(null);
      }
    } catch {
      setPortWarning(null);
    }
  }, []);

  async function handleSubmitService(e: FormEvent) {
    e.preventDefault();
    if (!activeProject) return;
    const draft: MicroserviceDraft = {
      projectId: activeProject.id,
      name: serviceForm.name.trim(),
      workingDirectory: serviceForm.workingDirectory.trim(),
      startCommand: serviceForm.startCommand.trim(),
      expectedPort: serviceForm.expectedPort.trim() ? Number(serviceForm.expectedPort.trim()) : null,
    };
    setIsPendingAction(true);
    try {
      const next = editingService
        ? await updateMicroservice(editingService.id, draft)
        : await createMicroservice(draft);
      setSnapshot(next);
      setShowServiceForm(false);
      setEditingService(null);
      setServiceForm(emptyServiceForm);
      setPortWarning(null);
      addToast("success", editingService ? "Microservicio actualizado." : "Microservicio agregado.");
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setIsPendingAction(false);
    }
  }

  function openEditService(svc: Microservice) {
    setEditingService(svc);
    setServiceForm({
      name: svc.name,
      workingDirectory: svc.workingDirectory,
      startCommand: svc.startCommand,
      expectedPort: svc.expectedPort != null ? String(svc.expectedPort) : "",
    });
    setShowServiceForm(true);
  }

  async function handleDeleteService(svc: Microservice) {
    if (!window.confirm(`¿Eliminar "${svc.name}"?`)) return;
    setIsPendingAction(true);
    try {
      setSnapshot(await deleteMicroservice(svc.id));
      addToast("success", `"${svc.name}" eliminado.`);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setIsPendingAction(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag and drop reordering
  // ---------------------------------------------------------------------------

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedServiceId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    if (!draggedServiceId || draggedServiceId === targetId || !activeProject) {
      setDraggedServiceId(null);
      return;
    }

    // Clone services
    const newServices = [...snapshot.services];
    const draggedIndex = newServices.findIndex(s => s.id === draggedServiceId);
    const targetIndex = newServices.findIndex(s => s.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedServiceId(null);
      return;
    }

    // Reorder local array immediately
    const [draggedItem] = newServices.splice(draggedIndex, 1);
    newServices.splice(targetIndex, 0, draggedItem);
    
    // Update snapshot optimistically
    setSnapshot(prev => ({ ...prev, services: newServices }));
    setDraggedServiceId(null);

    // Persist new order
    try {
      const orderIds = newServices.map(s => s.id);
      const nextSnapshot = await updateServiceOrder(activeProject.id, orderIds);
      setSnapshot(nextSnapshot);
    } catch (err) {
      addToast("error", "Error al guardar el orden", String(err));
      // Optionally reload the snapshot to reset order
      loadDashboardSnapshot().then(setSnapshot).catch(console.error);
    }
  };

  const handleMoveService = async (svcId: string, direction: -1 | 1) => {
    if (!activeProject) return;
    const newServices = [...snapshot.services];
    const currentIndex = newServices.findIndex(s => s.id === svcId);
    if (currentIndex === -1) return;
    
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= newServices.length) return; // Cant move further

    // Swap elements
    const temp = newServices[currentIndex];
    newServices[currentIndex] = newServices[targetIndex];
    newServices[targetIndex] = temp;

    setSnapshot(prev => ({ ...prev, services: newServices }));

    // Persist
    try {
      const orderIds = newServices.map(s => s.id);
      const nextSnapshot = await updateServiceOrder(activeProject.id, orderIds);
      setSnapshot(nextSnapshot);
    } catch (err) {
      addToast("error", "Error al guardar el orden", String(err));
      loadDashboardSnapshot().then(setSnapshot).catch(console.error);
    }
  };

  const handleRunService = useCallback(async (svc: Microservice) => {
    if (svc.expectedPort) {
      const inUse = await checkPortInUse(svc.expectedPort).catch(() => false);
      if (inUse) {
        addToast("error", `El puerto ${svc.expectedPort} ya está en uso.`, "El servicio podría fallar al iniciar.");
      }
    }
    
    addToast("info", `Iniciando ${svc.name}…`);
    try {
      const resp = await runService(svc.id);
      setSnapshot(resp.snapshot);
      if (resp.issue) {
        addToast("error", resp.issue.message, resp.issue.detail);
      } else {
        addToast("success", `${svc.name} en supervisión.`);
      }
    } catch (err) {
      addToast("error", String(err));
    }
  }, [addToast]);

  const handleStopService = useCallback(async (svc: Microservice) => {
    addToast("info", `Deteniendo ${svc.name}…`);
    try {
      const resp = await stopService(svc.id);
      setSnapshot(resp.snapshot);
      addToast("success", `${svc.name} detenido.`);
    } catch (err) {
      addToast("error", String(err));
    }
  }, [addToast]);

  const handleRestartService = useCallback(async (svc: Microservice) => {
    addToast("info", `Reiniciando ${svc.name}…`);
    try {
      const resp = await restartService(svc.id);
      setSnapshot(resp.snapshot);
      addToast("info", `${svc.name} reiniciándose.`);
    } catch (err) {
      addToast("error", String(err));
    }
  }, [addToast]);

  const handleClearLogs = useCallback(async () => {
    if (!focusedServiceId) return;
    const ls = await clearServiceLogs(focusedServiceId);
    setLogSnapshot(ls);
  }, [focusedServiceId]);

  const handleCopyLogs = useCallback(() => {
    if (!logSnapshot) return;
    const text = logSnapshot.entries.map(e => `[${e.timestamp.slice(11, 23)}] [${e.stream}] ${e.message}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      addToast("success", "Logs copiados al portapapeles.");
    }).catch(err => {
      addToast("error", "Error al copiar logs.", String(err));
    });
  }, [logSnapshot, addToast]);

  const handleRunAll = useCallback(async () => {
    const stoppable = snapshot.services.filter(s => s.status === "stopped" || s.status === "error");
    if (stoppable.length === 0) {
      addToast("info", "No hay servicios detenidos para iniciar.");
      return;
    }
    addToast("info", `Iniciando ${stoppable.length} servicios...`);
    for (const svc of stoppable) {
      try {
        const resp = await runService(svc.id);
        setSnapshot(resp.snapshot);
      } catch (err) {
        addToast("error", `Error iniciando ${svc.name}`, String(err));
      }
    }
    addToast("success", "Secuencia de inicio completada.");
  }, [snapshot.services, addToast]);

  const handleStopAll = useCallback(async () => {
    const running = snapshot.services.filter(s => s.status === "running" || s.status === "starting");
    if (running.length === 0) {
      addToast("info", "No hay servicios activos para detener.");
      return;
    }
    addToast("info", `Deteniendo ${running.length} servicios...`);
    for (const svc of running) {
      try {
        const resp = await stopService(svc.id);
        setSnapshot(resp.snapshot);
      } catch (err) {
        addToast("error", `Error deteniendo ${svc.name}`, String(err));
      }
    }
    addToast("success", "Secuencia de detención completada.");
  }, [snapshot.services, addToast]);

  // ---------------------------------------------------------------------------
  // Actions — settings
  // ---------------------------------------------------------------------------

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    const next: AppSettings = {
      dashboardRefreshSeconds: Math.max(1, Number(settingsForm.dashboardRefresh)),
      realtimeRefreshSeconds: Math.max(1, Number(settingsForm.realtimeRefresh)),
    };
    try {
      const saved = await saveAppSettings(next);
      setSettings(saved);
      addToast("success", "Ajustes guardados.");
    } catch (err) {
      addToast("error", String(err));
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Cargando…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* ── LEFT PANEL: Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/logo.png" alt="ProyectsPlus" className="sidebar-logo" />
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          <button className={`nav-btn${view === "services" ? " active" : ""}`} onClick={() => setView("services")}>
            <span className="nav-icon">⚙</span> Servicios
          </button>
          <button className={`nav-btn${view === "logs" ? " active" : ""}`} onClick={() => setView("logs")}>
            <span className="nav-icon">📄</span> Logs
          </button>
          <button className={`nav-btn${view === "settings" ? " active" : ""}`} onClick={() => setView("settings")}>
            <span className="nav-icon">🔧</span> Ajustes
          </button>
        </nav>

        {/* Projects */}
        <div className="sidebar-section-label">Proyectos</div>
        <div className="project-list">
          {snapshot.projects.map((proj) => (
            <div
              key={proj.id}
              className={`project-item${proj.isActive ? " active" : ""}`}
            >
              <button
                className="project-name-btn"
                onClick={() => void handleSelectProject(proj)}
                title={proj.name}
              >
                {proj.name}
              </button>
              {proj.isActive && activeProjectStats.total > 0 && (
                <div className="project-stats" title={`${activeProjectStats.running} activos, ${activeProjectStats.errors} errores, ${activeProjectStats.total} total`}>
                  {activeProjectStats.errors > 0 && <span className="project-stat-dot" style={{ background: statusColor.error }} />}
                  {activeProjectStats.running > 0 && activeProjectStats.errors === 0 && <span className="project-stat-dot" style={{ background: statusColor.running }} />}
                  <span className="project-stat-count">{activeProjectStats.total}</span>
                </div>
              )}
              <div className="project-actions">
                <button className="icon-btn" title="Editar" onClick={() => openEditProject(proj)}>✏</button>
                <button className="icon-btn danger" title="Eliminar" onClick={() => void handleDeleteProject(proj)}>✕</button>
              </div>
            </div>
          ))}
        </div>

        <button
          className="btn-outline sidebar-new-project"
          onClick={() => { setEditingProject(null); setProjectName(""); setShowProjectForm(true); }}
          disabled={isPendingAction}
        >
          + Nuevo proyecto
        </button>

        {/* System metrics footer */}
        <div className="sidebar-footer">
          <div className="metric-row">
            <span>CPU</span>
            <span className="metric-value">{formatPercent(snapshot.system.cpuTotalPercent)}</span>
          </div>
          <div className="metric-row">
            <span>RAM</span>
            <span className="metric-value">
              {formatBytes(snapshot.system.memoryUsedBytes)} / {formatBytes(snapshot.system.memoryTotalBytes)}
            </span>
          </div>
        </div>
      </aside>

      {/* ── MAIN PANEL ── */}
      <main className="main-panel">
        {/* Toasts */}
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone} ${toast.exiting ? "toast-exiting" : ""}`}>
              <div className="toast-content">
                <span className="toast-message">{toast.message}</span>
                {toast.detail && <span className="toast-detail">{toast.detail}</span>}
              </div>
              <button className="toast-close" onClick={() => removeToast(toast.id)}>✕</button>
            </div>
          ))}
        </div>

        {/* ── SERVICES VIEW ── */}
        {view === "services" && (
          <div className="view-services">
            <div className="view-header">
              <div>
                <h1 className="view-title">
                  {activeProject ? activeProject.name : "Sin proyecto activo"}
                </h1>
                <p className="view-subtitle">
                  {activeProject
                    ? `${snapshot.services.length} microservicio(s) registrado(s)`
                    : "Crea o selecciona un proyecto en la barra lateral."}
                </p>
                {activeProject && snapshot.services.length > 0 && (
                  <div className="bulk-actions">
                    <button className="btn-outline" onClick={handleRunAll} disabled={isPendingAction} title="Iniciar todos los servicios detenidos">
                      ▶ Iniciar todos
                    </button>
                    <button className="btn-outline" onClick={handleStopAll} disabled={isPendingAction} title="Detener todos los servicios activos">
                      ⏹ Detener todos
                    </button>
                  </div>
                )}
              </div>
              {activeProject && (
                <button
                  className="btn-primary"
                  onClick={() => { setEditingService(null); setServiceForm(emptyServiceForm); setShowServiceForm(true); }}
                  disabled={isPendingAction}
                >
                  + Agregar microservicio
                </button>
              )}
            </div>

            {/* Service cards */}
            <div className="service-list">
              {snapshot.services.length === 0 && activeProject && (
                <div className="empty-state">
                  <p>No hay microservicios en este proyecto.</p>
                  <p>Haz clic en <strong>+ Agregar microservicio</strong> para empezar.</p>
                </div>
              )}
              {snapshot.services.map((svc) => (
                <ServiceCard
                  key={svc.id}
                  svc={svc}
                  isFocused={svc.id === focusedServiceId}
                  onFocus={() => setFocusedServiceId(svc.id)}
                  onRun={() => void handleRunService(svc)}
                  onStop={() => void handleStopService(svc)}
                  onRestart={() => void handleRestartService(svc)}
                  onEdit={() => openEditService(svc)}
                  onDelete={() => void handleDeleteService(svc)}
                  onLogs={() => { setFocusedServiceId(svc.id); setView("logs"); }}
                  onFolder={() => void openServiceFolder(svc.id).catch((e: unknown) => addToast("error", String(e)))}
                  onTerminal={() => void openServiceTerminal(svc.id).catch((e: unknown) => addToast("error", String(e)))}
                  onMoveUp={() => void handleMoveService(svc.id, -1)}
                  onMoveDown={() => void handleMoveService(svc.id, 1)}
                  isDragged={svc.id === draggedServiceId}
                  onDragStart={(e) => handleDragStart(e, svc.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, svc.id)}
                  onDragEnd={() => setDraggedServiceId(null)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── LOGS VIEW ── */}
        {view === "logs" && (
          <div className="view-logs">
            <div className="view-header">
              <div>
                <h1 className="view-title">Logs</h1>
                <p className="view-subtitle">{focusedService?.name ?? "Ningún servicio seleccionado"}</p>
              </div>
              <div className="logs-toolbar">
                <input
                  className="search-input"
                  placeholder="Buscar…"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                />

                <div className="log-service-tabs" style={{ padding: 0, border: 'none' }}>
                  <button
                    className={`log-tab ${logFilter === "all" ? "active" : ""}`}
                    onClick={() => setLogFilter("all")}
                  >Todo</button>
                  <button
                    className={`log-tab ${logFilter === "stdout" ? "active" : ""}`}
                    onClick={() => setLogFilter("stdout")}
                  >Stdout</button>
                  <button
                    className={`log-tab ${logFilter === "stderr" ? "active" : ""}`}
                    onClick={() => setLogFilter("stderr")}
                  >Stderr</button>
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                  <button className="btn-outline" onClick={() => setIsLogAutoscroll((p) => !p)}>
                    {isLogAutoscroll ? "⏸ Pausar" : "▶ Reanudar"}
                  </button>
                  <button className="btn-outline" onClick={handleCopyLogs} title="Copiar al portapapeles">
                    📄 Copiar
                  </button>
                  <button className="btn-outline danger" onClick={() => void handleClearLogs()}>
                    Limpiar
                  </button>
                </div>
              </div>
            </div>

            {/* Service picker */}
            {snapshot.services.length > 0 && (
              <div className="log-service-tabs">
                {snapshot.services.map((s) => (
                  <button
                    key={s.id}
                    className={`log-tab${s.id === focusedServiceId ? " active" : ""}`}
                    onClick={() => setFocusedServiceId(s.id)}
                  >
                    <span className="status-dot" style={{ background: statusColor[s.status] }} />
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            <div className="log-viewport" ref={logViewportRef}>
              {visibleLogEntries.length === 0 && (
                <div className="log-empty">No hay entradas de log.</div>
              )}
              {visibleLogEntries
                .filter(e => logFilter === "all" || e.stream === logFilter)
                .map((entry) => {
                  // Extract basic http URLs
                  const formattedMessage = entry.message.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent); text-decoration:underline;">$1</a>');
                  return (
                    <div key={entry.sequence} className={`log-entry log-${entry.level}`}>
                      <span className="log-ts">{entry.timestamp.slice(11, 23)}</span>
                      <span className={`log-stream log-stream-${entry.stream}`}>{entry.stream}</span>
                      <span className="log-msg" dangerouslySetInnerHTML={{ __html: formattedMessage }} />
                    </div>
                  );
                })
              }
            </div>
          </div>
        )}

        {/* ── SETTINGS VIEW ── */}
        {view === "settings" && (
          <div className="view-settings">
            <div className="view-header">
              <h1 className="view-title">Ajustes</h1>
            </div>
            <form className="settings-form" onSubmit={(e) => void handleSaveSettings(e)}>
              <div className="field-group">
                <label className="field-label">Refresco del dashboard (segundos)</label>
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  max={60}
                  value={settingsForm.dashboardRefresh}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, dashboardRefresh: e.target.value }))}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Refresco en tiempo real (segundos)</label>
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  max={60}
                  value={settingsForm.realtimeRefresh}
                  onChange={(e) => setSettingsForm((p) => ({ ...p, realtimeRefresh: e.target.value }))}
                />
              </div>
              <button className="btn-primary" type="submit">Guardar ajustes</button>
            </form>
          </div>
        )}
      </main>

      {/* ── MODALS ── */}

      {/* Project form */}
      {showProjectForm && (
        <Modal title={editingProject ? "Editar proyecto" : "Nuevo proyecto"} onClose={() => setShowProjectForm(false)}>
          <form onSubmit={(e) => void handleSubmitProject(e)}>
            <div className="field-group">
              <label className="field-label">Nombre del proyecto</label>
              <input
                autoFocus
                className="field-input"
                placeholder="Mi proyecto"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-outline" onClick={() => setShowProjectForm(false)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={isPendingAction}>
                {editingProject ? "Guardar cambios" : "Crear proyecto"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Service form */}
      {showServiceForm && activeProject && (
        <Modal
          title={editingService ? `Editar: ${editingService.name}` : "Agregar microservicio"}
          onClose={() => { setShowServiceForm(false); setEditingService(null); setServiceForm(emptyServiceForm); }}
        >
          <form onSubmit={(e) => void handleSubmitService(e)}>
            <div className="field-group">
              <label className="field-label">Nombre</label>
              <input
                autoFocus
                className="field-input"
                placeholder="api-gateway"
                value={serviceForm.name}
                onChange={(e) => setServiceForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">Directorio de trabajo</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="field-input"
                  style={{ flex: 1 }}
                  placeholder="C:\proyectos\api-gateway"
                  value={serviceForm.workingDirectory}
                  onChange={(e) => setServiceForm((p) => ({ ...p, workingDirectory: e.target.value }))}
                  required
                />
                <button
                  type="button"
                  className="btn-outline"
                  onClick={async () => {
                    try {
                      const dir = await openDirectoryDialog();
                      if (dir != null) {
                        setServiceForm((p) => ({ ...p, workingDirectory: dir }));
                      }
                    } catch (err) {
                      addToast("error", String(err));
                    }
                  }}
                  title="Seleccionar carpeta"
                >
                  📁 Examinar...
                </button>
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Comando de inicio</label>
              <input
                className="field-input"
                placeholder="npm run start"
                value={serviceForm.startCommand}
                onChange={(e) => setServiceForm((p) => ({ ...p, startCommand: e.target.value }))}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">Puerto esperado (opcional)</label>
              <input
                className="field-input"
                type="number"
                placeholder="3000"
                value={serviceForm.expectedPort}
                onChange={(e) => setServiceForm((p) => ({ ...p, expectedPort: e.target.value }))}
                onBlur={(e) => void checkPortWarning(e.target.value)}
              />
              {portWarning && (
                <span style={{ color: "var(--warning)", fontSize: "11px", marginTop: "2px" }}>
                  ⚠️ {portWarning}
                </span>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => { setShowServiceForm(false); setEditingService(null); setServiceForm(emptyServiceForm); }}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={isPendingAction}>
                {editingService ? "Guardar cambios" : "Agregar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service Card
// ---------------------------------------------------------------------------

interface ServiceCardProps {
  svc: Microservice;
  isFocused: boolean;
  onFocus: () => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLogs: () => void;
  onFolder: () => void;
  onTerminal: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  // Drag and drop props
  isDragged?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

function ServiceCard({
  svc, isFocused, onFocus, onRun, onStop, onRestart, 
  onEdit, onDelete, onLogs, onFolder, onTerminal,
  onMoveUp, onMoveDown,
  isDragged, onDragStart, onDragOver, onDrop, onDragEnd
}: ServiceCardProps) {
  const isRunning = svc.status === "running";
  const isExternal = svc.status === "external";
  const isStopped = svc.status === "stopped" || svc.status === "error";

  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div 
      className={`service-card${isFocused ? " focused" : ""}${isDragged ? " dragged" : ""}${isDragOver ? " drag-over" : ""}`} 
      onClick={onFocus}
      draggable
      onDragStart={onDragStart}
      onDragEnter={(e) => {
        e.preventDefault();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
        if (onDragOver) onDragOver(e);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (onDrop) onDrop(e);
      }}
      onDragEnd={onDragEnd}
    >
      {/* Header */}
      <div className="sc-header">
        <div className="sc-name-row">
          <span className="status-dot" style={{ background: statusColor[svc.status] }} />
          <span className="sc-name">{svc.name}</span>
          <span className={`sc-status-badge sc-status-${svc.status}`}>{statusLabel[svc.status]}</span>
        </div>
        <div className="sc-meta">
          {svc.pid && <span className="sc-chip">PID {svc.pid}</span>}
          {(svc.detectedPort ?? svc.expectedPort) && (
            <span className="sc-chip">:{svc.detectedPort ?? svc.expectedPort}</span>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="sc-metrics">
        <div className="sc-metric">
          <span className="metric-label">CPU</span>
          <span className="metric-value">{formatPercent(svc.cpuPercent)}</span>
        </div>
        <div className="sc-metric">
          <span className="metric-label">RAM</span>
          <span className="metric-value">{formatBytes(svc.memoryBytes)}</span>
        </div>
        <div className="sc-metric sc-metric-wide">
          <span className="metric-label">Directorio</span>
          <span className="metric-value metric-path" title={svc.workingDirectory}>
            {svc.workingDirectory.split(/[\\/]/).pop() ?? svc.workingDirectory}
          </span>
        </div>
      </div>

      {svc.issue && (
        <div className="sc-issue">⚠ {svc.issue.title}: {svc.issue.message}</div>
      )}

      {isExternal && (
        <div className="sc-external-notice">
          🔌 Proceso externo detectado en el puerto {svc.detectedPort}. Iniciado fuera de la app.
        </div>
      )}

      {/* Actions */}
      <div className="sc-actions">
        <div className="sc-actions-runtime">
          <button className="btn-icon-run" title="Correr" disabled={isRunning || isExternal} onClick={(e) => { e.stopPropagation(); onRun(); }}>▶</button>
          <button className="btn-icon-stop" title="Detener" disabled={isStopped || isExternal} onClick={(e) => { e.stopPropagation(); onStop(); }}>■</button>
          <button className="btn-icon-restart" title="Reiniciar" disabled={isExternal} onClick={(e) => { e.stopPropagation(); onRestart(); }}>↺</button>
        </div>
        <div className="sc-actions-util">
          <button className="icon-btn" title="Subir orden" onClick={(e) => { e.stopPropagation(); onMoveUp(); }}>↑</button>
          <button className="icon-btn" title="Bajar orden" onClick={(e) => { e.stopPropagation(); onMoveDown(); }}>↓</button>
          <button className="icon-btn" title="Logs" onClick={(e) => { e.stopPropagation(); onLogs(); }}>📄</button>
          <button className="icon-btn" title="Abrir carpeta" onClick={(e) => { e.stopPropagation(); onFolder(); }}>📂</button>
          <button className="icon-btn" title="Abrir terminal" onClick={(e) => { e.stopPropagation(); onTerminal(); }}>💻</button>
          <button className="icon-btn" title="Editar" onClick={(e) => { e.stopPropagation(); onEdit(); }}>✏</button>
          <button className="icon-btn danger" title="Eliminar" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
