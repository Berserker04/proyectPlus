import type { Microservice, ProjectTopology, ProjectTopologyEdge } from "@/lib/domain/models";

export type TopologySourceMode = "manual" | "manifest" | "hybrid";
export type TopologyManifestKind = "api" | "worker" | "hybrid";
export type TopologyDependencyType = "http" | "rabbitPublish" | "rabbitConsume";
export type TopologyEdgeKind = "http" | "rabbit" | "manual";
export type TopologyEdgeVisualState = "declared" | "active" | "live" | "error";
export type TopologyLoadSource = "http" | "file";
export type TopologyLoadStatus = "success" | "missing" | "invalid" | "error";
export type TopologySourceOfTruth = "manifest" | "legacy/manual";
export type TopologyRuntimeKey = "api" | "worker";
export type TopologyRuntimeMap = Partial<Record<TopologyRuntimeKey, TopologyRuntimeManifest>>;

export interface TopologyHealthManifest {
  summary?: string | null;
  live?: string | null;
  ready?: string | null;
}

export interface TopologyRuntimeCheck {
  name: string;
  status: string;
}

export interface TopologyRuntimeManifest {
  status: string;
  ready: boolean;
  checks: TopologyRuntimeCheck[];
}

export interface HttpTopologyDependency {
  type: "http";
  service: string;
  required: boolean;
  direction: "outbound" | "inbound";
}

export interface RabbitPublishTopologyDependency {
  type: "rabbitPublish";
  exchange: string;
  routingKeys: string[];
}

export interface RabbitConsumeTopologyDependency {
  type: "rabbitConsume";
  exchange: string;
  queue: string;
  routingKeys: string[];
}

export type TopologyDependency =
  | HttpTopologyDependency
  | RabbitPublishTopologyDependency
  | RabbitConsumeTopologyDependency;

export interface NormalizedTopologyManifest {
  serviceName: string;
  displayName: string;
  kind: TopologyManifestKind;
  port: number | null;
  health: TopologyHealthManifest | null;
  dependsOn: TopologyDependency[];
  runtime: TopologyRuntimeManifest | null;
  runtimes: TopologyRuntimeMap | null;
}

export interface TopologyLoadResult {
  serviceId: string;
  status: TopologyLoadStatus;
  attemptedAt: string;
  source: TopologyLoadSource | null;
  manifest: NormalizedTopologyManifest | null;
  rawManifest: string | null;
  endpointUrl: string | null;
  localManifestPath: string;
  warnings: string[];
  error: string | null;
}

export interface TopologyServiceRecord {
  serviceId: string;
  service: Microservice;
  aliases: string[];
  manifest: NormalizedTopologyManifest | null;
  rawManifest: string | null;
  source: TopologyLoadSource | null;
  endpointUrl: string | null;
  localManifestPath: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  warnings: string[];
  error: string | null;
  stale: boolean;
}

export interface ResolvedTopologyService {
  serviceId: string;
  service: Microservice;
  displayName: string;
  serviceName: string;
  aliases: string[];
  topologyKind: "service" | "worker" | "hybrid";
  sourceOfTruth: TopologySourceOfTruth;
  manifest: NormalizedTopologyManifest | null;
  rawManifest: string | null;
  loadSource: TopologyLoadSource | null;
  health: TopologyHealthManifest | null;
  runtime: TopologyRuntimeManifest | null;
  runtimes: TopologyRuntimeMap | null;
  httpDependencies: HttpTopologyDependency[];
  rabbitPublishes: RabbitPublishTopologyDependency[];
  rabbitConsumes: RabbitConsumeTopologyDependency[];
  endpointUrl: string | null;
  localManifestPath: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  warnings: string[];
  error: string | null;
  stale: boolean;
}

