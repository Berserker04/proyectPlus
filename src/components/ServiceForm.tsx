import type { FormEvent } from "react";
import type { Microservice } from "@/lib/domain/models";
import { Modal } from "./Modal";

export type ServiceFormState = {
  kind: "service" | "worker";
  name: string;
  workingDirectory: string;
  startCommand: string;
};

export const emptyServiceForm: ServiceFormState = {
  kind: "service",
  name: "",
  workingDirectory: "",
  startCommand: "",
};

interface ServiceFormProps {
  editingService: Microservice | null;
  serviceForm: ServiceFormState;
  isPendingAction: boolean;
  onChangeField: (field: keyof ServiceFormState, value: string) => void;
  onBrowseDirectory: () => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}

export function ServiceForm({
  editingService,
  serviceForm,
  isPendingAction,
  onChangeField,
  onBrowseDirectory,
  onSubmit,
  onClose,
}: ServiceFormProps) {
  return (
    <Modal
      title={editingService ? `Editar: ${editingService.name}` : "Agregar microservicio"}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div className="field-group">
          <label className="field-label">Tipo</label>
          <select
            className="field-input"
            value={serviceForm.kind}
            onChange={(e) => onChangeField("kind", e.target.value as ServiceFormState["kind"])}
          >
            <option value="service">Microservice</option>
            <option value="worker">Worker</option>
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Nombre</label>
          <input
            autoFocus
            className="field-input"
            placeholder="api-gateway"
            value={serviceForm.name}
            onChange={(e) => onChangeField("name", e.target.value)}
            required
          />
        </div>
        <div className="field-group">
          <label className="field-label">Directorio de trabajo</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              className="field-input"
              style={{ flex: 1 }}
              placeholder="C:\\proyectos\\api-gateway"
              value={serviceForm.workingDirectory}
              onChange={(e) => onChangeField("workingDirectory", e.target.value)}
              required
            />
            <button
              type="button"
              className="btn-outline"
              onClick={onBrowseDirectory}
              title="Seleccionar carpeta"
            >
              Examinar...
            </button>
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">Comando de inicio</label>
          <input
            className="field-input"
            placeholder="npm run start"
            value={serviceForm.startCommand}
            onChange={(e) => onChangeField("startCommand", e.target.value)}
            required
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={isPendingAction}>
            {editingService ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
