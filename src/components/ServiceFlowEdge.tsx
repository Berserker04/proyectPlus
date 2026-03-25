import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import type { ProjectTopologyEdge } from "@/lib/domain/models";
import { getFloatingEdgeGeometry } from "@/lib/ui/flowGeometry";
import { formatEdgeTelemetry, getEdgeToneColor } from "@/lib/ui/serviceGraph";

export interface ServiceFlowEdgeData {
  edge: ProjectTopologyEdge;
}

export function ServiceFlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ServiceFlowEdgeData>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const geometry = sourceNode && targetNode ? getFloatingEdgeGeometry(sourceNode, targetNode) : null;

  const telemetry = formatEdgeTelemetry(data?.edge.telemetry);
  const strokeColor = getEdgeToneColor(telemetry.tone);
  const markerId = `service-flow-edge-arrow-${id}`;
  const [path] = getBezierPath({
    sourceX: geometry?.sourceX ?? sourceX,
    sourceY: geometry?.sourceY ?? sourceY,
    sourcePosition: geometry?.sourcePosition ?? sourcePosition,
    targetX: geometry?.targetX ?? targetX,
    targetY: geometry?.targetY ?? targetY,
    targetPosition: geometry?.targetPosition ?? targetPosition,
  });

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="14"
          markerHeight="14"
          viewBox="0 0 14 14"
          refX="11.25"
          refY="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 1 1 L 13 7 L 1 13 z" fill={strokeColor} />
        </marker>
      </defs>

      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#${markerId})`}
        interactionWidth={32}
        className={`service-flow-edge service-flow-edge-${telemetry.tone}${selected ? " is-selected" : ""}`}
      />
    </>
  );
}
