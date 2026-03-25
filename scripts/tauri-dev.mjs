import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const repoRootNormalized = repoRoot.toLowerCase();
const appBinaryPath = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "debug",
  "ms-control-center.exe",
).toLowerCase();
const devPort = 1420;
const shellWrapperNames = new Set(["cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe"]);
const devProcessMarkers = [
  "tauri:dev",
  "tauri:dev:raw",
  "tauri dev",
  "run dev",
  "vite",
];

function psString(value) {
  return value.replace(/'/g, "''");
}

function runPowerShell(script, { allowEmpty = true } = {}) {
  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stdout = error.stdout?.toString().trim();
    const stderr = error.stderr?.toString().trim();
    if (allowEmpty && !stdout && !stderr) {
      return "";
    }

    throw new Error(stderr || stdout || error.message);
  }
}

function parseJsonOutput(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeProcessInfo(processInfo) {
  if (!processInfo) return null;

  const processId = Number(processInfo.ProcessId ?? processInfo.processId ?? 0);
  if (!processId) return null;

  return {
    processId,
    parentProcessId: Number(processInfo.ParentProcessId ?? processInfo.parentProcessId ?? 0),
    name: processInfo.Name ?? processInfo.name ?? "",
    executablePath: processInfo.ExecutablePath ?? processInfo.executablePath ?? "",
    commandLine: processInfo.CommandLine ?? processInfo.commandLine ?? "",
  };
}

function normalizeProcessList(processes) {
  return processes.map((processInfo) => normalizeProcessInfo(processInfo)).filter(Boolean);
}

function findRepoDesktopProcesses() {
  const script = `
    $path = '${psString(appBinaryPath)}'
    $items = Get-CimInstance Win32_Process -Filter "Name = 'ms-control-center.exe'" |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower() -eq $path } |
      Select-Object ProcessId, Name, ExecutablePath

    if ($items) {
      $items | ConvertTo-Json -Compress
    }
  `;

  return normalizeProcessList(parseJsonOutput(runPowerShell(script)));
}

function findPortListeners(port) {
  const script = `
    $items = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue |
      Select-Object OwningProcess, LocalAddress, LocalPort

    if ($items) {
      $items | ConvertTo-Json -Compress
    }
  `;

  return parseJsonOutput(runPowerShell(script));
}

function listProcesses() {
  const script = `
    Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine |
      ConvertTo-Json -Compress
  `;

  return normalizeProcessList(parseJsonOutput(runPowerShell(script)));
}

function stopProcess(processId) {
  try {
    execFileSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stdout = error.stdout?.toString().trim();
    const stderr = error.stderr?.toString().trim();
    const output = `${stdout}\n${stderr}`.trim().toLowerCase();

    if (
      output.includes("not found") ||
      output.includes("no se encontr") ||
      output.includes("there is no running instance")
    ) {
      return;
    }

    throw error;
  }
}

function isRepoOwnedProcess(processInfo) {
  if (!processInfo) return false;

  const executablePath = processInfo.executablePath?.toLowerCase() ?? "";
  const commandLine = processInfo.commandLine?.toLowerCase() ?? "";

  return (
    executablePath.includes(repoRootNormalized) || commandLine.includes(repoRootNormalized)
  );
}

function isRepoDesktopProcess(processInfo) {
  if (!processInfo) return false;

  const executablePath = processInfo.executablePath?.toLowerCase() ?? "";
  return executablePath === appBinaryPath;
}

function hasDevProcessMarker(processInfo) {
  const commandLine = processInfo.commandLine?.toLowerCase() ?? "";
  return devProcessMarkers.some((marker) => commandLine.includes(marker));
}

function isShellWrapperProcess(processInfo) {
  const name = processInfo.name?.toLowerCase() ?? "";
  return shellWrapperNames.has(name);
}

function isRepoOwnedDevProcess(processInfo) {
  return isRepoOwnedProcess(processInfo) && hasDevProcessMarker(processInfo);
}

function createProcessLookup(processes) {
  return new Map(processes.map((processInfo) => [processInfo.processId, processInfo]));
}

function createChildrenLookup(processes) {
  const children = new Map();

  for (const processInfo of processes) {
    const siblings = children.get(processInfo.parentProcessId) ?? [];
    siblings.push(processInfo);
    children.set(processInfo.parentProcessId, siblings);
  }

  return children;
}

function collectAncestorIds(processId, processLookup) {
  const ancestorIds = [];
  const visited = new Set();
  let current = processLookup.get(processId) ?? null;

  while (current && !visited.has(current.processId)) {
    ancestorIds.push(current.processId);
    visited.add(current.processId);

    if (!current.parentProcessId) break;
    current = processLookup.get(current.parentProcessId) ?? null;
  }

  return ancestorIds;
}

function collectDescendantIds(processId, childrenLookup) {
  const descendantIds = [];
  const visited = new Set();
  const queue = [...(childrenLookup.get(processId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.processId)) continue;

    descendantIds.push(current.processId);
    visited.add(current.processId);
    queue.push(...(childrenLookup.get(current.processId) ?? []));
  }

  return descendantIds;
}

function findRelatedRepoDevRoots(processId, processLookup, childrenLookup) {
  const owner = processLookup.get(processId) ?? null;
  if (!owner) return [];

  const connectedIds = new Set([
    ...collectAncestorIds(processId, processLookup),
    ...collectDescendantIds(processId, childrenLookup),
  ]);
  const connectedProcesses = [...connectedIds]
    .map((id) => processLookup.get(id))
    .filter(Boolean);
  const hasRepoOwnedDevMember = connectedProcesses.some(
    (processInfo) => isRepoOwnedDevProcess(processInfo) || isRepoDesktopProcess(processInfo),
  );

  if (!hasRepoOwnedDevMember) {
    return [];
  }

  const candidateProcesses = connectedProcesses.filter((processInfo) => {
    if (isRepoOwnedDevProcess(processInfo) || isRepoDesktopProcess(processInfo)) {
      return true;
    }

    return isShellWrapperProcess(processInfo) && hasDevProcessMarker(processInfo);
  });
  const candidateIds = new Set(candidateProcesses.map((processInfo) => processInfo.processId));

  return candidateProcesses
    .filter((processInfo) => !candidateIds.has(processInfo.parentProcessId))
    .sort((left, right) => left.processId - right.processId);
}

function cleanupRepoDesktopProcesses() {
  const processes = findRepoDesktopProcesses();
  for (const processInfo of processes) {
    console.log(`[tauri:dev] Stopping stale desktop process ${processInfo.processId}.`);
    stopProcess(processInfo.processId);
  }
}

function ensureDevPortIsUsable() {
  while (true) {
    const listeners = findPortListeners(devPort);
    if (listeners.length === 0) {
      return;
    }

    const processes = listProcesses();
    const processLookup = createProcessLookup(processes);
    const childrenLookup = createChildrenLookup(processes);
    let cleanedAnyListener = false;

    for (const listener of listeners) {
      const processId = Number(listener.OwningProcess ?? listener.owningProcess ?? 0);
      if (!processId) continue;

      const processInfo = processLookup.get(processId) ?? null;
      if (!processInfo) continue;

      const relatedRoots = findRelatedRepoDevRoots(processId, processLookup, childrenLookup);
      if (relatedRoots.length > 0) {
        for (const rootProcess of relatedRoots) {
          console.log(
            `[tauri:dev] Stopping stale dev process tree ${rootProcess.processId} (${rootProcess.name || "unknown"}) ` +
              `that still owns or parents port ${devPort}.`,
          );
          stopProcess(rootProcess.processId);
        }

        cleanedAnyListener = true;
        continue;
      }

      const executable = processInfo.executablePath || processInfo.name || "unknown process";
      throw new Error(
        `Port ${devPort} is already in use by PID ${processId} (${executable}). ` +
          "Free the port or stop that process before starting Tauri dev.",
      );
    }

    if (!cleanedAnyListener) {
      return;
    }
  }
}

function cleanupDevArtifacts() {
  cleanupRepoDesktopProcesses();
}

cleanupRepoDesktopProcesses();
ensureDevPortIsUsable();

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npx tauri dev"], {
        cwd: repoRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          RUST_BACKTRACE: process.env.RUST_BACKTRACE || "1",
        },
      })
    : spawn("npx", ["tauri", "dev"], {
        cwd: repoRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          RUST_BACKTRACE: process.env.RUST_BACKTRACE || "1",
        },
      });

let forwardedSignal = false;

function forwardSignal(signal) {
  if (forwardedSignal) return;
  forwardedSignal = true;
  child.kill(signal);
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  cleanupDevArtifacts();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  cleanupDevArtifacts();
  console.error(`[tauri:dev] Failed to start Tauri dev: ${error.message}`);
  process.exit(1);
});
