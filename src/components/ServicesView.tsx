import type { Microservice, Project } from "@/lib/domain/models";
import { ServiceCard } from "./ServiceCard";

interface ServicesViewProps {
  services: Microservice[];
  activeProject: Project | null;
  isPendingAction: boolean;
  focusedServiceId: string | null;
  draggedServiceId: string | null;
  onFocusService: (id: string) => void;
  onRun: (svc: Microservice) => void;
  onStop: (svc: Microservice) => void;
  onRestart: (svc: Microservice) => void;
  onEdit: (svc: Microservice) => void;
  onDelete: (svc: Microservice) => void;
  onLogs: (svc: Microservice) => void;
  onFolder: (svc: Microservice) => void;
  onTerminal: (svc: Microservice) => void;
  onMoveUp: (svcId: string) => void;
  onMoveDown: (svcId: string) => void;
  onRunAll: () => void;
  onStopAll: () => void;
  onAddService: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, targetId: string) => void;
  onDragEnd: () => void;
}

export function ServicesView({
  services,
  activeProject,
  isPendingAction,
  focusedServiceId,
  draggedServiceId,
  onFocusService,
  onRun,
  onStop,
  onRestart,
  onEdit,
  onDelete,
  onLogs,
  onFolder,
  onTerminal,
  onMoveUp,
  onMoveDown,
  onRunAll,
  onStopAll,
  onAddService,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ServicesViewProps) {
  return (
    <div className="view-services">
      <div className="view-header">
        <div>
          <h1 className="view-title">
            {activeProject ? activeProject.name : "Sin proyecto activo"}
          </h1>
          <p className="view-subtitle">
            {activeProject
              ? `${services.length} microservicio(s) registrado(s)`
              : "Crea o selecciona un proyecto en la barra lateral."}
          </p>
          {activeProject && services.length > 0 && (
            <div className="bulk-actions">
              <button
                className="btn-outline"
                onClick={onRunAll}
                disabled={isPendingAction}
                title="Iniciar todos los servicios detenidos"
              >
                ▶ Iniciar todos
              </button>
              <button
                className="btn-outline"
                onClick={onStopAll}
                disabled={isPendingAction}
                title="Detener todos los servicios activos"
              >
                ⏹ Detener todos
              </button>
            </div>
          )}
        </div>
        {activeProject && (
          <button
            className="btn-primary"
            onClick={onAddService}
            disabled={isPendingAction}
          >
            + Agregar microservicio
          </button>
        )}
      </div>

      {/* Service cards */}
      <div className="service-list">
        {services.length === 0 && activeProject && (
          <div className="empty-state">
            <p>No hay microservicios en este proyecto.</p>
            <p>Haz clic en <strong>+ Agregar microservicio</strong> para empezar.</p>
          </div>
        )}
        {services.map((svc) => (
          <ServiceCard
            key={svc.id}
            svc={svc}
            isFocused={svc.id === focusedServiceId}
            onFocus={() => onFocusService(svc.id)}
            onRun={() => onRun(svc)}
            onStop={() => onStop(svc)}
            onRestart={() => onRestart(svc)}
            onEdit={() => onEdit(svc)}
            onDelete={() => onDelete(svc)}
            onLogs={() => onLogs(svc)}
            onFolder={() => onFolder(svc)}
            onTerminal={() => onTerminal(svc)}
            onMoveUp={() => onMoveUp(svc.id)}
            onMoveDown={() => onMoveDown(svc.id)}
            isDragged={svc.id === draggedServiceId}
            onDragStart={(e) => onDragStart(e, svc.id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, svc.id)}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
