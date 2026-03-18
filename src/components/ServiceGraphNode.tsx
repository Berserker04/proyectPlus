import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Microservice, NodeTelemetryViewModel } from "@/lib/domain/models";
import {
  buildPressureTelemetry,
  formatBytes,
  formatPercent,
  getPressureLabel,
  getStatusLabel,
} from "@/lib/ui/serviceGraph";

export interface ServiceGraphNodeData {
  service: Microservice;
  telemetry: NodeTelemetryViewModel;
  onSelect: (serviceId: string) => void;
  onRun: (service: Microservice) => void;
  onStop: (service: Microservice) => void;
  onRestart: (service: Microservice) => void;
  onLogs: (service: Microservice) => void;
  onTerminal: (service: Microservice) => void;
  onEdit: (service: Microservice) => void;
  onDelete: (service: Microservice) => void;
}

function ServiceGraphNodeInner({ data, selected }: NodeProps<ServiceGraphNodeData>) {
  const { service } = data;
  const telemetry = data.telemetry ?? buildPressureTelemetry(service);
  const port = service.detectedPort ?? service.expectedPort;
  const isStopped = service.status === "stopped" || service.status === "error";
  const isRunning = service.status === "running";
  const isExternal = service.status === "external";

  return (
    <div
      className={`flow-node flow-node-${telemetry.pressureTone}${selected ? " is-selected" : ""}`}
      onClick={() => data.onSelect(service.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          data.onSelect(service.id);
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="flow-node-handle" />
      <div
        className="flow-node-liquid"
        style={{ ["--fill-level" as string]: `${Math.max(10, telemetry.pressureScore)}%` }}
      />

      <div className="flow-node-shell">
        <div className="flow-node-header">
          <div>
            <span className={`flow-kind-chip flow-kind-${service.kind}`}>{service.kind}</span>
            <h3>{service.name}</h3>
          </div>
          <div className="flow-node-state">
            <span className={`flow-state-dot flow-state-${telemetry.pressureTone}`} />
            <span>{getStatusLabel(service.status)}</span>
          </div>
        </div>

        <div className="flow-node-meta">
          <span>Port {port ?? "N/A"}</span>
          <span>PID {service.pid ?? "N/A"}</span>
          <span>{getPressureLabel(telemetry.pressureTone)}</span>
        </div>

        <div className="flow-node-metrics">
          <div className="flow-stat">
            <span>CPU</span>
            <strong>{formatPercent(service.cpuPercent)}</strong>
          </div>
          <div className="flow-stat">
            <span>RAM</span>
            <strong>{formatBytes(service.memoryBytes)}</strong>
          </div>
          <div className="flow-stat">
            <span>Runtime</span>
            <strong>{service.kind === "worker" ? "Worker loop" : "Microservice"}</strong>
          </div>
        </div>

        <div className="flow-node-path" title={service.workingDirectory}>
          {service.workingDirectory}
        </div>

        {service.issue && (
          <div className="flow-node-issue">
            <strong>{service.issue.title}</strong>
            <span>{service.issue.message}</span>
          </div>
        )}

        <div className="flow-node-actions">
          <div className="flow-node-runtime">
            <button
              className="flow-action primary"
              type="button"
              disabled={isRunning || isExternal}
              onClick={(event) => {
                event.stopPropagation();
                data.onRun(service);
              }}
            >
              Start
            </button>
            <button
              className="flow-action"
              type="button"
              disabled={isStopped || isExternal}
              onClick={(event) => {
                event.stopPropagation();
                data.onStop(service);
              }}
            >
              Stop
            </button>
            <button
              className="flow-action"
              type="button"
              disabled={isExternal}
              onClick={(event) => {
                event.stopPropagation();
                data.onRestart(service);
              }}
            >
              Restart
            </button>
          </div>

          <div className="flow-node-tools">
            <button
              className="flow-tool-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onLogs(service);
              }}
            >
              Logs
            </button>
            <button
              className="flow-tool-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onTerminal(service);
              }}
            >
              Shell
            </button>
            <button
              className="flow-tool-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onEdit(service);
              }}
            >
              Edit
            </button>
            <button
              className="flow-tool-btn danger"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onDelete(service);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="flow-node-handle" />
    </div>
  );
}

export const ServiceGraphNode = memo(ServiceGraphNodeInner);
