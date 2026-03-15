import type { ServiceRecord, ServiceStatus } from "@/lib/domain/models";

export function buildServiceTypeLabel(service: ServiceRecord) {
  return `${service.frameworkType} / ${service.runtimeType}`;
}

export function formatBytes(value: number) {
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

export function formatGpuUsage(service: ServiceRecord) {
  if (service.gpuPercent === null && service.gpuMemoryBytes === null) {
    return "No disponible";
  }

  if (service.gpuPercent !== null && service.gpuMemoryBytes !== null) {
    return `${service.gpuPercent.toFixed(0)}% / ${formatBytes(service.gpuMemoryBytes)}`;
  }

  if (service.gpuPercent !== null) {
    return `${service.gpuPercent.toFixed(0)}%`;
  }

  return formatBytes(service.gpuMemoryBytes ?? 0);
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatLogTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatUptime(value: number) {
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

export function formatExecutionTrigger(value: string) {
  switch (value) {
    case "restart":
      return "Reinicio";
    case "run":
      return "Arranque";
    default:
      return value || "Arranque";
  }
}

export function normalizeExecutionStatus(value: string): ServiceStatus {
  if (value === "running" || value === "starting" || value === "stopped" || value === "error") {
    return value;
  }

  return "error";
}

export function formatServiceStatus(value: ServiceStatus) {
  switch (value) {
    case "running":
      return "Activo";
    case "starting":
      return "Arrancando";
    case "stopped":
      return "Detenido";
    case "error":
      return "Error";
    default:
      return value;
  }
}
