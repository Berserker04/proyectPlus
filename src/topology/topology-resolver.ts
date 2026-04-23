import {
  ResolveTopologyGraphInput,
  ResolvedTopologyEdge,
  ResolvedTopologyService,
  TopologyEdgeKind,
  TopologyDependency,
  TopologyRuntimeKey,
  TopologyGraphSnapshot,
  TopologyServiceRecord,
  buildEmptyTopologyGraph,
  inferServiceAliases,
  isServiceReady,
  normalizeTopologyName,
} from "./types";

export function resolveTopologyGraph(input: ResolveTopologyGraphInput): TopologyGraphSnapshot {
  const services = Array.from(input.records, (record) => buildResolvedService(record));
  const graph = buildEmptyTopologyGraph(input.mode);

  if (services.length === 0) {
    return {
      ...graph,
      lastRecomputedAt: input.recomputedAt ?? new Date().toISOString(),
    };
  }

  const servicesById = Object.fromEntries(services.map((service) => [service.serviceId, service]));
  const aliasMap = buildAliasMap(services);
  const manifestBackedServiceIds = new Set(
    services.filter((service) => service.manifest != null).map((service) => service.serviceId),
  );
  const edgeMap = new Map<string, ResolvedTopologyEdge>();

  if (input.mode !== "manual") {
    for (const service of services) {
      if (service.manifest == null) continue;

      for (const dependency of service.manifest.dependsOn) {
        if (dependency.type !== "http") continue;
        const relatedServiceId = aliasMap.get(normalizeTopologyName(dependency.service));
        if (!relatedServiceId) continue;

        const [sourceServiceId, targetServiceId] = dependency.direction === "inbound"
          ? [relatedServiceId, service.serviceId]
          : [service.serviceId, relatedServiceId];

        const sourceService = servicesById[sourceServiceId];
        const targetService = servicesById[targetServiceId];
        if (!sourceService || !targetService || sourceServiceId === targetServiceId) continue;

        const key = `http:${sourceServiceId}:${targetServiceId}`;
        edgeMap.set(
          key,
          mergeEdges(edgeMap.get(key), {
            id: key,
            sourceServiceId,
            targetServiceId,
            kind: "http",
            visualState: resolveVisualState(sourceService, targetService, "http"),
            sourceOfTruth: "manifest",
            deletable: false,
            label: "HTTP",
            httpDependencies: [dependency],
            rabbitExchanges: [],
            rabbitQueues: [],
            rabbitRoutingKeys: [],
            manualEdge: null,
          }),
        );
      }
    }

    const rabbitPublishes = services.flatMap((service) =>
      service.rabbitPublishes.map((publish) => ({ service, publish })),
    );
    const rabbitConsumes = services.flatMap((service) =>
      service.rabbitConsumes.map((consume) => ({ service, consume })),
    );

    for (const { service: producerService, publish } of rabbitPublishes) {
      for (const { service: consumerService, consume } of rabbitConsumes) {
        if (producerService.serviceId === consumerService.serviceId) continue;
        if (publish.exchange !== consume.exchange) continue;
        if (!routingKeysIntersect(publish.routingKeys, consume.routingKeys)) continue;

        const key = `rabbit:${producerService.serviceId}:${consumerService.serviceId}`;
        edgeMap.set(
          key,
          mergeEdges(edgeMap.get(key), {
            id: key,
            sourceServiceId: producerService.serviceId,
            targetServiceId: consumerService.serviceId,
            kind: "rabbit",
            visualState: resolveVisualState(producerService, consumerService, "rabbit"),
            sourceOfTruth: "manifest",
            deletable: false,
            label: "RabbitMQ",
            httpDependencies: [],
            rabbitExchanges: [publish.exchange],
            rabbitQueues: [consume.queue],
            rabbitRoutingKeys: [...publish.routingKeys, ...consume.routingKeys],
            manualEdge: null,
          }),
        );
      }
    }
  }

  if (input.mode !== "manifest" && input.manualTopology != null) {
    for (const edge of input.manualTopology.edges) {
      const sourceService = servicesById[edge.sourceServiceId];
      const targetService = servicesById[edge.targetServiceId];
      if (!sourceService || !targetService || edge.sourceServiceId === edge.targetServiceId) continue;
      if (input.mode === "hybrid" && manifestBackedServiceIds.has(edge.sourceServiceId)) continue;

      edgeMap.set(`manual:${edge.id}`, {
        id: edge.id,
        sourceServiceId: edge.sourceServiceId,
        targetServiceId: edge.targetServiceId,
        kind: "manual",
        visualState: resolveVisualState(sourceService, targetService, "manual"),
        sourceOfTruth: "manual",
        deletable: true,
        label: edge.label ?? "Manual",
        httpDependencies: [],
        rabbitExchanges: [],
        rabbitQueues: [],
        rabbitRoutingKeys: [],
        manualEdge: edge,
      });
    }
  }

  return {
    servicesById,
    edges: Array.from(edgeMap.values()),
    mode: input.mode,
    manifestServiceCount: services.filter((service) => service.manifest != null).length,
    legacyServiceCount: services.filter((service) => service.manifest == null).length,
    lastRecomputedAt: input.recomputedAt ?? new Date().toISOString(),
  };
}

