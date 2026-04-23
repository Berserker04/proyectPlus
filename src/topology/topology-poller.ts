import type { Microservice, ProjectTopology } from "@/lib/domain/models";
import { DEFAULT_TOPOLOGY_POLL_INTERVAL_MS, TopologyStoreSnapshot } from "./types";
import type { TopologyLoader } from "./topology-loader";
import type { TopologyStore } from "./topology-store";

interface TopologyPollerOptions {
  store: TopologyStore;
  loader: TopologyLoader;
  pollIntervalMs?: number;
  onSnapshot: (snapshot: TopologyStoreSnapshot) => void;
  onRefreshingChange?: (isRefreshing: boolean) => void;
}

export interface TopologyPoller {
  start: () => void;
  stop: () => void;
  setContext: (services: Microservice[], manualTopology: ProjectTopology | null) => void;
  refreshAll: () => Promise<void>;
  refreshServices: (serviceIds: string[]) => Promise<void>;
}

export function createTopologyPoller(options: TopologyPollerOptions): TopologyPoller {
  let timerId: number | null = null;
  let currentServices: Microservice[] = [];
  let currentManualTopology: ProjectTopology | null = null;
  let refreshPromise: Promise<void> | null = null;

  const emitSnapshot = () => {
    options.onSnapshot(options.store.recomputeGraph(currentManualTopology));
  };

  const refreshRecords = (serviceIds?: string[]) => {
    if (refreshPromise) return refreshPromise;

    const servicesToRefresh = serviceIds == null
      ? currentServices
      : currentServices.filter((service) => serviceIds.includes(service.id));

    refreshPromise = (async () => {
      options.onRefreshingChange?.(true);

      const results = await Promise.all(
        servicesToRefresh.map(async (service) => {
          const result = await options.loader.loadServiceTopology(service).catch((error) => ({
            serviceId: service.id,
            status: "error" as const,
            attemptedAt: new Date().toISOString(),
            source: null,
            manifest: null,
            rawManifest: null,
            endpointUrl: null,
            localManifestPath: service.workingDirectory,
            warnings: [],
            error: `Topology refresh failed: ${String(error)}`,
          }));
          return { service, result };
        }),
      );

      for (const { service, result } of results) {
        if (result.status === "invalid" || result.status === "error") {
          console.warn(`[topology] ${service.name}: ${result.error}`);
        }
        options.store.updateServiceTopology(service.id, result);
      }

      emitSnapshot();
    })()
      .finally(() => {
        refreshPromise = null;
        options.onRefreshingChange?.(false);
      });

    return refreshPromise;
  };

  const tick = () => {
    void refreshRecords();
  };

  return {
    start() {
      if (timerId != null) return;
      timerId = window.setInterval(tick, options.pollIntervalMs ?? DEFAULT_TOPOLOGY_POLL_INTERVAL_MS);
    },
    stop() {
      if (timerId != null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    },
    setContext(services, manualTopology) {
      currentServices = services;
      currentManualTopology = manualTopology;
      options.store.syncServices(services);
      emitSnapshot();
    },
    async refreshAll() {
      await refreshRecords();
    },
    async refreshServices(serviceIds) {
      await refreshRecords(serviceIds);
    },
  };
}
