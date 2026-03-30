import type { RefObject } from "react";
import type { Microservice, ServiceLogEntry, ServiceLogSnapshot } from "@/lib/domain/models";
import { LogMessage } from "@/components/LogMessage";
import { formatLogMetaTimestamp } from "@/lib/ui/logs";
import {
  formatBytes,
  formatPercent,
  getStatusLabel,
} from "@/lib/ui/serviceGraph";

type InspectorTab = "logs" | "events" | "k6" | "alerts";

interface ServiceInspectorProps {
  service: Microservice | null;
  services: Microservice[];
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onSelectService: (serviceId: string) => void;
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
  { id: "logs", label: "Logs" },
  { id: "events", label: "Events" },
  { id: "k6", label: "k6" },
  { id: "alerts", label: "Alerts" },
];

export function ServiceInspector(props: ServiceInspectorProps) {
  const { service } = props;
  const microservices = props.services.filter((item) => item.kind === "service");
  const workers = props.services.filter((item) => item.kind === "worker");
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
          <p>{service ? `${service.kind} · ${getStatusLabel(service.status)}` : "Pick a microservice or worker from the graph."}</p>
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

          {service.issue && (
            <div className="inspector-issue">
              <strong>{service.issue.title}</strong>
              <p>{service.issue.message}</p>
            </div>
          )}

          <div className="inspector-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`inspector-tab${props.tab === tab.id ? " active" : ""}`}
                onClick={() => props.onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inspector-panel">
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
              <PlaceholderPanel
                title="Alerts pending"
                body="Alert routing will land here once healthchecks and thresholds exist in the backend."
              />
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
