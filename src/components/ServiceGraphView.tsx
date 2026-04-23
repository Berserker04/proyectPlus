import { memo } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import type { Microservice, Project } from "@/lib/domain/models";
import { ServiceFlowEdge, type ServiceFlowEdgeData } from "./ServiceFlowEdge";
import { ServiceConnectionLine } from "./ServiceConnectionLine";
import { ServiceGraphNode, type ServiceGraphNodeData } from "./ServiceGraphNode";
import type { TopologySourceMode } from "@/topology/types";

interface ServiceGraphViewProps {
  activeProject: Project | null;
  services: Microservice[];
  nodes: Array<Node<ServiceGraphNodeData>>;
  edges: Array<Edge<ServiceFlowEdgeData>>;
  isPendingAction: boolean;
  isRunAllPending: boolean;
  isTopologyRefreshing: boolean;
  topologyMode: TopologySourceMode;
  topologyManifestCount: number;
  topologyLegacyCount: number;
  onAddService: () => void;
  onRunAll: () => void;
  onStopAll: () => void;
  onRefreshTopology: () => void;
  onNodesChange: (changes: NodeChange<Node<ServiceGraphNodeData>>[]) => void;
  onConnect: (connection: Connection) => void;
  canConnect: (connection: Connection) => boolean;
  onEdgeSelect: (edgeId: string) => void;
  onClearEdgeSelection: () => void;
  onNodeSelect: (serviceId: string) => void;
  onDeleteEdges: (edgeIds: string[]) => void;
  onPaneClick: () => void;
}

const nodeTypes = {
  serviceNode: ServiceGraphNode,
};

const edgeTypes = {
  serviceEdge: ServiceFlowEdge,
};

function ServiceGraphViewInner(props: ServiceGraphViewProps) {
  const isValidConnection = (connection: Connection) => Boolean(
    connection.source
    && connection.target
    && connection.source !== connection.target
    && !props.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)
    && props.canConnect(connection),
  );

  return (
    <div className="view-graph">
      <div className="view-header graph-header">
        <div>
          <h1 className="view-title">{props.activeProject ? `${props.activeProject.name} topology` : "No active project"}</h1>
          <p className="view-subtitle">
            {props.activeProject
              ? `${props.services.length} nodes mapped into a live topology canvas.`
              : "Create or select a project to build the graph."}
          </p>
          {props.activeProject && props.services.length > 0 && (
            <div className="bulk-actions">
              <button className="btn-outline" onClick={props.onRunAll} disabled={props.isPendingAction || props.isRunAllPending}>
                Start all
              </button>
              <button className="btn-outline" onClick={props.onStopAll} disabled={props.isPendingAction}>
                Stop all
              </button>
              <button className="btn-outline" onClick={props.onRefreshTopology} disabled={props.isTopologyRefreshing}>
                {props.isTopologyRefreshing ? "Refreshing topology..." : "Refresh topology"}
              </button>
            </div>
          )}
        </div>

        {props.activeProject && (
          <button className="btn-primary" onClick={props.onAddService} disabled={props.isPendingAction}>
            + Add node
          </button>
        )}
      </div>

      <div className="graph-stage">
        {props.activeProject ? (
          <ReactFlow
            fitView
            nodes={props.nodes}
            edges={props.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={props.onNodesChange}
            onConnect={props.onConnect}
            onNodeClick={(_event, node) => {
              props.onClearEdgeSelection();
              props.onNodeSelect(node.id);
            }}
            onEdgeClick={(_event, edge) => props.onEdgeSelect(edge.id)}
            onPaneClick={() => {
              props.onClearEdgeSelection();
              props.onPaneClick();
            }}
            onEdgesDelete={(edges) => props.onDeleteEdges(edges.map((edge) => edge.id))}
            isValidConnection={isValidConnection}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{ type: "serviceEdge" }}
            connectionLineComponent={ServiceConnectionLine}
            className="service-flow-canvas"
            connectionMode={ConnectionMode.Loose}
            connectionRadius={26}
            minZoom={0.35}
            maxZoom={1.6}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            panOnDrag={[1, 2]}
            selectionOnDrag={false}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(110, 188, 255, 0.14)"
            />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.data.telemetry.pressureTone === "critical"
                  ? "#ff5d77"
                  : node.data.telemetry.pressureTone === "pressure"
                    ? "#ff8a3d"
                    : node.data.telemetry.pressureTone === "warning"
                      ? "#f7c14d"
                      : node.data.telemetry.pressureTone === "idle"
                        ? "#7c8799"
                        : "#41f0a9"
              }
              className="service-flow-minimap"
            />
            <Controls className="service-flow-controls" />
            <Panel position="top-left" className="service-flow-panel">
              <span>{props.topologyMode} topology</span>
              <strong>{props.edges.length}</strong>
              <span>{props.topologyManifestCount} manifest</span>
              <span>{props.topologyLegacyCount} legacy</span>
            </Panel>
          </ReactFlow>
        ) : (
          <div className="empty-state">
            <p>No project selected.</p>
            <p>The graph canvas will appear here once a project is active.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export const ServiceGraphView = memo(ServiceGraphViewInner);