export interface ResolvedTopologyEdge {
  id: string;
  sourceServiceId: string;
  targetServiceId: string;
  kind: TopologyEdgeKind;
  visualState: TopologyEdgeVisualState;
  sourceOfTruth: "manifest" | "manual";
  deletable: boolean;
  label: string | null;
  httpDependencies: HttpTopologyDependency[];
  rabbitExchanges: string[];
  rabbitQueues: string[];
  rabbitRoutingKeys: string[];
  manualEdge: ProjectTopologyEdge | null;
}

export interface TopologyGraphSnapshot {
  servicesById: Record<string, ResolvedTopologyService>;
  edges: ResolvedTopologyEdge[];
  mode: TopologySourceMode;
  manifestServiceCount: number;
  legacyServiceCount: number;
  lastRecomputedAt: string | null;
}

export interface TopologyStoreSnapshot {
  recordsByServiceId: Record<string, TopologyServiceRecord>;
  graph: TopologyGraphSnapshot;
}

export interface ResolveTopologyGraphInput {
  mode: TopologySourceMode;
  manualTopology: ProjectTopology | null;
  records: Iterable<TopologyServiceRecord>;
  recomputedAt?: string;
}

export const DEFAULT_TOPOLOGY_ENDPOINT_PATH = "/internal/topology";
export const DEFAULT_TOPOLOGY_LOCAL_FILE = "topology.manifest.json";
export const DEFAULT_TOPOLOGY_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_TOPOLOGY_STALE_AFTER_MS = 30_000;
export const TOPOLOGY_RUNTIME_KEYS: TopologyRuntimeKey[] = ["api", "worker"];

const STYLEPLUS_PORT_HINTS = [
  { port: 3000, aliases: ["gateway", "api-gateway", "ms-api-gateway-service"] },
  { port: 3001, aliases: ["identity", "ms-identity-service"] },
  { port: 3002, aliases: ["tenant", "ms-tenant-service"] },
  { port: 3003, aliases: ["catalog", "ms-catalog-service"] },
  { port: 3004, aliases: ["staff", "ms-staff-service"] },
  { port: 3005, aliases: ["customer", "ms-customer-service"] },
  { port: 3006, aliases: ["booking", "ms-booking-service"] },
  { port: 3007, aliases: ["availability", "ms-availability-service"] },
  { port: 3008, aliases: ["payment", "ms-payment-service"] },
  { port: 3009, aliases: ["notification", "ms-notification-service"] },
  { port: 3010, aliases: ["reminder", "ms-reminder-service"] },
  { port: 3011, aliases: ["subscription", "ms-subscription-service"] },
  { port: 3012, aliases: ["integration", "ms-integration-service"] },
  { port: 3013, aliases: ["audit", "ms-audit-service"] },
  { port: 3014, aliases: ["analytics", "ms-analytics-service"] },
] as const;

export function getTopologySourceMode(): TopologySourceMode {
  const rawMode = (import.meta.env.TOPOLOGY_SOURCE ?? import.meta.env.VITE_TOPOLOGY_SOURCE ?? "hybrid")
    .trim()
    .toLowerCase();

  if (rawMode === "manual" || rawMode === "manifest" || rawMode === "hybrid") {
    return rawMode;
  }

  return "hybrid";
}

export function normalizeTopologyName(value: string): string {
  return value.trim().toLowerCase();
}

export function uniqueStrings(values: Iterable<string>): string[] {
  const next = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTopologyName(value);
    if (normalized) next.add(normalized);
  }
  return Array.from(next);
}

export function buildTopologyLocalManifestPath(
  workingDirectory: string,
  fileName = DEFAULT_TOPOLOGY_LOCAL_FILE,
): string {
  const trimmed = workingDirectory.trim();
  if (!trimmed) return fileName;
  const separator = /[\\/]$/.test(trimmed) ? "" : "/";
  return `${trimmed}${separator}${fileName}`;
}

export function inferServiceAliases(
  service: Microservice,
  manifest: NormalizedTopologyManifest | null,
): string[] {
  const directoryName = service.workingDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return uniqueStrings([
    manifest?.serviceName ?? "",
    manifest?.displayName ?? "",
    service.name,
    directoryName,
  ]);
}

