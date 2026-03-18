import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { ProjectTopologyEdge } from "@/lib/domain/models";
import { formatEdgeTelemetry } from "@/lib/ui/serviceGraph";

export interface ServiceFlowEdgeData {
  edge: ProjectTopologyEdge;
  sourceName: string;
  targetName: string;
  onEdit: (edge: ProjectTopologyEdge) => void;
  onDelete: (edgeId: string) => void;
}

export function ServiceFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ServiceFlowEdgeData>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const telemetry = formatEdgeTelemetry(data?.edge.telemetry);
  const edgeLabel = data?.edge.label ?? `${data?.sourceName ?? "Source"} -> ${data?.targetName ?? "Target"}`;

  return (
    <>
      <BaseEdge id={id} path={path} className={`service-flow-edge service-flow-edge-${telemetry.tone}${selected ? " is-selected" : ""}`} />
      <EdgeLabelRenderer>
        <div
          className={`service-edge-label service-edge-label-${telemetry.tone}${selected ? " is-selected" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <div className="service-edge-heading">
            <strong>{edgeLabel}</strong>
            <span>{data?.sourceName}{" -> "}{data?.targetName}</span>
          </div>
          <div className="service-edge-metrics">
            <span>{telemetry.requests}</span>
            <span>{telemetry.latency}</span>
            <span>{telemetry.errors}</span>
          </div>
          <div className="service-edge-actions">
            <button type="button" onClick={() => data?.onEdit(data.edge)}>Rename</button>
            <button type="button" onClick={() => data?.onDelete(id)}>Remove</button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
