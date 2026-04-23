import type { Microservice } from "@/lib/domain/models";
import {
  DEFAULT_TOPOLOGY_ENDPOINT_PATH,
  DEFAULT_TOPOLOGY_LOCAL_FILE,
  NormalizedTopologyManifest,
  TopologyDependency,
  TopologyHealthManifest,
  TopologyLoadResult,
  TopologyManifestKind,
  TopologyRuntimeCheck,
  TopologyRuntimeKey,
  TopologyRuntimeMap,
  TopologyRuntimeManifest,
  TOPOLOGY_RUNTIME_KEYS,
  buildTopologyLocalManifestPath,
  inferStylePlusPortHint,
  summarizeTopologyRuntimes,
} from "./types";

const DEFAULT_TOPOLOGY_TIMEOUT_MS = 1_500;

interface TopologyLoaderOptions {
  endpointPath?: string;
  localManifestFileName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  loadHttpImpl?: (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>;
  readLocalManifest: (serviceId: string) => Promise<string | null>;
}

export interface TopologyLoader {
  loadServiceTopology: (service: Microservice) => Promise<TopologyLoadResult>;
}

export function createTopologyLoader(options: TopologyLoaderOptions): TopologyLoader {
  const endpointPath = options.endpointPath ?? DEFAULT_TOPOLOGY_ENDPOINT_PATH;
  const localManifestFileName = options.localManifestFileName ?? DEFAULT_TOPOLOGY_LOCAL_FILE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOPOLOGY_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl
    ? ((input: RequestInfo | URL, init?: RequestInit) => options.fetchImpl!.call(globalThis, input, init))
    : globalThis.fetch.bind(globalThis);

  return {
    async loadServiceTopology(service) {
      const attemptedAt = new Date().toISOString();
      const warnings: string[] = [];
      const localManifestPath = buildTopologyLocalManifestPath(
        service.workingDirectory,
        localManifestFileName,
      );

      const endpointUrls = buildTopologyEndpointUrls(service, endpointPath);
      let endpointUrl = endpointUrls[0] ?? null;

      for (const candidateUrl of endpointUrls) {
        endpointUrl = candidateUrl;
        const httpResult = await loadFromHttp({
          service,
          attemptedAt,
          endpointUrl: candidateUrl,
          timeoutMs,
          fetchImpl,
          loadHttpImpl: options.loadHttpImpl,
          localManifestPath,
        });

        if (httpResult.status === "success") {
          return {
            ...httpResult,
            warnings,
          };
        }

        if (httpResult.error) warnings.push(httpResult.error);
      }

      const localManifestRaw = await options.readLocalManifest(service.id);
      if (localManifestRaw != null) {
        const validation = parseTopologyManifest(localManifestRaw);
        if (validation.ok) {
          return {
            serviceId: service.id,
            status: "success",
            attemptedAt,
            source: "file",
            manifest: validation.manifest,
            rawManifest: localManifestRaw,
            endpointUrl,
            localManifestPath,
            warnings,
            error: null,
          };
        }

        return {
          serviceId: service.id,
          status: "invalid",
          attemptedAt,
          source: "file",
          manifest: null,
          rawManifest: localManifestRaw,
          endpointUrl,
          localManifestPath,
          warnings,
          error: `Local topology manifest is invalid: ${validation.error}`,
        };
      }

      return {
        serviceId: service.id,
        status: endpointUrl ? "error" : "missing",
        attemptedAt,
        source: null,
        manifest: null,
        rawManifest: null,
        endpointUrl,
        localManifestPath,
        warnings,
        error: endpointUrl
          ? "Topology endpoint was unavailable and no local manifest fallback exists."
          : "No topology endpoint or local manifest available for this service.",
      };
    },
  };
}

async function loadFromHttp(args: {
  service: Microservice;
  attemptedAt: string;
  endpointUrl: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  loadHttpImpl?: (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>;
  localManifestPath: string;
}): Promise<TopologyLoadResult> {
  try {
    const response = args.loadHttpImpl
      ? await loadResponseFromBridge(args.endpointUrl, args.timeoutMs, args.loadHttpImpl)
      : await loadResponseFromFetch(args.endpointUrl, args.timeoutMs, args.fetchImpl);

    if (!response.ok) {
      return {
        serviceId: args.service.id,
        status: "error",
        attemptedAt: args.attemptedAt,
        source: "http",
        manifest: null,
        rawManifest: null,
        endpointUrl: args.endpointUrl,
        localManifestPath: args.localManifestPath,
        warnings: [],
        error: `Topology endpoint responded with HTTP ${response.status}.`,
      };
    }

    const rawManifest = await response.text();
    const validation = parseTopologyManifest(rawManifest);

    if (!validation.ok) {
      return {
        serviceId: args.service.id,
        status: "invalid",
        attemptedAt: args.attemptedAt,
        source: "http",
        manifest: null,
        rawManifest,
        endpointUrl: args.endpointUrl,
        localManifestPath: args.localManifestPath,
        warnings: [],
        error: `Topology endpoint returned an invalid manifest: ${validation.error}`,
      };
    }

    return {
      serviceId: args.service.id,
      status: "success",
      attemptedAt: args.attemptedAt,
      source: "http",
      manifest: validation.manifest,
      rawManifest,
      endpointUrl: args.endpointUrl,
      localManifestPath: args.localManifestPath,
      warnings: [],
      error: null,
    };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? `Topology endpoint timed out after ${args.timeoutMs} ms.`
      : `Topology endpoint request failed: ${String(error)}`;

    return {
      serviceId: args.service.id,
      status: "error",
      attemptedAt: args.attemptedAt,
      source: "http",
      manifest: null,
      rawManifest: null,
      endpointUrl: args.endpointUrl,
      localManifestPath: args.localManifestPath,
      warnings: [],
      error: message,
    };
  }
}

async function loadResponseFromFetch(
  endpointUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(endpointUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadResponseFromBridge(
  endpointUrl: string,
  timeoutMs: number,
  loadHttpImpl: (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>,
): Promise<Response> {
  const result = await loadHttpImpl(endpointUrl, timeoutMs);
  return new Response(result.body, {
    status: result.status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildTopologyEndpointUrls(service: Microservice, endpointPath: string): string[] {
  const normalizedPath = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  const candidatePorts = uniqueNumbers([
    service.detectedPort,
    service.expectedPort,
    inferStylePlusPortHint(service),
  ]);
  const hosts = ["127.0.0.1", "localhost"];
  const urls: string[] = [];

  for (const port of candidatePorts) {
    for (const host of hosts) {
      urls.push(`http://${host}:${port}${normalizedPath}`);
    }
  }

  return urls;
}

type ParseTopologyResult =
  | { ok: true; manifest: NormalizedTopologyManifest }
  | { ok: false; error: string };

export function parseTopologyManifest(rawManifest: string): ParseTopologyResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawManifest);
  } catch (error) {
    return { ok: false, error: `JSON parse error: ${String(error)}` };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Manifest root must be a JSON object." };
  }

  const payload = unwrapTopologyPayload(parsed);
  const serviceName = getRequiredString(payload.manifest.serviceName, "serviceName");
  if (!serviceName.ok) return serviceName;

  const kind = parseKind(payload.manifest.kind);
  if (!kind.ok) return kind;

  const dependsOn = parseDependencies(payload.manifest.dependsOn);
  if (!dependsOn.ok) return dependsOn;

  const displayName = getOptionalString(payload.manifest.displayName) ?? serviceName.value;
  const port = getOptionalNumber(payload.manifest.port);
  const health = parseHealth(payload.manifest.health);
  if (!health.ok) return health;
  const runtime = parseRuntimePayload(payload.runtime, payload.manifest.runtimes);
  if (!runtime.ok) return runtime;

  return {
    ok: true,
    manifest: {
      serviceName: serviceName.value,
      displayName,
      kind: kind.kind,
      port,
      health: health.health,
      dependsOn: dependsOn.dependencies,
      runtime: runtime.runtime,
      runtimes: runtime.runtimes,
    },
  };
}

function unwrapTopologyPayload(root: Record<string, unknown>): {
  manifest: Record<string, unknown>;
  runtime: unknown;
} {
  if (isRecord(root.manifest)) {
    return {
      manifest: root.manifest,
      runtime: root.runtime ?? root.manifest.runtime ?? null,
    };
  }

  return {
    manifest: root,
    runtime: root.runtime ?? null,
  };
}

function parseKind(value: unknown): { ok: true; kind: TopologyManifestKind } | { ok: false; error: string } {
  const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (kind === "api" || kind === "service") return { ok: true, kind: "api" };
  if (kind === "worker") return { ok: true, kind: "worker" };
  if (kind === "hybrid") return { ok: true, kind: "hybrid" };
  return { ok: false, error: "kind is required and must be `api`, `worker` or `hybrid`." };
}

function parseHealth(value: unknown): { ok: true; health: TopologyHealthManifest | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, health: null };
  if (!isRecord(value)) return { ok: false, error: "health must be an object when present." };
  return {
    ok: true,
    health: {
      summary: getOptionalString(value.summary),
      live: getOptionalString(value.live),
      ready: getOptionalString(value.ready),
    },
  };
}

function parseRuntimePayload(
  runtimeValue: unknown,
  runtimesValue: unknown,
): { ok: true; runtime: TopologyRuntimeManifest | null; runtimes: TopologyRuntimeMap | null } | { ok: false; error: string } {
  const runtime = parseRuntimeSummary(runtimeValue, "runtime");
  if (!runtime.ok) return runtime;

  const embeddedRuntimes = parseRuntimeMap(runtimeValue, "runtime", true);
  if (!embeddedRuntimes.ok) return embeddedRuntimes;

  const explicitRuntimes = parseRuntimeMap(runtimesValue, "runtimes", false);
  if (!explicitRuntimes.ok) return explicitRuntimes;

  const runtimes = mergeRuntimeMaps(embeddedRuntimes.runtimes, explicitRuntimes.runtimes);
  return {
    ok: true,
    runtime: runtime.runtime ?? summarizeTopologyRuntimes(runtimes),
    runtimes,
  };
}

function parseRuntimeSummary(
  value: unknown,
  fieldName: string,
): { ok: true; runtime: TopologyRuntimeManifest | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, runtime: null };
  if (!isRecord(value)) return { ok: false, error: `${fieldName} must be an object when present.` };

  const hasSummaryFields = value.status != null || value.ready != null || value.checks != null;
  if (!hasSummaryFields) {
    return { ok: true, runtime: null };
  }

  const status = getRequiredString(value.status, `${fieldName}.status`);
  if (!status.ok) return status;
  if (typeof value.ready !== "boolean") {
    return { ok: false, error: `${fieldName}.ready must be a boolean.` };
  }

  const checksValue = value.checks;
  if (checksValue != null && !Array.isArray(checksValue)) {
    return { ok: false, error: `${fieldName}.checks must be an array when present.` };
  }

  const checks: TopologyRuntimeCheck[] = [];
  for (const [index, rawCheck] of (checksValue ?? []).entries()) {
    if (!isRecord(rawCheck)) {
      return { ok: false, error: `${fieldName}.checks[${index}] must be an object.` };
    }
    const name = getRequiredString(rawCheck.name, `${fieldName}.checks[${index}].name`);
    if (!name.ok) return name;
    const checkStatus = getRequiredString(rawCheck.status, `${fieldName}.checks[${index}].status`);
    if (!checkStatus.ok) return checkStatus;
    checks.push({ name: name.value, status: checkStatus.value });
  }

  return {
    ok: true,
    runtime: {
      status: status.value,
      ready: value.ready,
      checks,
    },
  };
}

function parseRuntimeMap(
  value: unknown,
  fieldName: string,
  allowSummaryOnly: boolean,
): { ok: true; runtimes: TopologyRuntimeMap | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, runtimes: null };
  if (Array.isArray(value)) {
    return parseRuntimeArray(value, fieldName);
  }
  if (!isRecord(value)) return { ok: false, error: `${fieldName} must be an object or array when present.` };

  let foundRuntime = false;
  const runtimes: TopologyRuntimeMap = {};

  for (const runtimeKey of TOPOLOGY_RUNTIME_KEYS) {
    const runtimeValue = value[runtimeKey];
    if (runtimeValue == null) continue;

    const runtime = parseRuntimeSummary(runtimeValue, `${fieldName}.${runtimeKey}`);
    if (!runtime.ok) return runtime;
    if (runtime.runtime == null) {
      return {
        ok: false,
        error: `${fieldName}.${runtimeKey} must include status, ready and optional checks.`,
      };
    }

    runtimes[runtimeKey] = runtime.runtime;
    foundRuntime = true;
  }

  if (!foundRuntime) {
    return allowSummaryOnly
      ? { ok: true, runtimes: null }
      : { ok: false, error: `${fieldName} must declare at least one of \`api\` or \`worker\`.` };
  }

  return { ok: true, runtimes };
}

function parseRuntimeArray(
  value: unknown[],
  fieldName: string,
): { ok: true; runtimes: TopologyRuntimeMap | null } | { ok: false; error: string } {
  const runtimes: TopologyRuntimeMap = {};

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      return { ok: false, error: `${fieldName}[${index}] must be an object.` };
    }

    const runtimeKind = parseRuntimeDescriptorKind(item.kind, `${fieldName}[${index}].kind`);
    if (!runtimeKind.ok) return runtimeKind;

    const runtime = parseRuntimeSummary(item, `${fieldName}[${index}]`);
    if (!runtime.ok) return runtime;

    if (runtime.runtime != null) {
      runtimes[runtimeKind.kind] = runtime.runtime;
    }
  }

