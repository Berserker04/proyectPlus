import type { RefObject } from "react";
import type { Microservice, ServiceLogSnapshot, ServiceLogEntry } from "@/lib/domain/models";
import { LogMessage } from "@/components/LogMessage";
import { formatLogMetaTimestamp } from "@/lib/ui/logs";
import { statusColor } from "./ServiceCard";

interface LogsViewProps {
  services: Microservice[];
  focusedServiceId: string | null;
  logSnapshot: ServiceLogSnapshot | null;
  logFilter: "all" | "stdout" | "stderr";
  logQuery: string;
  isLogAutoscroll: boolean;
  visibleLogEntries: ServiceLogEntry[];
  onFocusService: (id: string) => void;
  onFilterChange: (filter: "all" | "stdout" | "stderr") => void;
  onQueryChange: (q: string) => void;
  onToggleAutoscroll: () => void;
  onCopyLogs: () => void;
  onClearLogs: () => void;
  logViewportRef: RefObject<HTMLDivElement | null>;
}

export function LogsView({
  services,
  focusedServiceId,
  logFilter,
  logQuery,
  isLogAutoscroll,
  visibleLogEntries,
  onFocusService,
  onFilterChange,
  onQueryChange,
  onToggleAutoscroll,
  onCopyLogs,
  onClearLogs,
  logViewportRef,
}: LogsViewProps) {
  const focusedService = services.find((s) => s.id === focusedServiceId) ?? null;

  return (
    <div className="view-logs">
      <div className="view-header">
        <div>
          <h1 className="view-title">Logs</h1>
          <p className="view-subtitle">{focusedService?.name ?? "Ningún servicio seleccionado"}</p>
        </div>
        <div className="logs-toolbar">
          <input
            className="search-input"
            placeholder="Buscar…"
            value={logQuery}
            onChange={(e) => onQueryChange(e.target.value)}
          />

          <div className="log-service-tabs" style={{ padding: 0, border: "none" }}>
            <button className={`log-tab ${logFilter === "all" ? "active" : ""}`} onClick={() => onFilterChange("all")}>Todo</button>
            <button className={`log-tab ${logFilter === "stdout" ? "active" : ""}`} onClick={() => onFilterChange("stdout")}>Stdout</button>
            <button className={`log-tab ${logFilter === "stderr" ? "active" : ""}`} onClick={() => onFilterChange("stderr")}>Stderr</button>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            <button className="btn-outline" onClick={onToggleAutoscroll}>
              {isLogAutoscroll ? "⏸ Pausar" : "▶ Reanudar"}
            </button>
            <button className="btn-outline" onClick={onCopyLogs} title="Copiar al portapapeles">
              📄 Copiar
            </button>
            <button className="btn-outline danger" onClick={onClearLogs}>
              Limpiar
            </button>
          </div>
        </div>
      </div>

      {/* Service picker */}
      {services.length > 0 && (
        <div className="log-service-tabs">
          {services.map((s) => (
            <button
              key={s.id}
              className={`log-tab${s.id === focusedServiceId ? " active" : ""}`}
              onClick={() => onFocusService(s.id)}
            >
              <span className="status-dot" style={{ background: statusColor[s.status] }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="log-viewport" ref={logViewportRef}>
        {visibleLogEntries.length === 0 && (
          <div className="log-empty">No hay entradas de log.</div>
        )}
        {visibleLogEntries
          .filter((e) => logFilter === "all" || e.stream === logFilter)
          .map((entry) => (
            <div key={entry.sequence} className={`log-entry log-${entry.level}`}>
              <span className="log-ts">{formatLogMetaTimestamp(entry.timestamp)}</span>
              <span className={`log-stream log-stream-${entry.stream}`}>{entry.stream}</span>
              <div className="log-msg">
                <LogMessage message={entry.message} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
