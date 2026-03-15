import type { FormEvent } from "react";

interface SettingsFormState {
  dashboardRefresh: string;
  realtimeRefresh: string;
}

interface SettingsViewProps {
  settingsForm: SettingsFormState;
  onChangeField: (field: keyof SettingsFormState, value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function SettingsView({ settingsForm, onChangeField, onSubmit }: SettingsViewProps) {
  return (
    <div className="view-settings">
      <div className="view-header">
        <h1 className="view-title">Ajustes</h1>
      </div>
      <form className="settings-form" onSubmit={onSubmit}>
        <div className="field-group">
          <label className="field-label">Refresco del dashboard (segundos)</label>
          <input
            className="field-input"
            type="number"
            min={1}
            max={60}
            value={settingsForm.dashboardRefresh}
            onChange={(e) => onChangeField("dashboardRefresh", e.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label">Refresco en tiempo real (segundos)</label>
          <input
            className="field-input"
            type="number"
            min={1}
            max={60}
            value={settingsForm.realtimeRefresh}
            onChange={(e) => onChangeField("realtimeRefresh", e.target.value)}
          />
        </div>
        <button className="btn-primary" type="submit">Guardar ajustes</button>
      </form>
    </div>
  );
}
