import type { TopologyEdgeVisualState } from "./types";

export interface TopologyEdgeVisualStyle {
  className: string;
  stroke: string;
  dasharray: string | null;
  animated: boolean;
}

const EDGE_STYLE_MAP: Record<TopologyEdgeVisualState, TopologyEdgeVisualStyle> = {
  declared: {
    className: "service-flow-edge-declared",
    stroke: "var(--edge-declared)",
    dasharray: "10 8",
    animated: false,
  },
  active: {
    className: "service-flow-edge-active",
    stroke: "var(--edge-active)",
    dasharray: null,
    animated: false,
  },
  live: {
    className: "service-flow-edge-live",
    stroke: "var(--edge-live)",
    dasharray: "12 10",
    animated: true,
  },
  error: {
    className: "service-flow-edge-error",
    stroke: "var(--edge-error)",
    dasharray: null,
    animated: false,
  },
};

export function getTopologyEdgeStyle(state: TopologyEdgeVisualState): TopologyEdgeVisualStyle {
  return EDGE_STYLE_MAP[state];
}
