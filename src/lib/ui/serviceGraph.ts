import type {
  EdgeTelemetryViewModel,
  Microservice,
  NodeTelemetryViewModel,
  ServiceStatus,
} from "@/lib/domain/models";

export type EdgeTone = "idle" | "healthy" | "warning" | "critical";

const EDGE_TONE_COLORS: Record<EdgeTone, string> = {
  idle: "#5d7ca5",
  healthy: "#41f0a9",
  warning: "#f7c14d",
  critical: "#ff627d",
};

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatPercent(value: number): string {
  return `${Math.max(0, value).toFixed(1)}%`;
}

export function getStatusLabel(status: ServiceStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "stopped":
      return "Stopped";
    case "error":
      return "Unhealthy";
    case "external":
      return "External";
    default:
      return status;
  }
}

export function buildPressureTelemetry(service: Microservice): NodeTelemetryViewModel {
  const cpuScore = Math.min(100, Math.max(0, service.cpuPercent));
  const memoryGb = service.memoryBytes / (1024 * 1024 * 1024);
  const memoryScore = Math.min(100, memoryGb * 22);
  const baseScore = Math.max(cpuScore, memoryScore);

  let pressureScore = baseScore;
  if (service.status === "starting") pressureScore = Math.max(pressureScore, 52);
  if (service.status === "external") pressureScore = Math.max(pressureScore, 28);
  if (service.status === "stopped") pressureScore = 0;
  if (service.status === "error") pressureScore = 100;

  let pressureTone: NodeTelemetryViewModel["pressureTone"] = "healthy";
  if (service.status === "stopped") pressureTone = "idle";
  else if (service.status === "error") pressureTone = "critical";
  else if (pressureScore >= 90) pressureTone = "critical";
  else if (pressureScore >= 75) pressureTone = "pressure";
  else if (pressureScore >= 55) pressureTone = "warning";

  return {
    nodeId: service.id,
    status: service.status,
    pressureScore,
    pressureTone,
    cpuPercent: service.cpuPercent,
    memoryBytes: service.memoryBytes,
  };
}

export function getPressureLabel(tone: NodeTelemetryViewModel["pressureTone"]): string {
  switch (tone) {
    case "healthy":
      return "Stable";
    case "warning":
      return "Warm";
    case "pressure":
      return "Pressured";
    case "critical":
      return "Critical";
    case "idle":
      return "Idle";
    default:
      return "Idle";
  }
}

export function formatEdgeTelemetry(telemetry?: EdgeTelemetryViewModel | null) {
  if (!telemetry) {
    return {
      requests: "No traffic data",
      latency: "Latency pending",
      errors: "Error rate pending",
      tone: "idle" as EdgeTone,
    };
  }

  const requests = telemetry.requestsPerSecond != null
    ? `${telemetry.requestsPerSecond.toFixed(1)} rps`
    : "No traffic data";
  const latency = telemetry.p95LatencyMs != null
    ? `p95 ${telemetry.p95LatencyMs.toFixed(0)} ms`
    : telemetry.averageLatencyMs != null
      ? `avg ${telemetry.averageLatencyMs.toFixed(0)} ms`
      : "Latency pending";
  const errors = telemetry.errorRatePercent != null
    ? `${telemetry.errorRatePercent.toFixed(1)}% errors`
    : "Error rate pending";

  let tone: EdgeTone = "healthy";
  if ((telemetry.errorRatePercent ?? 0) >= 3) tone = "critical";
  else if ((telemetry.p95LatencyMs ?? 0) >= 800) tone = "critical";
  else if ((telemetry.errorRatePercent ?? 0) > 0.5 || (telemetry.p95LatencyMs ?? 0) >= 300) tone = "warning";
  else if ((telemetry.requestsPerSecond ?? 0) <= 0) tone = "idle";

  return { requests, latency, errors, tone };
}

export function getEdgeToneColor(tone: EdgeTone): string {
  return EDGE_TONE_COLORS[tone];
}
