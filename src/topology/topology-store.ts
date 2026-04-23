import type { Microservice, ProjectTopology } from "@/lib/domain/models";
import {
  DEFAULT_TOPOLOGY_STALE_AFTER_MS,
  TopologyLoadResult,
  TopologyServiceRecord,
  TopologySourceMode,
  TopologyStoreSnapshot,
  buildEmptyTopologyGraph,
  buildTopologyLocalManifestPath,
  inferServiceAliases,
} from "./types";
import { resolveTopologyGraph } from "./topology-resolver";

interface TopologyStoreOptions {
  mode: TopologySourceMode;
  staleAfterMs?: number;
}

export interface TopologyStore {
  getSnapshot: () => TopologyStoreSnapshot;
  setMode: (mode: TopologySourceMode) => TopologyStoreSnapshot;
  syncServices: (services: Microservice[]) => TopologyStoreSnapshot;
  updateServiceTopology: (serviceId: string, result: TopologyLoadResult) => TopologyStoreSnapshot;
  removeServiceTopology: (serviceId: string) => TopologyStoreSnapshot;
  recomputeGraph: (manualTopology: ProjectTopology | null) => TopologyStoreSnapshot;
}

export function createTopologyStore(options: TopologyStoreOptions): TopologyStore {
  let mode = options.mode;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_TOPOLOGY_STALE_AFTER_MS;
  const records = new Map<string, TopologyServiceRecord>();
  let graph = buildEmptyTopologyGraph(mode);

  const getSnapshot = (): TopologyStoreSnapshot => ({
    recordsByServiceId: Object.fromEntries(records),
    graph,
  });

  const syncServices: TopologyStore["syncServices"] = (services) => {
    const nextIds = new Set(services.map((service) => service.id));

    for (const serviceId of Array.from(records.keys())) {
      if (!nextIds.has(serviceId)) {
        records.delete(serviceId);
      }
    }

    for (const service of services) {
      const existing = records.get(service.id);
      records.set(service.id, {
        serviceId: service.id,
        service,
        aliases: inferServiceAliases(service, existing?.manifest ?? null),
        manifest: existing?.manifest ?? null,
        rawManifest: existing?.rawManifest ?? null,
        source: existing?.source ?? null,
        endpointUrl: existing?.endpointUrl ?? null,
        localManifestPath: buildTopologyLocalManifestPath(service.workingDirectory),
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        lastSuccessAt: existing?.lastSuccessAt ?? null,
        warnings: existing?.warnings ?? [],
        error: existing?.error ?? null,
        stale: computeStale(existing?.lastSuccessAt ?? null, staleAfterMs),
      });
    }

    return getSnapshot();
  };

  const updateServiceTopology: TopologyStore["updateServiceTopology"] = (serviceId, result) => {
    const existing = records.get(serviceId);
    if (!existing) return getSnapshot();

    if (result.status === "success" && result.manifest != null) {
      records.set(serviceId, {
        ...existing,
        aliases: inferServiceAliases(existing.service, result.manifest),
        manifest: result.manifest,
        rawManifest: result.rawManifest,
        source: result.source,
        endpointUrl: result.endpointUrl,
        localManifestPath: result.localManifestPath,
        lastAttemptAt: result.attemptedAt,
        lastSuccessAt: result.attemptedAt,
        warnings: result.warnings,
        error: null,
        stale: false,
      });
      return getSnapshot();
    }

    records.set(serviceId, {
      ...existing,
      lastAttemptAt: result.attemptedAt,
      endpointUrl: result.endpointUrl,
      localManifestPath: result.localManifestPath,
      warnings: result.warnings,
      error: result.error,
      stale: existing.manifest != null && computeStale(existing.lastSuccessAt, staleAfterMs),
    });

    return getSnapshot();
  };

  const removeServiceTopology: TopologyStore["removeServiceTopology"] = (serviceId) => {
    records.delete(serviceId);
    return getSnapshot();
  };

  const recomputeGraph: TopologyStore["recomputeGraph"] = (manualTopology) => {
    graph = resolveTopologyGraph({
      mode,
      manualTopology,
      records: records.values(),
      recomputedAt: new Date().toISOString(),
    });
    return getSnapshot();
  };

  const setMode: TopologyStore["setMode"] = (nextMode) => {
    mode = nextMode;
    graph = buildEmptyTopologyGraph(mode);
    return getSnapshot();
  };

  return {
    getSnapshot,
    setMode,
    syncServices,
    updateServiceTopology,
    removeServiceTopology,
    recomputeGraph,
  };
}

function computeStale(lastSuccessAt: string | null, staleAfterMs: number): boolean {
  if (!lastSuccessAt) return false;
  const lastSuccessTime = Date.parse(lastSuccessAt);
  if (!Number.isFinite(lastSuccessTime)) return false;
  return Date.now() - lastSuccessTime > staleAfterMs;
}
