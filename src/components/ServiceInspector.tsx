import type { RefObject } from "react";
import type { Microservice, ServiceLogEntry, ServiceLogSnapshot } from "@/lib/domain/models";
import { LogMessage } from "@/components/LogMessage";
import { formatLogMetaTimestamp } from "@/lib/ui/logs";
import {
  formatBytes,
  formatPercent,
  getStatusLabel,
} from "@/lib/ui/serviceGraph";
import type { ResolvedTopologyService, TopologySourceMode } from "@/topology/types";

type InspectorTab = "overview" | "topology" | "logs" | "events" | "k6" | "alerts";

interface ServiceInspectorProps {
  service: Microservice | null;
  topologyService: ResolvedTopologyService | null;
  topologyMode: TopologySourceMode;
  isTopologyRefreshing: boolean;
  services: Microservice[];
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onSelectService: (serviceId: string) => void;
  onRefreshTopology: () => void;
  onRun: (service: Microservice) => void;
  onStop: (service: Microservice) => void;
  onRestart: (service: Microservice) => void;
  onLogs: (service: Microservice) => void;
  onFolder: (service: Microservice) => void;
  onTerminal: (service: Microservice) => void;
  onEdit: (service: Microservice) => void;
  onDelete: (service: Microservice) => void;
  logSnapshot: ServiceLogSnapshot | null;
  logFilter: "all" | "stdout" | "stderr";
  logQuery: string;
  isLogAutoscroll: boolean;
  showLogMeta: boolean;
  renderedLogEntries: ServiceLogEntry[];
  totalLogEntries: number;
  logTopSpacerHeight: number;
  logBottomSpacerHeight: number;
  onFilterChange: (filter: "all" | "stdout" | "stderr") => void;
  onQueryChange: (value: string) => void;
  onToggleAutoscroll: () => void;
  onToggleLogMeta: () => void;
  onCopyLogs: () => void;
  onClearLogs: () => void;
  logViewportRef: RefObject<HTMLDivElement | null>;
  onLogViewportScroll: (viewport?: HTMLDivElement | null) => void;
}

const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "topology", label: "Topology" },
  { id: "logs", label: "Logs" },
  { id: "events", label: "Events" },
  { id: "k6", label: "k6" },
  { id: "alerts", label: "Alerts" },
];

