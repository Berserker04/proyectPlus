import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { applyNodeChanges, type Connection, type Edge, type Node, type NodeChange } from "@xyflow/react";
import type {
  AppSettings,
  DashboardSnapshot,
  Microservice,
  Project,
  ProjectTopology,
  ServiceLogSnapshot,
  ServiceNodeLayout,
} from "@/lib/domain/models";
import {
  checkPortInUse,
  clearServiceLogs,
  createMicroservice,
  createProject,
  deleteMicroservice,
  deleteProject,
  getProjectTopology,
  getServiceLogs,
  listenDashboardUpdates,
  listenServiceLogLine,
  loadAppSettings,
  loadDashboardSnapshot,
  openDirectoryDialog,
  openServiceFolder,
  openServiceTerminal,
  restartService,
  runService,
  saveAppSettings,
  saveProjectTopology,
  selectProject,
  stopService,
  updateMicroservice,
  updateProject,
  type UnlistenFn,
} from "@/lib/platform/desktop";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { ProjectForm } from "@/components/ProjectForm";
import { ServiceForm, emptyServiceForm, type ServiceFormState } from "@/components/ServiceForm";
import { SettingsView } from "@/components/SettingsView";
import { ToastContainer, type ToastMessage } from "@/components/ToastContainer";
import { ServiceGraphView } from "@/components/ServiceGraphView";
import { ServiceInspector } from "@/components/ServiceInspector";
import type { ServiceFlowEdgeData } from "@/components/ServiceFlowEdge";
import type { ServiceGraphNodeData } from "@/components/ServiceGraphNode";
import { Modal } from "@/components/Modal";
import { buildPressureTelemetry } from "@/lib/ui/serviceGraph";

type AppView = "graph" | "settings";
type InspectorTab = "logs" | "events" | "k6" | "alerts";

const DEFAULT_NODE_WIDTH = 330;
const DEFAULT_NODE_HEIGHT = 216;
const DEFAULT_INSPECTOR_WIDTH = 392;
const MIN_INSPECTOR_WIDTH = 320;
const MIN_GRAPH_WIDTH = 420;
const INSPECTOR_WIDTH_STORAGE_KEY = "mscc.inspector.width";

function clampInspectorWidth(width: number, containerWidth: number) {
  const maxWidth = Math.max(MIN_INSPECTOR_WIDTH, containerWidth - MIN_GRAPH_WIDTH);
  return Math.min(Math.max(width, MIN_INSPECTOR_WIDTH), maxWidth);
}

function emptySnapshot(): DashboardSnapshot {
  return {
    projects: [],
    services: [],
    system: { cpuTotalPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 0, lastRefreshAt: "" },
  };
}

function emptyTopology(projectId: string | null): ProjectTopology | null {
  if (!projectId) return null;
  return {
    projectId,
    nodeLayouts: {},
    edges: [],
    updatedAt: new Date().toISOString(),
  };
}

function buildDefaultLayout(index: number): ServiceNodeLayout {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 64 + column * 380,
    y: 72 + row * 290,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT,
    collapsed: false,
  };
}

function buildGraphNode(args: {
  service: Microservice;
  layout: ServiceNodeLayout;
  selected: boolean;
  previous?: Node<ServiceGraphNodeData>;
  onFocus: (serviceId: string) => void;
  onRun: (service: Microservice) => void;
  onStop: (service: Microservice) => void;
  onRestart: (service: Microservice) => void;
}): Node<ServiceGraphNodeData> {
  const { service, layout, selected, previous, onFocus, onRun, onStop, onRestart } = args;

  return {
    ...previous,
    id: service.id,
    type: "serviceNode",
    position: { x: layout.x, y: layout.y },
    selected,
    data: {
      service,
      telemetry: buildPressureTelemetry(service),
      onFocus,
      onRun,
      onStop,
      onRestart,
    },
    dragHandle: ".flow-node-drag-handle",
    draggable: true,
    deletable: false,
    selectable: true,
  };
}

