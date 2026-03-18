import type { Project, SystemMetrics } from "@/lib/domain/models";
import { statusColor } from "./ServiceCard";

interface ProjectStats {
  total: number;
  running: number;
  errors: number;
}

interface ProjectSidebarProps {
  projects: Project[];
  system: SystemMetrics;
  activeProjectStats: ProjectStats;
  isPendingAction: boolean;
  currentView: "graph" | "settings";
  onViewChange: (view: "graph" | "settings") => void;
  onSelectProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onNewProject: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="/logo.png" alt="ProyectsPlus" className="sidebar-logo" />
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-btn${props.currentView === "graph" ? " active" : ""}`}
          onClick={() => props.onViewChange("graph")}
        >
          <span className="nav-icon">Flow</span> Topology
        </button>
        <button
          className={`nav-btn${props.currentView === "settings" ? " active" : ""}`}
          onClick={() => props.onViewChange("settings")}
        >
          <span className="nav-icon">Cfg</span> Settings
        </button>
      </nav>

      <div className="sidebar-section-label">Projects</div>
      <div className="project-list">
        {props.projects.map((project) => (
          <div key={project.id} className={`project-item${project.isActive ? " active" : ""}`}>
            <button
              className="project-name-btn"
              onClick={() => props.onSelectProject(project)}
              title={project.name}
            >
              {project.name}
            </button>
            {project.isActive && props.activeProjectStats.total > 0 && (
              <div
                className="project-stats"
                title={`${props.activeProjectStats.running} active, ${props.activeProjectStats.errors} errors, ${props.activeProjectStats.total} total`}
              >
                {props.activeProjectStats.errors > 0 && (
                  <span className="project-stat-dot" style={{ background: statusColor.error }} />
                )}
                {props.activeProjectStats.running > 0 && props.activeProjectStats.errors === 0 && (
                  <span className="project-stat-dot" style={{ background: statusColor.running }} />
                )}
                <span className="project-stat-count">{props.activeProjectStats.total}</span>
              </div>
            )}
            <div className="project-actions">
              <button className="icon-btn" title="Edit" onClick={() => props.onEditProject(project)}>Edit</button>
              <button className="icon-btn danger" title="Delete" onClick={() => props.onDeleteProject(project)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-outline sidebar-new-project"
        onClick={props.onNewProject}
        disabled={props.isPendingAction}
      >
        + New project
      </button>

      <div className="sidebar-footer">
        <div className="metric-row">
          <span>CPU</span>
          <span className="metric-value">{formatPercent(props.system.cpuTotalPercent)}</span>
        </div>
        <div className="metric-row">
          <span>RAM</span>
          <span className="metric-value">
            {formatBytes(props.system.memoryUsedBytes)} / {formatBytes(props.system.memoryTotalBytes)}
          </span>
        </div>
      </div>
    </aside>
  );
}
