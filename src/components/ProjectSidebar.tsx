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
  currentView: "services" | "logs" | "settings";
  onViewChange: (view: "services" | "logs" | "settings") => void;
  onSelectProject: (proj: Project) => void;
  onEditProject: (proj: Project) => void;
  onDeleteProject: (proj: Project) => void;
  onNewProject: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function ProjectSidebar({
  projects,
  system,
  activeProjectStats,
  isPendingAction,
  currentView,
  onViewChange,
  onSelectProject,
  onEditProject,
  onDeleteProject,
  onNewProject,
}: ProjectSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="/logo.png" alt="ProyectsPlus" className="sidebar-logo" />
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <button
          className={`nav-btn${currentView === "services" ? " active" : ""}`}
          onClick={() => onViewChange("services")}
        >
          <span className="nav-icon">⚙</span> Servicios
        </button>
        <button
          className={`nav-btn${currentView === "logs" ? " active" : ""}`}
          onClick={() => onViewChange("logs")}
        >
          <span className="nav-icon">📄</span> Logs
        </button>
        <button
          className={`nav-btn${currentView === "settings" ? " active" : ""}`}
          onClick={() => onViewChange("settings")}
        >
          <span className="nav-icon">🔧</span> Ajustes
        </button>
      </nav>

      {/* Projects */}
      <div className="sidebar-section-label">Proyectos</div>
      <div className="project-list">
        {projects.map((proj) => (
          <div key={proj.id} className={`project-item${proj.isActive ? " active" : ""}`}>
            <button
              className="project-name-btn"
              onClick={() => onSelectProject(proj)}
              title={proj.name}
            >
              {proj.name}
            </button>
            {proj.isActive && activeProjectStats.total > 0 && (
              <div
                className="project-stats"
                title={`${activeProjectStats.running} activos, ${activeProjectStats.errors} errores, ${activeProjectStats.total} total`}
              >
                {activeProjectStats.errors > 0 && (
                  <span className="project-stat-dot" style={{ background: statusColor.error }} />
                )}
                {activeProjectStats.running > 0 && activeProjectStats.errors === 0 && (
                  <span className="project-stat-dot" style={{ background: statusColor.running }} />
                )}
                <span className="project-stat-count">{activeProjectStats.total}</span>
              </div>
            )}
            <div className="project-actions">
              <button className="icon-btn" title="Editar" onClick={() => onEditProject(proj)}>✏</button>
              <button className="icon-btn danger" title="Eliminar" onClick={() => onDeleteProject(proj)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-outline sidebar-new-project"
        onClick={onNewProject}
        disabled={isPendingAction}
      >
        + Nuevo proyecto
      </button>

      {/* System metrics footer */}
      <div className="sidebar-footer">
        <div className="metric-row">
          <span>CPU</span>
          <span className="metric-value">{formatPercent(system.cpuTotalPercent)}</span>
        </div>
        <div className="metric-row">
          <span>RAM</span>
          <span className="metric-value">
            {formatBytes(system.memoryUsedBytes)} / {formatBytes(system.memoryTotalBytes)}
          </span>
        </div>
      </div>
    </aside>
  );
}