  return { ok: true, runtimes: Object.keys(runtimes).length > 0 ? runtimes : null };
}

function parseRuntimeDescriptorKind(
  value: unknown,
  fieldName: string,
): { ok: true; kind: TopologyRuntimeKey } | { ok: false; error: string } {
  const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (kind === "api" || kind === "service") return { ok: true, kind: "api" };
  if (kind === "worker") return { ok: true, kind: "worker" };
  return { ok: false, error: `${fieldName} must be \`api\` or \`worker\`.` };
}

function parseDependencies(value: unknown): { ok: true; dependencies: TopologyDependency[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "dependsOn is required and must be an array." };
  }

  const dependencies: TopologyDependency[] = [];

  for (const [index, dependency] of value.entries()) {
    if (!isRecord(dependency)) {
      return { ok: false, error: `dependsOn[${index}] must be an object.` };
    }
    const type = getRequiredString(dependency.type, `dependsOn[${index}].type`);
    if (!type.ok) return type;

    switch (type.value) {
      case "http": {
        const service = getRequiredString(dependency.service, `dependsOn[${index}].service`);
        if (!service.ok) return service;
        const required = dependency.required == null ? true : Boolean(dependency.required);
        const direction = typeof dependency.direction === "string" ? dependency.direction.trim().toLowerCase() : "";
        if (direction !== "outbound" && direction !== "inbound") {
          return {
            ok: false,
            error: `dependsOn[${index}].direction must be \`outbound\` or \`inbound\`.`,
          };
        }
        dependencies.push({
          type: "http",
          service: service.value,
          required,
          direction,
        });
        break;
      }
      case "rabbitPublish": {
        const exchange = getRequiredString(dependency.exchange, `dependsOn[${index}].exchange`);
        if (!exchange.ok) return exchange;
        const routingKeys = parseRoutingKeys(
          dependency.routingKeys,
          `dependsOn[${index}].routingKeys`,
        );
        if (!routingKeys.ok) return routingKeys;
        dependencies.push({
          type: "rabbitPublish",
          exchange: exchange.value,
          routingKeys: routingKeys.routingKeys,
        });
        break;
      }
      case "rabbitConsume": {
        const exchange = getRequiredString(dependency.exchange, `dependsOn[${index}].exchange`);
        if (!exchange.ok) return exchange;
        const queue = getRequiredString(dependency.queue, `dependsOn[${index}].queue`);
        if (!queue.ok) return queue;
        const routingKeys = parseRoutingKeys(
          dependency.routingKeys,
          `dependsOn[${index}].routingKeys`,
        );
        if (!routingKeys.ok) return routingKeys;
        dependencies.push({
          type: "rabbitConsume",
          exchange: exchange.value,
          queue: queue.value,
          routingKeys: routingKeys.routingKeys,
        });
        break;
      }
      default:
        return {
          ok: false,
          error: `dependsOn[${index}].type must be http, rabbitPublish or rabbitConsume.`,
        };
    }
  }

  return { ok: true, dependencies };
}

function parseRoutingKeys(
  value: unknown,
  fieldName: string,
): { ok: true; routingKeys: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an array.` };
  }
  const routingKeys: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return { ok: false, error: `${fieldName}[${index}] must be a non-empty string.` };
    }
    routingKeys.push(item.trim());
  }
  return { ok: true, routingKeys };
}

function getRequiredString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${fieldName} is required and must be a non-empty string.` };
  }
  return { ok: true, value: value.trim() };
}

function getOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function mergeRuntimeMaps(
  embedded: TopologyRuntimeMap | null,
  explicit: TopologyRuntimeMap | null,
): TopologyRuntimeMap | null {
  const merged: TopologyRuntimeMap = {};

  for (const runtimeKey of TOPOLOGY_RUNTIME_KEYS) {
    const runtime = explicit?.[runtimeKey] ?? embedded?.[runtimeKey];
    if (runtime) {
      merged[runtimeKey] = runtime;
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  const next = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      next.add(value);
    }
  }
  return Array.from(next);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
