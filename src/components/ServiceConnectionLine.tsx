import { getBezierPath, type ConnectionLineComponentProps } from "@xyflow/react";
import { getPointerEdgeGeometry, getFloatingEdgeGeometry } from "@/lib/ui/flowGeometry";
import {
  getTopologyEdgeStyle,
} from "@/topology/topology-edge-style";
import type { TopologyEdgeVisualState } from "@/topology/types";

export function ServiceConnectionLine(props: ConnectionLineComponentProps) {
  const geometry = props.toNode
    ? getFloatingEdgeGeometry(props.fromNode, props.toNode)
    : getPointerEdgeGeometry(props.fromNode, props.pointer);

  const sourceX = geometry?.sourceX ?? props.fromX;
  const sourceY = geometry?.sourceY ?? props.fromY;
  const targetX = geometry?.targetX ?? props.toX;
  const targetY = geometry?.targetY ?? props.toY;
  const sourcePosition = geometry?.sourcePosition ?? props.fromPosition;
  const targetPosition = geometry?.targetPosition ?? props.toPosition;

  const state: TopologyEdgeVisualState = props.connectionStatus === "invalid"
    ? "error"
    : props.toNode
      ? "active"
      : "declared";
  const style = getTopologyEdgeStyle(state);
  const strokeColor = style.stroke;
  const markerId = `service-connection-arrow-${props.fromNode.id}-${props.toNode?.id ?? "pointer"}`;

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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

      <path
        className="service-connection-line service-connection-line-backdrop"
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeOpacity={0.18}
        strokeWidth={7}
      />
      <path
        className={`service-connection-line ${style.className}`}
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={style.dasharray ?? undefined}
        markerEnd={`url(#${markerId})`}
      />
      <circle cx={sourceX} cy={sourceY} r={4.5} fill={strokeColor} fillOpacity={0.88} />
    </>
  );
}
