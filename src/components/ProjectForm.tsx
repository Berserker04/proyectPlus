import type { FormEvent } from "react";
import type { Project } from "@/lib/domain/models";
import { Modal } from "./Modal";

interface ProjectFormProps {
  editingProject: Project | null;
  projectName: string;
  isPendingAction: boolean;
  onChangeName: (name: string) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}

export function ProjectForm({
  editingProject,
  projectName,
  isPendingAction,
  onChangeName,
  onSubmit,
  onClose,
}: ProjectFormProps) {
  return (
    <Modal
      title={editingProject ? "Editar proyecto" : "Nuevo proyecto"}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div className="field-group">
          <label className="field-label">Nombre del proyecto</label>
          <input
            autoFocus
            className="field-input"
            placeholder="Mi proyecto"
            value={projectName}
            onChange={(e) => onChangeName(e.target.value)}
            required
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={isPendingAction}>
            {editingProject ? "Guardar cambios" : "Crear proyecto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
