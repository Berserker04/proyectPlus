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
  Project,
  ServiceLogSnapshot,
} from "@/lib/domain/models";
import {
  checkPortInUse,
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
  updateServiceOrder,
  listenDashboardUpdates,
  listenServiceLogLine,
  type UnlistenFn,
} from "@/lib/platform/desktop";

// Components
import { ToastContainer, type ToastMessage } from "@/components/ToastContainer";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { ServicesView } from "@/components/ServicesView";
import { LogsView } from "@/components/LogsView";
import { SettingsView } from "@/components/SettingsView";
import { ProjectForm } from "@/components/ProjectForm";
import { ServiceForm, emptyServiceForm, type ServiceFormState } from "@/components/ServiceForm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppView = "services" | "logs" | "settings";

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
    }, 300);
  }, []);

  const [portWarning, setPortWarning] = useState<string | null>(null);

  // Drag and drop state
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

  const visibleLogEntries = useMemo(() => {
    const entries = logSnapshot?.entries ?? [];
    const q = deferredLogQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.message.toLowerCase().includes(q));
  }, [logSnapshot?.entries, deferredLogQuery]);

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
      .catch((e: unknown) => { if (!ignore) addToast("error", String(e)); })
      .finally(() => { if (!ignore) setIsLoading(false); });
    return () => { ignore = true; };
  }, [addToast]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: UnlistenFn | undefined;
    listenDashboardUpdates((snap) => {
      setSnapshot(snap);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isDesktop]);

  useEffect(() => {
    if (snapshot.services.length === 0) { setFocusedServiceId(null); return; }
    if (!focusedServiceId || !snapshot.services.some((s) => s.id === focusedServiceId)) {
      setFocusedServiceId(snapshot.services[0]?.id ?? null);
    }
  }, [focusedServiceId, snapshot.services]);

  const isLogsView = view === "logs";
  useEffect(() => {
    if (!focusedServiceId || !isLogsView || !isDesktop) return;

    // Carga inicial del historial de logs
    void getServiceLogs(focusedServiceId).then((ls) => {
      setLogSnapshot(ls);
    });

    // Escuchar nuevas líneas en tiempo real
    let unlisten: UnlistenFn | undefined;
    listenServiceLogLine((payload) => {
      if (payload.serviceId === focusedServiceId) {
        setLogSnapshot((prev) => {
          if (!prev || prev.serviceId !== payload.serviceId) return prev;
          // Mantener sincronía con el límite del backend (2000 entradas)
          const newEntries = [...prev.entries, payload.entry];
          return {
            ...prev,
            entries: newEntries.slice(-2000),
          };
        });
      }
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [focusedServiceId, isLogsView, isDesktop]);

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
    if (!port) { setPortWarning(null); return; }
    try {
      const inUse = await checkPortInUse(port);
      setPortWarning(inUse ? `El puerto ${port} ya está en uso. Podría haber conflictos.` : null);
    } catch {
      setPortWarning(null);
    }
  }, []);

  async function handleSubmitService(e: FormEvent) {
    e.preventDefault();
    if (!activeProject) return;
    const draft = {
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
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    if (!draggedServiceId || draggedServiceId === targetId || !activeProject) {
      setDraggedServiceId(null);
      return;
    }
    const newServices = [...snapshot.services];
    const draggedIndex = newServices.findIndex((s) => s.id === draggedServiceId);
    const targetIndex = newServices.findIndex((s) => s.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) { setDraggedServiceId(null); return; }
    const [draggedItem] = newServices.splice(draggedIndex, 1);
    newServices.splice(targetIndex, 0, draggedItem);
    setSnapshot((prev) => ({ ...prev, services: newServices }));
    setDraggedServiceId(null);
    try {
      const orderIds = newServices.map((s) => s.id);
      const nextSnapshot = await updateServiceOrder(activeProject.id, orderIds);
      setSnapshot(nextSnapshot);
    } catch (err) {
      addToast("error", "Error al guardar el orden", String(err));
      loadDashboardSnapshot().then(setSnapshot).catch(console.error);
    }
  };

  const handleMoveService = async (svcId: string, direction: -1 | 1) => {
    if (!activeProject) return;
    const newServices = [...snapshot.services];
    const currentIndex = newServices.findIndex((s) => s.id === svcId);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= newServices.length) return;
    const temp = newServices[currentIndex];
    newServices[currentIndex] = newServices[targetIndex];
    newServices[targetIndex] = temp;
    setSnapshot((prev) => ({ ...prev, services: newServices }));
    try {
      const orderIds = newServices.map((s) => s.id);
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
      if (inUse) addToast("error", `El puerto ${svc.expectedPort} ya está en uso.`, "El servicio podría fallar al iniciar.");
    }
    addToast("info", `Iniciando ${svc.name}…`);
    try {
      const resp = await runService(svc.id);
      setSnapshot(resp.snapshot);
      if (resp.issue) addToast("error", resp.issue.message, resp.issue.detail);
      else addToast("success", `${svc.name} en supervisión.`);
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
    const text = logSnapshot.entries.map((e) => `[${e.timestamp.slice(11, 23)}] [${e.stream}] ${e.message}`).join("\n");
    navigator.clipboard.writeText(text)
      .then(() => addToast("success", "Logs copiados al portapapeles."))
      .catch((err) => addToast("error", "Error al copiar logs.", String(err)));
  }, [logSnapshot, addToast]);

  const handleRunAll = useCallback(async () => {
    const stoppable = snapshot.services.filter((s) => s.status === "stopped" || s.status === "error");
    if (stoppable.length === 0) { addToast("info", "No hay servicios detenidos para iniciar."); return; }
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
    const running = snapshot.services.filter((s) => s.status === "running" || s.status === "starting");
    if (running.length === 0) { addToast("info", "No hay servicios activos para detener."); return; }
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
      <ProjectSidebar
        projects={snapshot.projects}
        system={snapshot.system}
        activeProjectStats={activeProjectStats}
        isPendingAction={isPendingAction}
        currentView={view}
        onViewChange={setView}
        onSelectProject={(proj) => void handleSelectProject(proj)}
        onEditProject={openEditProject}
        onDeleteProject={(proj) => void handleDeleteProject(proj)}
        onNewProject={() => { setEditingProject(null); setProjectName(""); setShowProjectForm(true); }}
      />

      <main className="main-panel">
        <ToastContainer toasts={toasts} onRemove={removeToast} />

        {view === "services" && (
          <ServicesView
            services={snapshot.services}
            activeProject={activeProject}
            isPendingAction={isPendingAction}
            focusedServiceId={focusedServiceId}
            draggedServiceId={draggedServiceId}
            onFocusService={setFocusedServiceId}
            onRun={(svc) => void handleRunService(svc)}
            onStop={(svc) => void handleStopService(svc)}
            onRestart={(svc) => void handleRestartService(svc)}
            onEdit={openEditService}
            onDelete={(svc) => void handleDeleteService(svc)}
            onLogs={(svc) => { setFocusedServiceId(svc.id); setView("logs"); }}
            onFolder={(svc) => void openServiceFolder(svc.id).catch((e: unknown) => addToast("error", String(e)))}
            onTerminal={(svc) => void openServiceTerminal(svc.id).catch((e: unknown) => addToast("error", String(e)))}
            onMoveUp={(id) => void handleMoveService(id, -1)}
            onMoveDown={(id) => void handleMoveService(id, 1)}
            onRunAll={() => void handleRunAll()}
            onStopAll={() => void handleStopAll()}
            onAddService={() => { setEditingService(null); setServiceForm(emptyServiceForm); setShowServiceForm(true); }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={(e, id) => void handleDrop(e, id)}
            onDragEnd={() => setDraggedServiceId(null)}
          />
        )}

        {view === "logs" && (
          <LogsView
            services={snapshot.services}
            focusedServiceId={focusedServiceId}
            logSnapshot={logSnapshot}
            logFilter={logFilter}
            logQuery={logQuery}
            isLogAutoscroll={isLogAutoscroll}
            visibleLogEntries={visibleLogEntries}
            onFocusService={setFocusedServiceId}
            onFilterChange={setLogFilter}
            onQueryChange={setLogQuery}
            onToggleAutoscroll={() => setIsLogAutoscroll((p) => !p)}
            onCopyLogs={handleCopyLogs}
            onClearLogs={() => void handleClearLogs()}
            logViewportRef={logViewportRef}
          />
        )}

        {view === "settings" && (
          <SettingsView
            settingsForm={settingsForm}
            onChangeField={(field, value) => setSettingsForm((p) => ({ ...p, [field]: value }))}
            onSubmit={(e) => void handleSaveSettings(e)}
          />
        )}
      </main>

      {/* Modals */}
      {showProjectForm && (
        <ProjectForm
          editingProject={editingProject}
          projectName={projectName}
          isPendingAction={isPendingAction}
          onChangeName={setProjectName}
          onSubmit={(e) => void handleSubmitProject(e)}
          onClose={() => { setShowProjectForm(false); setEditingProject(null); setProjectName(""); }}
        />
      )}

      {showServiceForm && activeProject && (
        <ServiceForm
          editingService={editingService}
          serviceForm={serviceForm}
          portWarning={portWarning}
          isPendingAction={isPendingAction}
          onChangeField={(field, value) => setServiceForm((p) => ({ ...p, [field]: value }))}
          onPortBlur={(port) => void checkPortWarning(port)}
          onBrowseDirectory={async () => {
            try {
              const dir = await openDirectoryDialog();
              if (dir != null) setServiceForm((p) => ({ ...p, workingDirectory: dir }));
            } catch (err) {
              addToast("error", String(err));
            }
          }}
          onSubmit={(e) => void handleSubmitService(e)}
          onClose={() => { setShowServiceForm(false); setEditingService(null); setServiceForm(emptyServiceForm); }}
        />
      )}
    </div>
  );
}