export default function App() {
  const isDesktop = Boolean(window.__TAURI_INTERNALS__);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const graphLayoutRef = useRef<HTMLDivElement | null>(null);
  const topologySaveTimerRef = useRef<number | null>(null);

  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot);
  const [topology, setTopology] = useState<ProjectTopology | null>(null);
  const [flowNodes, setFlowNodes] = useState<Array<Node<ServiceGraphNodeData>>>([]);
  const [isTopologyDirty, setIsTopologyDirty] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    dashboardRefreshSeconds: 2,
    realtimeRefreshSeconds: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPendingAction, setIsPendingAction] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [view, setView] = useState<AppView>("graph");
  const [focusedServiceId, setFocusedServiceId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("logs");
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const stored = window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_INSPECTOR_WIDTH;
  });
  const [isInspectorResizing, setIsInspectorResizing] = useState(false);

  const [logSnapshot, setLogSnapshot] = useState<ServiceLogSnapshot | null>(null);
  const [isLogAutoscroll, setIsLogAutoscroll] = useState(true);
  const [logQuery, setLogQuery] = useState("");
  const deferredLogQuery = useDeferredValue(logQuery);
  const [logFilter, setLogFilter] = useState<"all" | "stdout" | "stderr">("all");

  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Microservice | null>(null);
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(emptyServiceForm);
  const [portWarning, setPortWarning] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState({ dashboardRefresh: "2", realtimeRefresh: "1" });
  const [serviceToDelete, setServiceToDelete] = useState<Microservice | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const addToast = useCallback((tone: ToastMessage["tone"], message: string, detail?: string | null) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, tone, message, detail }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, 280);
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 280);
  }, []);

  const activeProject = useMemo(
    () => snapshot.projects.find((project) => project.isActive) ?? null,
    [snapshot.projects],
  );

  const focusedService = useMemo(
    () => snapshot.services.find((service) => service.id === focusedServiceId) ?? null,
    [focusedServiceId, snapshot.services],
  );

  const activeProjectStats = useMemo(() => {
    let running = 0;
    let errors = 0;
    for (const service of snapshot.services) {
      if (service.status === "running" || service.status === "starting" || service.status === "external") running += 1;
      if (service.status === "error") errors += 1;
    }
    return { total: snapshot.services.length, running, errors };
  }, [snapshot.services]);

  const visibleLogEntries = useMemo(() => {
    const entries = logSnapshot?.entries ?? [];
    const query = deferredLogQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => entry.message.toLowerCase().includes(query));
  }, [deferredLogQuery, logSnapshot?.entries]);

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const service of snapshot.services) map.set(service.id, service.name);
    return map;
  }, [snapshot.services]);

  const loadLogsForService = useCallback(async (serviceId: string) => {
    try {
      const next = await getServiceLogs(serviceId);
      setLogSnapshot(next);
    } catch (error) {
      addToast("error", "No fue posible cargar los logs.", String(error));
    }
  }, [addToast]);

  const syncInspectorWidth = useCallback((nextWidth?: number) => {
    const layout = graphLayoutRef.current;
    if (!layout) return;
    const { width } = layout.getBoundingClientRect();
    setInspectorWidth((current) => clampInspectorWidth(nextWidth ?? current, width));
  }, []);

  const resizeInspectorBy = useCallback((delta: number) => {
    const layout = graphLayoutRef.current;
    if (!layout) return;
    const { width } = layout.getBoundingClientRect();
    setInspectorWidth((current) => clampInspectorWidth(current + delta, width));
  }, []);

  const updateInspectorWidthFromPointer = useCallback((clientX: number) => {
    const layout = graphLayoutRef.current;
    if (!layout) return;
    const bounds = layout.getBoundingClientRect();
    syncInspectorWidth(bounds.right - clientX);
  }, [syncInspectorWidth]);

  const handleInspectorResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(max-width: 1200px)").matches) return;
    event.preventDefault();
    setIsInspectorResizing(true);
    updateInspectorWidthFromPointer(event.clientX);
  }, [updateInspectorWidthFromPointer]);

  const handleInspectorResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizeInspectorBy(24);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      resizeInspectorBy(-24);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      syncInspectorWidth(MIN_INSPECTOR_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      syncInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
    }
  }, [resizeInspectorBy, syncInspectorWidth]);

  const resetInspectorWidth = useCallback(() => {
    syncInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
  }, [syncInspectorWidth]);

  useEffect(() => {
    let ignore = false;
    void Promise.all([loadDashboardSnapshot(), loadAppSettings()])
      .then(([nextSnapshot, nextSettings]) => {
        if (ignore) return;
        setSnapshot(nextSnapshot);
        setSettings(nextSettings);
        setSettingsForm({
          dashboardRefresh: String(nextSettings.dashboardRefreshSeconds),
          realtimeRefresh: String(nextSettings.realtimeRefreshSeconds),
        });
      })
      .catch((error: unknown) => {
        if (!ignore) addToast("error", "No fue posible cargar la app.", String(error));
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [addToast]);

  useEffect(() => {
    syncInspectorWidth();
    const handleWindowResize = () => syncInspectorWidth();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [syncInspectorWidth]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: UnlistenFn | undefined;
    listenDashboardUpdates((nextSnapshot) => {
      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
    }).then((callback) => {
      unlisten = callback;
    }).catch((error: unknown) => {
      addToast("error", "No fue posible escuchar el dashboard.", String(error));
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [addToast, isDesktop]);

  useEffect(() => {
    if (!activeProject) {
      setTopology(null);
      return;
    }
    let ignore = false;
    setTopology(emptyTopology(activeProject.id));
    void getProjectTopology(activeProject.id)
      .then((nextTopology) => {
        if (!ignore) setTopology(nextTopology);
      })
      .catch((error) => {
        if (!ignore) addToast("error", "No fue posible cargar la topologia.", String(error));
      });
    return () => {
      ignore = true;
    };
  }, [activeProject?.id, addToast]);

  useEffect(() => {
    if (snapshot.services.length === 0) {
      setFocusedServiceId(null);
      setLogSnapshot(null);
      return;
    }
    if (!focusedServiceId || !snapshot.services.some((service) => service.id === focusedServiceId)) {
      setFocusedServiceId(snapshot.services[0]?.id ?? null);
    }
  }, [focusedServiceId, snapshot.services]);

  useEffect(() => {
    if (!activeProject || !topology) return;
    const missingLayouts = snapshot.services.reduce<Record<string, ServiceNodeLayout>>((acc, service, index) => {
      const layout = topology.nodeLayouts[service.id] ?? service.graph;
      if (!layout) acc[service.id] = buildDefaultLayout(index);
      return acc;
    }, {});

    if (Object.keys(missingLayouts).length === 0) return;
    setTopology((current) => {
      if (!current) return current;
      return {
        ...current,
        nodeLayouts: { ...current.nodeLayouts, ...missingLayouts },
        updatedAt: new Date().toISOString(),
      };
    });
    setIsTopologyDirty(true);
  }, [activeProject, snapshot.services, topology]);

  useEffect(() => {
    if (!activeProject || !topology || !isTopologyDirty) return;
    if (topologySaveTimerRef.current != null) window.clearTimeout(topologySaveTimerRef.current);
    topologySaveTimerRef.current = window.setTimeout(() => {
      void saveProjectTopology(topology)
        .then((saved) => {
          setTopology(saved);
          setIsTopologyDirty(false);
        })
        .catch((error) => {
          addToast("error", "No fue posible guardar la topologia.", String(error));
        });
    }, 350);

    return () => {
      if (topologySaveTimerRef.current != null) {
        window.clearTimeout(topologySaveTimerRef.current);
        topologySaveTimerRef.current = null;
      }
    };
  }, [activeProject, addToast, isTopologyDirty, topology]);

  useEffect(() => {
    if (!focusedServiceId || inspectorTab !== "logs" || view !== "graph" || !isDesktop) return;
    void loadLogsForService(focusedServiceId);
    let unlisten: UnlistenFn | undefined;
    listenServiceLogLine((payload) => {
      if (payload.serviceId !== focusedServiceId) return;
      setLogSnapshot((current) => {
        if (!current || current.serviceId !== payload.serviceId) return current;
        const entries = [...current.entries, payload.entry].slice(-2000);
        return { ...current, entries };
      });
    }).then((callback) => {
      unlisten = callback;
    }).catch((error: unknown) => {
      addToast("error", "No fue posible escuchar logs en vivo.", String(error));
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [addToast, focusedServiceId, inspectorTab, isDesktop, loadLogsForService, view]);

  useEffect(() => {
    if (!isLogAutoscroll || !logSnapshot || inspectorTab !== "logs") return;
    const viewport = logViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [inspectorTab, isLogAutoscroll, logSnapshot]);

  useEffect(() => {
    if (!isInspectorResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      updateInspectorWidthFromPointer(event.clientX);
    };
    const stopResizing = () => {
      setIsInspectorResizing(false);
    };

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isInspectorResizing, updateInspectorWidthFromPointer]);

  useEffect(() => {
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(inspectorWidth));
  }, [inspectorWidth]);

  const graphLayoutStyle = useMemo(() => (
    { "--inspector-width": `${inspectorWidth}px` } as CSSProperties
  ), [inspectorWidth]);

  const updateTopology = useCallback((updater: (current: ProjectTopology) => ProjectTopology) => {
    setTopology((current) => {
      if (!current) return current;
      const next = updater(current);
      if (next === current) return current;
      setIsTopologyDirty(true);
      return next;
    });
  }, []);

  const handleNodesChange = useCallback((changes: NodeChange<Node<ServiceGraphNodeData>>[]) => {
    let nextFocusedServiceId: string | null = null;
    setFlowNodes((current) => applyNodeChanges(changes, current));

    updateTopology((current) => {
      let changed = false;
      const nextLayouts = { ...current.nodeLayouts };
      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          nextFocusedServiceId = change.id;
        }
        if (change.type === "position" && change.position) {
          const existing = nextLayouts[change.id] ?? buildDefaultLayout(0);
          nextLayouts[change.id] = { ...existing, x: change.position.x, y: change.position.y };
          changed = true;
        }
        if (change.type === "dimensions" && change.dimensions) {
          const existing = nextLayouts[change.id] ?? buildDefaultLayout(0);
          nextLayouts[change.id] = {
            ...existing,
            width: change.dimensions.width,
            height: change.dimensions.height,
          };
          changed = true;
        }
      }
      return changed ? { ...current, nodeLayouts: nextLayouts, updatedAt: new Date().toISOString() } : current;
    });

    if (nextFocusedServiceId) {
      setFocusedServiceId(nextFocusedServiceId);
    }
  }, [updateTopology]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    updateTopology((current) => {
      const alreadyExists = current.edges.some(
        (edge) => edge.sourceServiceId === connection.source && edge.targetServiceId === connection.target,
      );
      if (alreadyExists) return current;
      return {
        ...current,
        edges: [
          ...current.edges,
          {
            id: `${connection.source}-${connection.target}-${Date.now()}`,
            sourceServiceId: connection.source,
            targetServiceId: connection.target,
            label: null,
            telemetry: null,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
    });
  }, [updateTopology]);

  const handleDeleteEdges = useCallback((edgeIds: string[]) => {
    if (edgeIds.length === 0) return;
    updateTopology((current) => ({
      ...current,
      edges: current.edges.filter((edge) => !edgeIds.includes(edge.id)),
      updatedAt: new Date().toISOString(),
    }));
  }, [updateTopology]);

  const handleRenameEdge = useCallback((edgeId: string) => {
    const existing = topology?.edges.find((item) => item.id === edgeId);
    if (!existing) return;
    const nextLabel = window.prompt("Nombre del flujo", existing.label ?? "");
    if (nextLabel === null) return;
    updateTopology((current) => ({
      ...current,
      edges: current.edges.map((item) => (
        item.id === edgeId ? { ...item, label: nextLabel.trim() || null } : item
      )),
      updatedAt: new Date().toISOString(),
    }));
  }, [topology?.edges, updateTopology]);

  const handleRunService = useCallback(async (service: Microservice) => {
    if (service.expectedPort) {
      const inUse = await checkPortInUse(service.expectedPort).catch(() => false);
      if (inUse) addToast("error", `Port ${service.expectedPort} is already in use.`, "The node may fail to start.");
    }
    addToast("info", `Starting ${service.name}...`);
    try {
      const response = await runService(service.id);
      setSnapshot(response.snapshot);
      if (response.issue) addToast("error", response.issue.message, response.issue.detail);
      else addToast("success", `${service.name} is now supervised.`);
    } catch (error) {
      addToast("error", "No fue posible iniciar el nodo.", String(error));
    }
  }, [addToast]);

  const handleStopService = useCallback(async (service: Microservice) => {
    addToast("info", `Stopping ${service.name}...`);
    try {
      const response = await stopService(service.id);
      setSnapshot(response.snapshot);
      addToast("success", `${service.name} stopped.`);
    } catch (error) {
      addToast("error", "No fue posible detener el nodo.", String(error));
    }
  }, [addToast]);

  const handleRestartService = useCallback(async (service: Microservice) => {
    addToast("info", `Restarting ${service.name}...`);
    try {
      const response = await restartService(service.id);
      setSnapshot(response.snapshot);
      if (response.issue) addToast("error", response.issue.message, response.issue.detail);
      else addToast("success", `${service.name} restarted.`);
    } catch (error) {
      addToast("error", "No fue posible reiniciar el nodo.", String(error));
    }
  }, [addToast]);

  useEffect(() => {
    const nodeLayouts = topology?.nodeLayouts ?? {};

    // Keep React Flow interaction state local so telemetry refreshes do not interrupt dragging.
    setFlowNodes((current) => {
      const previousById = new Map(current.map((node) => [node.id, node]));

      return snapshot.services.map((service, index) => {
        const layout = nodeLayouts[service.id] ?? service.graph ?? buildDefaultLayout(index);
        return buildGraphNode({
          service,
          layout,
          selected: service.id === focusedServiceId,
          previous: previousById.get(service.id),
          onFocus: setFocusedServiceId,
          onRun: (item) => void handleRunService(item),
          onStop: (item) => void handleStopService(item),
          onRestart: (item) => void handleRestartService(item),
        });
      });
    });
  }, [focusedServiceId, handleRestartService, handleRunService, handleStopService, snapshot.services, topology?.nodeLayouts]);

  const edges = useMemo<Array<Edge<ServiceFlowEdgeData>>>(() => (
    (topology?.edges ?? [])
      .filter((edge) => serviceNameById.has(edge.sourceServiceId) && serviceNameById.has(edge.targetServiceId))
      .map((edge) => ({
        id: edge.id,
        source: edge.sourceServiceId,
        target: edge.targetServiceId,
        type: "serviceEdge",
        deletable: true,
        data: {
          edge,
          sourceName: serviceNameById.get(edge.sourceServiceId) ?? "Source",
          targetName: serviceNameById.get(edge.targetServiceId) ?? "Target",
          onEdit: (item) => handleRenameEdge(item.id),
          onDelete: (edgeId) => handleDeleteEdges([edgeId]),
        },
      }))
  ), [handleDeleteEdges, handleRenameEdge, serviceNameById, topology?.edges]);

  async function handleSubmitProject(event: FormEvent) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setIsPendingAction(true);
    try {
      const nextSnapshot = editingProject
        ? await updateProject(editingProject.id, { name })
        : await createProject({ name });
      setSnapshot(nextSnapshot);
      setShowProjectForm(false);
      setEditingProject(null);
      setProjectName("");
      addToast("success", editingProject ? "Project updated." : "Project created.");
    } catch (error) {
      addToast("error", "No fue posible guardar el proyecto.", String(error));
    } finally {
      setIsPendingAction(false);
    }
  }

  function openEditProject(project: Project) {
    setEditingProject(project);
    setProjectName(project.name);
    setShowProjectForm(true);
  }

  async function confirmDeleteProject() {
    if (!projectToDelete) return;
    setIsPendingAction(true);
    try {
      const nextSnapshot = await deleteProject(projectToDelete.id);
      setSnapshot(nextSnapshot);
      addToast("success", `Project "${projectToDelete.name}" deleted.`);
      setProjectToDelete(null);
    } catch (error) {
      addToast("error", "No fue posible eliminar el proyecto.", String(error));
    } finally {
      setIsPendingAction(false);
    }
  }

  async function handleSelectProject(project: Project) {
    if (project.isActive) return;
    setIsPendingAction(true);
    try {
      setSnapshot(await selectProject(project.id));
    } catch (error) {
      addToast("error", "No fue posible seleccionar el proyecto.", String(error));
    } finally {
      setIsPendingAction(false);
    }
  }

  const checkPortWarning = useCallback(async (portRaw: string) => {
    const port = portRaw ? Number.parseInt(portRaw, 10) : null;
    if (!port) {
      setPortWarning(null);
      return;
    }
    try {
      const inUse = await checkPortInUse(port);
      setPortWarning(inUse ? `Port ${port} is already in use.` : null);
    } catch {
      setPortWarning(null);
    }
  }, []);

  async function handleSubmitService(event: FormEvent) {
    event.preventDefault();
    if (!activeProject) return;
    const draft = {
      projectId: activeProject.id,
      kind: serviceForm.kind,
      name: serviceForm.name.trim(),
      workingDirectory: serviceForm.workingDirectory.trim(),
      startCommand: serviceForm.startCommand.trim(),
      expectedPort: serviceForm.expectedPort.trim() ? Number(serviceForm.expectedPort.trim()) : null,
    };
    setIsPendingAction(true);
    try {
      const nextSnapshot = editingService
        ? await updateMicroservice(editingService.id, draft)
        : await createMicroservice(draft);
      setSnapshot(nextSnapshot);
      setShowServiceForm(false);
      setEditingService(null);
      setServiceForm(emptyServiceForm);
      setPortWarning(null);
      addToast("success", editingService ? "Node updated." : "Node created.");
    } catch (error) {
      addToast("error", "No fue posible guardar el nodo.", String(error));
    } finally {
      setIsPendingAction(false);
    }
  }

  function openEditService(service: Microservice) {
    setEditingService(service);
    setServiceForm({
      kind: service.kind,
      name: service.name,
      workingDirectory: service.workingDirectory,
      startCommand: service.startCommand,
      expectedPort: service.expectedPort != null ? String(service.expectedPort) : "",
    });
    setShowServiceForm(true);
  }

  async function confirmDeleteService() {
    if (!serviceToDelete) return;
    setIsPendingAction(true);
    try {
      setSnapshot(await deleteMicroservice(serviceToDelete.id));
      updateTopology((current) => ({
        ...current,
        nodeLayouts: Object.fromEntries(
          Object.entries(current.nodeLayouts).filter(([serviceId]) => serviceId !== serviceToDelete.id),
        ),
        edges: current.edges.filter((edge) => edge.sourceServiceId !== serviceToDelete.id && edge.targetServiceId !== serviceToDelete.id),
        updatedAt: new Date().toISOString(),
      }));
      addToast("success", `Node "${serviceToDelete.name}" deleted.`);
      setServiceToDelete(null);
    } catch (error) {
      addToast("error", "No fue posible eliminar el nodo.", String(error));
    } finally {
      setIsPendingAction(false);
    }
  }

  const handleCopyLogs = useCallback(() => {
    if (!logSnapshot) return;
    const text = logSnapshot.entries.map((entry) => `[${entry.timestamp.slice(11, 23)}] [${entry.stream}] ${entry.message}`).join("\n");
    void navigator.clipboard.writeText(text)
      .then(() => addToast("success", "Logs copied to clipboard."))
      .catch((error) => addToast("error", "No fue posible copiar los logs.", String(error)));
  }, [addToast, logSnapshot]);

  const handleClearLogs = useCallback(async () => {
    if (!focusedServiceId) return;
    try {
      const next = await clearServiceLogs(focusedServiceId);
      setLogSnapshot(next);
    } catch (error) {
      addToast("error", "No fue posible limpiar los logs.", String(error));
    }
  }, [addToast, focusedServiceId]);

  const handleRunAll = useCallback(async () => {
    const stoppable = snapshot.services.filter((service) => service.status === "stopped" || service.status === "error");
    if (stoppable.length === 0) {
      addToast("info", "No nodes are ready to start.");
      return;
    }
    addToast("info", `Starting ${stoppable.length} nodes...`);
    for (const service of stoppable) {
      try {
        const response = await runService(service.id);
        setSnapshot(response.snapshot);
      } catch (error) {
        addToast("error", `Failed to start ${service.name}.`, String(error));
      }
    }
    addToast("success", "Bulk start finished.");
  }, [addToast, snapshot.services]);

  const handleStopAll = useCallback(async () => {
    const runningServices = snapshot.services.filter((service) => service.status === "running" || service.status === "starting");
    if (runningServices.length === 0) {
      addToast("info", "No running nodes to stop.");
      return;
    }
    addToast("info", `Stopping ${runningServices.length} nodes...`);
    for (const service of runningServices) {
      try {
        const response = await stopService(service.id);
        setSnapshot(response.snapshot);
      } catch (error) {
        addToast("error", `Failed to stop ${service.name}.`, String(error));
      }
    }
    addToast("success", "Bulk stop finished.");
  }, [addToast, snapshot.services]);

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    const nextSettings: AppSettings = {
      dashboardRefreshSeconds: Math.max(1, Number(settingsForm.dashboardRefresh)),
      realtimeRefreshSeconds: Math.max(1, Number(settingsForm.realtimeRefresh)),
    };
    try {
      const saved = await saveAppSettings(nextSettings);
      setSettings(saved);
      addToast("success", "Settings saved.");
    } catch (error) {
      addToast("error", "No fue posible guardar los ajustes.", String(error));
    }
  }

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading control center...</p>
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
        onSelectProject={(project) => void handleSelectProject(project)}
        onEditProject={openEditProject}
        onDeleteProject={(project) => setProjectToDelete(project)}
        onNewProject={() => {
          setEditingProject(null);
          setProjectName("");
          setShowProjectForm(true);
        }}
      />

      <main className="main-panel">
        <ToastContainer toasts={toasts} onRemove={removeToast} />

        {view === "graph" ? (
          <div
            ref={graphLayoutRef}
            className={`graph-layout${isInspectorResizing ? " is-resizing" : ""}`}
            style={graphLayoutStyle}
          >
            <div className="graph-main">
              <ServiceGraphView
                activeProject={activeProject}
                services={snapshot.services}
                nodes={flowNodes}
                edges={edges}
                isPendingAction={isPendingAction}
                onAddService={() => {
                  setEditingService(null);
                  setServiceForm(emptyServiceForm);
                  setShowServiceForm(true);
                }}
                onRunAll={() => void handleRunAll()}
                onStopAll={() => void handleStopAll()}
                onNodesChange={handleNodesChange}
                onConnect={handleConnect}
                onNodeSelect={(serviceId) => setFocusedServiceId(serviceId)}
                onDeleteEdges={handleDeleteEdges}
                onPaneClick={() => undefined}
              />
            </div>

            <div
              className="inspector-resize-handle"
              role="separator"
              aria-label="Resize logs panel"
              aria-orientation="vertical"
              aria-valuemin={MIN_INSPECTOR_WIDTH}
              aria-valuenow={inspectorWidth}
              tabIndex={0}
              onPointerDown={handleInspectorResizeStart}
              onDoubleClick={resetInspectorWidth}
              onKeyDown={handleInspectorResizeKeyDown}
            />

            <ServiceInspector
              service={focusedService}
              services={snapshot.services}
              tab={inspectorTab}
              onTabChange={setInspectorTab}
              onSelectService={(serviceId) => {
                setFocusedServiceId(serviceId);
                if (inspectorTab === "logs") void loadLogsForService(serviceId);
              }}
              onRun={(service) => void handleRunService(service)}
              onStop={(service) => void handleStopService(service)}
              onRestart={(service) => void handleRestartService(service)}
              onLogs={(service) => void loadLogsForService(service.id)}
              onFolder={(service) => void openServiceFolder(service.id).catch((error: unknown) => addToast("error", String(error)))}
              onTerminal={(service) => void openServiceTerminal(service.id).catch((error: unknown) => addToast("error", String(error)))}
              onEdit={openEditService}
              onDelete={(service) => setServiceToDelete(service)}
              logSnapshot={logSnapshot}
              logFilter={logFilter}
              logQuery={logQuery}
              isLogAutoscroll={isLogAutoscroll}
              visibleLogEntries={visibleLogEntries}
              onFilterChange={setLogFilter}
              onQueryChange={setLogQuery}
              onToggleAutoscroll={() => setIsLogAutoscroll((current) => !current)}
              onCopyLogs={handleCopyLogs}
              onClearLogs={() => void handleClearLogs()}
              logViewportRef={logViewportRef}
            />
          </div>
        ) : (
          <SettingsView
            settingsForm={settingsForm}
            onChangeField={(field, value) => setSettingsForm((current) => ({ ...current, [field]: value }))}
            onSubmit={(event) => void handleSaveSettings(event)}
          />
        )}
      </main>

      {showProjectForm && (
        <ProjectForm
          editingProject={editingProject}
          projectName={projectName}
          isPendingAction={isPendingAction}
          onChangeName={setProjectName}
          onSubmit={(event) => void handleSubmitProject(event)}
          onClose={() => {
            setShowProjectForm(false);
            setEditingProject(null);
            setProjectName("");
          }}
        />
      )}

      {showServiceForm && activeProject && (
        <ServiceForm
          editingService={editingService}
          serviceForm={serviceForm}
          portWarning={portWarning}
          isPendingAction={isPendingAction}
          onChangeField={(field, value) => setServiceForm((current) => ({ ...current, [field]: value }))}
          onPortBlur={(port) => void checkPortWarning(port)}
          onBrowseDirectory={async () => {
            try {
              const directory = await openDirectoryDialog();
              if (directory != null) {
                setServiceForm((current) => ({ ...current, workingDirectory: directory }));
              }
            } catch (error) {
              addToast("error", "No fue posible abrir el selector de carpetas.", String(error));
            }
          }}
          onSubmit={(event) => void handleSubmitService(event)}
          onClose={() => {
            setShowServiceForm(false);
            setEditingService(null);
            setServiceForm(emptyServiceForm);
            setPortWarning(null);
          }}
        />
      )}

      {serviceToDelete && (
        <Modal title="Delete node" onClose={() => setServiceToDelete(null)}>
          <div className="modal-confirm">
            <p>Delete <strong>{serviceToDelete.name}</strong> and remove its graph connections?</p>
            <div className="modal-actions">
              <button type="button" className="btn-outline" onClick={() => setServiceToDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void confirmDeleteService()}>
                Delete node
              </button>
            </div>
          </div>
        </Modal>
      )}

      {projectToDelete && (
        <Modal title="Delete project" onClose={() => setProjectToDelete(null)}>
          <div className="modal-confirm">
            <p>Delete <strong>{projectToDelete.name}</strong> and all its nodes?</p>
            <div className="modal-actions">
              <button type="button" className="btn-outline" onClick={() => setProjectToDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void confirmDeleteProject()}>
                Delete project
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