function buildResolvedService(record: TopologyServiceRecord): ResolvedTopologyService {
  return {
    serviceId: record.serviceId,
    service: record.service,
    displayName: record.manifest?.displayName ?? record.service.name,
    serviceName: record.manifest?.serviceName ?? record.service.name,
    aliases: inferServiceAliases(record.service, record.manifest),
    topologyKind: resolveServiceKind(record),
    sourceOfTruth: record.manifest ? "manifest" : "legacy/manual",
    manifest: record.manifest,
    rawManifest: record.rawManifest,
    loadSource: record.source,
    health: record.manifest?.health ?? null,
    runtime: record.manifest?.runtime ?? null,
    runtimes: record.manifest?.runtimes ?? null,
    httpDependencies: record.manifest?.dependsOn.filter((dependency) => dependency.type === "http") ?? [],
    rabbitPublishes: record.manifest?.dependsOn.filter((dependency) => dependency.type === "rabbitPublish") ?? [],
    rabbitConsumes: record.manifest?.dependsOn.filter((dependency) => dependency.type === "rabbitConsume") ?? [],
    endpointUrl: record.endpointUrl,
    localManifestPath: record.localManifestPath,
    lastAttemptAt: record.lastAttemptAt,
    lastSuccessAt: record.lastSuccessAt,
    warnings: record.warnings,
    error: record.error,
    stale: record.stale,
  };
}

function buildAliasMap(services: ResolvedTopologyService[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const orderedServices = [...services].sort((left, right) =>
    Number(right.manifest != null) - Number(left.manifest != null),
  );

  for (const service of orderedServices) {
    for (const alias of service.aliases) {
      if (!aliasMap.has(alias)) {
        aliasMap.set(alias, service.serviceId);
      }
    }
  }

  return aliasMap;
}

function routingKeysIntersect(sourceKeys: string[], targetKeys: string[]): boolean {
  if (sourceKeys.length === 0 || targetKeys.length === 0) return true;
  const targetSet = new Set(targetKeys);
  return sourceKeys.some((key) => targetSet.has(key));
}

function mergeEdges(current: ResolvedTopologyEdge | undefined, next: ResolvedTopologyEdge): ResolvedTopologyEdge {
  if (!current) {
    return {
      ...next,
      rabbitExchanges: unique(next.rabbitExchanges),
      rabbitQueues: unique(next.rabbitQueues),
      rabbitRoutingKeys: unique(next.rabbitRoutingKeys),
    };
  }

  return {
    ...current,
    visualState: combineVisualStates(current.visualState, next.visualState),
    httpDependencies: dedupeDependencies(current.httpDependencies.concat(next.httpDependencies)),
    rabbitExchanges: unique(current.rabbitExchanges.concat(next.rabbitExchanges)),
    rabbitQueues: unique(current.rabbitQueues.concat(next.rabbitQueues)),
    rabbitRoutingKeys: unique(current.rabbitRoutingKeys.concat(next.rabbitRoutingKeys)),
  };
}

function combineVisualStates(
  left: ResolvedTopologyEdge["visualState"],
  right: ResolvedTopologyEdge["visualState"],
): ResolvedTopologyEdge["visualState"] {
  const severityOrder: Record<ResolvedTopologyEdge["visualState"], number> = {
    declared: 0,
    active: 1,
    live: 2,
    error: 3,
  };
  return severityOrder[left] >= severityOrder[right] ? left : right;
}

function resolveVisualState(
  sourceService: ResolvedTopologyService,
  targetService: ResolvedTopologyService,
  edgeKind: TopologyEdgeKind,
): ResolvedTopologyEdge["visualState"] {
  const sourceReady = isServiceReady(sourceService, resolveRuntimeScope(sourceService, edgeKind, "source"));
  const targetReady = isServiceReady(targetService, resolveRuntimeScope(targetService, edgeKind, "target"));
  return sourceReady && targetReady ? "active" : "declared";
}

function resolveServiceKind(record: TopologyServiceRecord): ResolvedTopologyService["topologyKind"] {
  if (record.manifest?.kind === "hybrid") return "hybrid";
  if (record.manifest?.kind === "worker" || record.service.kind === "worker") return "worker";
  return "service";
}

function resolveRuntimeScope(
  service: ResolvedTopologyService,
  edgeKind: TopologyEdgeKind,
  role: "source" | "target",
): TopologyRuntimeKey | null {
  if (edgeKind === "manual") return null;
  if (edgeKind === "http") return "api";

  if (service.runtimes?.worker) return "worker";
  if (service.runtimes?.api) return "api";
  if (role === "target" && service.topologyKind === "worker") return "worker";
  return null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function dedupeDependencies(dependencies: TopologyDependency[]): typeof dependencies {
  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    const key = JSON.stringify(dependency);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