export function ServiceInspector(props: ServiceInspectorProps) {
  const { service } = props;
  const microservices = props.services.filter((item) => item.kind === "service");
  const workers = props.services.filter((item) => item.kind === "worker");
  const runtimeSummaryItems = buildRuntimeSummaryItems(props.topologyService);
  const runtimeItems = buildRuntimeItems(props.topologyService);
  const runtimeCheckItems = buildRuntimeCheckItems(props.topologyService);
  const isStopDisabled = !service
    || service.status === "stopped"
    || service.status === "external"
    || (service.status === "error" && service.pid == null);

  return (
    <aside className="service-inspector">
      <div className="inspector-header">
        <div>
          <p className="inspector-eyebrow">Inspector</p>
          <h2>{service?.name ?? "Select a node"}</h2>
          <p>{service ? `${service.kind} / ${getStatusLabel(service.status)}` : "Pick a microservice or worker from the graph."}</p>
        </div>
      </div>

      {props.services.length > 0 && (
        <div className="inspector-service-switcher">
          <label className="inspector-service-select-group">
            <span>Microservices</span>
            <select
              className="inspector-service-select"
              value={service?.kind === "service" ? service.id : ""}
              onChange={(event) => {
                if (event.target.value) props.onSelectService(event.target.value);
              }}
              disabled={microservices.length === 0}
            >
              <option value="">
                {microservices.length === 0 ? "No microservices" : "Select microservice"}
              </option>
              {microservices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="inspector-service-select-group">
            <span>Workers</span>
            <select
              className="inspector-service-select"
              value={service?.kind === "worker" ? service.id : ""}
              onChange={(event) => {
                if (event.target.value) props.onSelectService(event.target.value);
              }}
              disabled={workers.length === 0}
            >
              <option value="">
                {workers.length === 0 ? "No workers" : "Select worker"}
              </option>
              {workers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!service ? (
        <div className="inspector-empty">
          <p>No node selected.</p>
          <span>The graph remains interactive while the detail rail stays empty.</span>
        </div>
      ) : (
        <>
          <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={`inspector-tab${props.tab === tab.id ? " active" : ""}`}
                onClick={() => props.onTabChange(tab.id)}
                aria-selected={props.tab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inspector-panel">
            {props.tab === "overview" && (
              <div className="inspector-scroll-panel inspector-overview">
                <div className="inspector-summary">
                  <div className="inspector-summary-card">
                    <span>Port</span>
                    <strong>{service.detectedPort ?? "N/A"}</strong>
                  </div>
                  <div className="inspector-summary-card">
                    <span>CPU</span>
                    <strong>{formatPercent(service.cpuPercent)}</strong>
                  </div>
                  <div className="inspector-summary-card">
                    <span>RAM</span>
                    <strong>{formatBytes(service.memoryBytes)}</strong>
                  </div>
                  <div className="inspector-summary-card">
                    <span>PID</span>
                    <strong>{service.pid ?? "N/A"}</strong>
                  </div>
                </div>

                <div className="inspector-actions">
                  <button type="button" className="btn-primary" onClick={() => props.onRun(service)} disabled={service.status === "running" || service.status === "external"}>
                    Start
                  </button>
                  <button type="button" className="btn-outline" onClick={() => props.onStop(service)} disabled={isStopDisabled}>
                    Stop
                  </button>
                  <button type="button" className="btn-outline" onClick={() => props.onRestart(service)} disabled={service.status === "external"}>
                    Restart
                  </button>
                  <button type="button" className="btn-outline" onClick={() => props.onFolder(service)}>
                    Folder
                  </button>
                  <button type="button" className="btn-outline" onClick={() => props.onTerminal(service)}>
                    Shell
                  </button>
                  <button type="button" className="btn-outline" onClick={() => props.onEdit(service)}>
                    Edit
                  </button>
                  <button type="button" className="btn-outline danger" onClick={() => props.onDelete(service)}>
                    Delete
                  </button>
                </div>

                <div className="inspector-overview-section">
                  <strong>Service details</strong>
                  <dl className="inspector-overview-details">
                    <div className="inspector-overview-detail">
                      <dt>Kind</dt>
                      <dd>{service.kind}</dd>
                    </div>
                    <div className="inspector-overview-detail">
                      <dt>Status</dt>
                      <dd>{getStatusLabel(service.status)}</dd>
                    </div>
                    <div className="inspector-overview-detail inspector-overview-detail-wide">
                      <dt>Working directory</dt>
                      <dd>{service.workingDirectory}</dd>
                    </div>
                    <div className="inspector-overview-detail inspector-overview-detail-wide">
                      <dt>Start command</dt>
                      <dd>{service.startCommand}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}

            {props.tab === "topology" && (
              <div className="inspector-scroll-panel">
                <div className="inspector-topology">
                  <div className="inspector-topology-header">
                    <div>
                      <p className="inspector-topology-eyebrow">Topology</p>
                      <h3>
                        {props.topologyService?.sourceOfTruth === "manifest"
                          ? `${props.topologyService.loadSource ?? "manifest"} source`
                          : "legacy/manual"}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={props.onRefreshTopology}
                      disabled={props.isTopologyRefreshing}
                    >
                      {props.isTopologyRefreshing ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  <div className="inspector-topology-summary">
                    <div className="inspector-topology-pill">
                      <span>Mode</span>
                      <strong>{props.topologyMode}</strong>
                    </div>
                    <div className="inspector-topology-pill">
                      <span>Service</span>
                      <strong>{props.topologyService?.serviceName ?? service.name}</strong>
                    </div>
                    <div className="inspector-topology-pill">
                      <span>Kind</span>
                      <strong>{props.topologyService?.manifest?.kind ?? "legacy/manual"}</strong>
                    </div>
                    <div className="inspector-topology-pill">
                      <span>Last refresh</span>
                      <strong>{props.topologyService?.lastAttemptAt ? formatLogMetaTimestamp(props.topologyService.lastAttemptAt) : "Never"}</strong>
                    </div>
                    <div className="inspector-topology-pill">
                      <span>Status</span>
                      <strong>{props.topologyService?.stale ? "Topology stale" : "Fresh"}</strong>
                    </div>
                  </div>

                  {props.topologyService?.error ? (
                    <div className="inspector-topology-warning">
                      <strong>Manifest warning</strong>
                      <p>{props.topologyService.error}</p>
                    </div>
                  ) : null}

                  {props.topologyService?.warnings.length ? (
                    <div className="inspector-topology-warning">
                      <strong>Warnings</strong>
                      <p>{props.topologyService.warnings.join(" | ")}</p>
                    </div>
                  ) : null}

                  {props.topologyService?.manifest ? (
                    <>
                      <TopologyList
                        title="Health endpoints"
                        items={[
                          props.topologyService.health?.summary ? `summary: ${props.topologyService.health.summary}` : null,
                          props.topologyService.health?.live ? `live: ${props.topologyService.health.live}` : null,
                          props.topologyService.health?.ready ? `ready: ${props.topologyService.health.ready}` : null,
                        ]}
                        emptyLabel="No health endpoints declared."
                      />

                      <TopologyList
                        title="HTTP dependencies"
                        items={props.topologyService.httpDependencies.map((dependency) =>
                          `${dependency.direction} -> ${dependency.service}${dependency.required ? " (required)" : " (optional)"}`,
                        )}
                        emptyLabel="No HTTP dependencies declared."
                      />

                      <TopologyList
                        title="Rabbit publish"
                        items={props.topologyService.rabbitPublishes.map((dependency) =>
                          `${dependency.exchange} :: ${dependency.routingKeys.join(", ") || "all keys"}`,
                        )}
                        emptyLabel="No RabbitMQ publish bindings."
                      />

                      <TopologyList
                        title="Rabbit consume"
                        items={props.topologyService.rabbitConsumes.map((dependency) =>
                          `${dependency.exchange} -> ${dependency.queue} :: ${dependency.routingKeys.join(", ") || "all keys"}`,
                        )}
                        emptyLabel="No RabbitMQ consumers."
                      />

                      <TopologyList
                        title="Runtime summary"
                        items={runtimeSummaryItems}
                        emptyLabel="No runtime summary reported."
                      />

                      <TopologyList
                        title="Sub-runtimes"
                        items={runtimeItems}
                        emptyLabel="No composed runtimes declared."
                      />

                      <TopologyList
                        title="Runtime checks"
                        items={runtimeCheckItems}
                        emptyLabel="No runtime checks reported."
                      />

                      <details className="inspector-topology-raw">
                        <summary>Raw manifest</summary>
                        <pre>{props.topologyService.rawManifest}</pre>
                      </details>
                    </>
                  ) : (
                    <div className="inspector-topology-warning">
                      <strong>Legacy/manual node</strong>
                      <p>This service does not expose `/internal/topology` and has no local `topology.manifest.json` fallback yet.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {props.tab === "logs" && (
              <div className="inspector-logs">
                <div className="inspector-log-toolbar">
                  <input
                    className="search-input"
                    placeholder="Search logs..."
                    value={props.logQuery}
                    onChange={(event) => props.onQueryChange(event.target.value)}
                  />
                  <div className="log-service-tabs inspector-log-filter">
                    <button className={`log-tab ${props.logFilter === "all" ? "active" : ""}`} onClick={() => props.onFilterChange("all")}>All</button>
                    <button className={`log-tab ${props.logFilter === "stdout" ? "active" : ""}`} onClick={() => props.onFilterChange("stdout")}>Stdout</button>
                    <button className={`log-tab ${props.logFilter === "stderr" ? "active" : ""}`} onClick={() => props.onFilterChange("stderr")}>Stderr</button>
                  </div>
                </div>

                <div className="inspector-log-actions">
                  <button className="btn-outline" type="button" onClick={() => props.onLogs(service)}>
                    Refresh
                  </button>
                  <button className={`btn-outline${props.showLogMeta ? " is-active" : ""}`} type="button" onClick={props.onToggleLogMeta}>
                    {props.showLogMeta ? "Hide meta" : "Show meta"}
                  </button>
                  <button className="btn-outline" type="button" onClick={props.onToggleAutoscroll}>
                    {props.isLogAutoscroll ? "Pause scroll" : "Resume scroll"}
                  </button>
                  <button className="btn-outline" type="button" onClick={props.onCopyLogs}>
                    Copy
                  </button>
                  <button className="btn-outline danger" type="button" onClick={props.onClearLogs}>
                    Clear
                  </button>
                </div>

                <div
                  className="inspector-log-viewport log-viewport"
                  ref={props.logViewportRef}
                  onScroll={(event) => props.onLogViewportScroll(event.currentTarget)}
                >
                  {props.logTopSpacerHeight > 0 ? (
                    <div style={{ height: props.logTopSpacerHeight }} aria-hidden="true" />
                  ) : null}
                  {props.renderedLogEntries.map((entry) => (
                    <div key={entry.sequence} className={`log-entry log-${entry.level}${props.showLogMeta ? "" : " log-entry-compact"}`}>
                      {props.showLogMeta ? (
                        <>
                          <span className="log-ts">{formatLogMetaTimestamp(entry.timestamp)}</span>
                          <span className={`log-stream log-stream-${entry.stream}`}>{entry.stream}</span>
                        </>
                      ) : null}
                      <div className="log-msg">
                        <LogMessage message={entry.message} />
                      </div>
                    </div>
                  ))}
                  {props.logBottomSpacerHeight > 0 ? (
                    <div style={{ height: props.logBottomSpacerHeight }} aria-hidden="true" />
                  ) : null}
                  {props.totalLogEntries === 0 && (
                    <div className="log-empty">No log lines for this node yet.</div>
                  )}
                  {props.logSnapshot?.droppedEntries ? (
                    <div className="inspector-log-footnote">
                      Dropped lines: {props.logSnapshot.droppedEntries}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {props.tab === "events" && (
              <PlaceholderPanel
                title="System events pending"
                body="This tab is wired to the selected node but still waits for backend event history."
              />
            )}

            {props.tab === "k6" && (
              <PlaceholderPanel
                title="k6 rail pending"
                body="The surface is reserved, but per-node runs are outside this iteration."
              />
            )}

            {props.tab === "alerts" && (
              <div className="inspector-scroll-panel">
                {service.issue ? (
                  <div className="inspector-issue">
                    <strong>{service.issue.title}</strong>
                    <p>{service.issue.message}</p>
                    {service.issue.detail ? <p>{service.issue.detail}</p> : null}
                  </div>
                ) : (
                  <PlaceholderPanel
                    title="No active alerts"
                    body="Runtime issues and future threshold alerts will land here when they exist."
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function PlaceholderPanel(props: { title: string; body: string }) {
  return (
    <div className="inspector-placeholder">
      <strong>{props.title}</strong>
      <p>{props.body}</p>
    </div>
  );
}

function TopologyList(props: { title: string; items: Array<string | null>; emptyLabel: string }) {
  const items = props.items.filter((item): item is string => Boolean(item));

  return (
    <div className="inspector-topology-section">
      <strong>{props.title}</strong>
      {items.length > 0 ? (
        <ul className="inspector-topology-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{props.emptyLabel}</p>
      )}
    </div>
  );
}

function buildRuntimeSummaryItems(topologyService: ResolvedTopologyService | null): string[] {
  if (!topologyService?.runtime) return [];

  return [
    `status: ${topologyService.runtime.status}`,
    `ready: ${topologyService.runtime.ready ? "yes" : "no"}`,
  ];
}

function buildRuntimeItems(topologyService: ResolvedTopologyService | null): string[] {
  if (!topologyService?.runtimes) return [];

  return Object.entries(topologyService.runtimes).flatMap(([runtimeKey, runtime]) =>
    runtime
      ? [`${runtimeKey}: ${runtime.status} (${runtime.ready ? "ready" : "not ready"})`]
      : [],
  );
}

function buildRuntimeCheckItems(topologyService: ResolvedTopologyService | null): string[] {
  if (!topologyService) return [];

  const nestedChecks = Object.entries(topologyService.runtimes ?? {}).flatMap(([runtimeKey, runtime]) =>
    (runtime?.checks ?? []).map((check) => `${runtimeKey}.${check.name}: ${check.status}`),
  );

  if (nestedChecks.length > 0) return nestedChecks;
  return (topologyService.runtime?.checks ?? []).map((check) => `${check.name}: ${check.status}`);
}
