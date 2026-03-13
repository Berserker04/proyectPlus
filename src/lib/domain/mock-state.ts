import type { DashboardSnapshot } from "./models";

export const fallbackSnapshot: DashboardSnapshot = {
  workspaces: [],
  services: [],
  system: {
    cpuTotalPercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    gpuTotalPercent: null,
    lastRefreshAt: new Date().toISOString(),
  },
};
