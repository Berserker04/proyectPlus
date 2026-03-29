import { useState } from "react";
import type { Microservice, ServiceStatus } from "@/lib/domain/models";

export const statusLabel: Record<ServiceStatus, string> = {
  running: "Activo",
  starting: "Iniciando",
  stopped: "Detenido",
  error: "Error",
  external: "Externo",
};

export const statusColor: Record<ServiceStatus, string> = {
  running: "var(--status-running)",
  starting: "var(--status-starting)",
  stopped: "var(--status-stopped)",
  error: "var(--status-error)",
  external: "var(--status-external)",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

export interface ServiceCardProps {
  svc: Microservice;
  isFocused: boolean;
  onFocus: () => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLogs: () => void;
  onFolder: () => void;
  onTerminal: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isDragged?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function ServiceCard({
  svc,
  isFocused,
  onFocus,
  onRun,
  onStop,
  onRestart,
  onEdit,
  onDelete,
  onLogs,
  onFolder,
  onTerminal,
  onMoveUp,
  onMoveDown,
  isDragged,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ServiceCardProps) {
  const isExternal = svc.status === "external";
  const isStartable = svc.status === "stopped" || (svc.status === "error" && svc.pid == null);
  const isStoppable = svc.status === "running" || svc.status === "starting" || (svc.status === "error" && svc.pid != null);

  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className={`service-card${isFocused ? " focused" : ""}${isDragged ? " dragged" : ""}${isDragOver ? " drag-over" : ""}`}
      onClick={onFocus}
      draggable
      onDragStart={onDragStart}
      onDragEnter={(e) => {
        e.preventDefault();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
        if (onDragOver) onDragOver(e);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (onDrop) onDrop(e);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="sc-header">
        <div className="sc-name-row">
          <span className="status-dot" style={{ background: statusColor[svc.status] }} />
          <span className="sc-name">{svc.name}</span>
          <span className={`sc-status-badge sc-status-${svc.status}`}>{statusLabel[svc.status]}</span>
        </div>
        <div className="sc-meta">
          {svc.pid && <span className="sc-chip">PID {svc.pid}</span>}
          {svc.detectedPort && <span className="sc-chip">:{svc.detectedPort}</span>}
        </div>
      </div>

      <div className="sc-metrics">
        <div className="sc-metric">
          <span className="metric-label">CPU</span>
          <span className="metric-value">{formatPercent(svc.cpuPercent)}</span>
        </div>
        <div className="sc-metric">
          <span className="metric-label">RAM</span>
          <span className="metric-value">{formatBytes(svc.memoryBytes)}</span>
        </div>
        <div className="sc-metric sc-metric-wide">
          <span className="metric-label">Directorio</span>
          <span className="metric-value metric-path" title={svc.workingDirectory}>
            {svc.workingDirectory.split(/[\\/]/).pop() ?? svc.workingDirectory}
          </span>
        </div>
      </div>

      {svc.issue && (
        <div className="sc-issue">⚠ {svc.issue.title}: {svc.issue.message}</div>
      )}

      {isExternal && (
        <div className="sc-external-notice">
          🔌 Proceso externo detectado en el puerto {svc.detectedPort}. Iniciado fuera de la app.
        </div>
      )}

      <div className="sc-actions">
        <div className="sc-actions-runtime">
          <button className="btn-icon-run" title="Correr" disabled={!isStartable || isExternal} onClick={(e) => { e.stopPropagation(); onRun(); }}>▶</button>
          <button className="btn-icon-stop" title="Detener" disabled={!isStoppable || isExternal} onClick={(e) => { e.stopPropagation(); onStop(); }}>■</button>
          <button className="btn-icon-restart" title="Reiniciar" disabled={isExternal || svc.status === "starting"} onClick={(e) => { e.stopPropagation(); onRestart(); }}>↺</button>
        </div>
        <div className="sc-actions-util">
          <button className="icon-btn" title="Subir orden" onClick={(e) => { e.stopPropagation(); onMoveUp(); }}>↑</button>
          <button className="icon-btn" title="Bajar orden" onClick={(e) => { e.stopPropagation(); onMoveDown(); }}>↓</button>
          <button className="icon-btn" title="Logs" onClick={(e) => { e.stopPropagation(); onLogs(); }}>📄</button>
          <button className="icon-btn" title="Abrir carpeta" onClick={(e) => { e.stopPropagation(); onFolder(); }}>📂</button>
          <button className="icon-btn" title="Abrir terminal" onClick={(e) => { e.stopPropagation(); onTerminal(); }}>💻</button>
          <button className="icon-btn" title="Editar" onClick={(e) => { e.stopPropagation(); onEdit(); }}>✏</button>
          <button className="icon-btn danger" title="Eliminar" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
        </div>
      </div>
    </div>
  );
}