export function inferStylePlusPortHint(
  service: Pick<Microservice, "kind" | "name" | "workingDirectory">,
): number | null {
  if (service.kind === "worker") return null;

  const directoryName = service.workingDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const candidates = uniqueStrings([service.name, directoryName]);

  for (const candidate of candidates) {
    for (const hint of STYLEPLUS_PORT_HINTS) {
      if (hint.aliases.some((alias) => matchesStylePlusAlias(candidate, alias))) {
        return hint.port;
      }
    }
  }

  return null;
}

export function listTopologyRuntimes(runtimeMap: TopologyRuntimeMap | null | undefined) {
  if (!runtimeMap) return [] as Array<[TopologyRuntimeKey, TopologyRuntimeManifest]>;

  return TOPOLOGY_RUNTIME_KEYS
    .map((runtimeKey) => {
      const runtime = runtimeMap[runtimeKey];
      return runtime ? [runtimeKey, runtime] as const : null;
    })
    .filter((entry): entry is [TopologyRuntimeKey, TopologyRuntimeManifest] => entry != null);
}

export function summarizeTopologyRuntimes(
  runtimeMap: TopologyRuntimeMap | null | undefined,
): TopologyRuntimeManifest | null {
  const entries = listTopologyRuntimes(runtimeMap);
  if (entries.length === 0) return null;

  const ready = entries.every(([, runtime]) => runtime.ready);
  const uniqueStatuses = Array.from(new Set(entries.map(([, runtime]) => runtime.status.trim()).filter(Boolean)));
  const status = uniqueStatuses.length <= 1
    ? (uniqueStatuses[0] ?? (ready ? "up" : "down"))
    : (ready ? "up" : entries.some(([, runtime]) => runtime.ready) ? "degraded" : "down");

  return {
    status,
    ready,
    checks: entries.flatMap(([runtimeKey, runtime]) =>
      runtime.checks.map((check) => ({
        name: `${runtimeKey}.${check.name}`,
        status: check.status,
      }))
    ),
  };
}

export function isServiceReady(
  topologyService: ResolvedTopologyService,
  runtimeKey: TopologyRuntimeKey | null = null,
): boolean {
  const runtimeStatus = topologyService.service.status;
  if (runtimeStatus !== "running" && runtimeStatus !== "external") {
    return false;
  }

  if (topologyService.loadSource === "http") {
    const runtime = getResolvedRuntime(topologyService, runtimeKey);
    if (runtime != null) return runtime.ready;

    if (runtimeKey != null && listTopologyRuntimes(topologyService.runtimes).length > 0) {
      return false;
    }

    const summaryRuntime = getResolvedRuntime(topologyService, null);
    if (summaryRuntime != null) return summaryRuntime.ready;
  }

  return true;
}

export function buildEmptyTopologyGraph(mode: TopologySourceMode): TopologyGraphSnapshot {
  return {
    servicesById: {},
    edges: [],
    mode,
    manifestServiceCount: 0,
    legacyServiceCount: 0,
    lastRecomputedAt: null,
  };
}

function matchesStylePlusAlias(candidate: string, alias: string): boolean {
  const normalizedAlias = normalizeTopologyName(alias);
  return candidate === normalizedAlias
    || candidate.startsWith(`${normalizedAlias}-`)
    || candidate.endsWith(`-${normalizedAlias}`);
}

function getResolvedRuntime(
  topologyService: Pick<ResolvedTopologyService, "runtime" | "runtimes">,
  runtimeKey: TopologyRuntimeKey | null,
): TopologyRuntimeManifest | null {
  if (runtimeKey != null) {
    const runtime = topologyService.runtimes?.[runtimeKey];
    if (runtime != null) return runtime;
    return topologyService.runtimes ? null : topologyService.runtime;
  }

  return topologyService.runtime ?? summarizeTopologyRuntimes(topologyService.runtimes);
}
