import { useEffect, useMemo, useState } from "react";
import type { AppSettings, AppSettingsPathKind } from "@/lib/domain/models";
import { pickAppSettingsPath, saveAppSettings } from "@/lib/platform/desktop";

type FeedbackPayload = {
  tone: "info" | "error" | "success";
  message: string;
  detail?: string | null;
};

type SettingsPanelProps = {
  isDesktopRuntime: boolean;
  settings: AppSettings;
  onFeedback: (feedback: FeedbackPayload) => void;
  onSettingsSaved: (settings: AppSettings) => void;
};

type SettingsFormState = {
  defaultWorkspaceRoot: string;
  defaultLogExportRoot: string;
  allowedShells: string;
  preferredShell: string;
  dashboardRefreshSeconds: string;
  realtimeRefreshSeconds: string;
  theme: AppSettings["theme"];
  gpuMode: AppSettings["gpuMode"];
  k6BinaryPath: string;
};

const gpuOptions: Array<{ value: AppSettings["gpuMode"]; label: string; detail: string }> = [
  { value: "auto", label: "Auto", detail: "Consulta GPU cuando el entorno lo soporta." },
  { value: "disabled", label: "Desactivado", detail: "Evita consultas GPU y reduce ruido en entornos sin soporte." },
  { value: "nvidia", label: "Solo NVIDIA", detail: "Fuerza el modo actual basado en nvidia-smi." },
];

export function SettingsPanel(props: SettingsPanelProps) {
  const [form, setForm] = useState<SettingsFormState>(() => buildSettingsForm(props.settings));
  const [isSaving, setIsSaving] = useState(false);
  const [pickingKind, setPickingKind] = useState<AppSettingsPathKind | null>(null);

  useEffect(() => {
    setForm(buildSettingsForm(props.settings));
  }, [props.settings]);

  const availableShells = useMemo(() => {
    const shells = parseAllowedShells(form.allowedShells);
    if (form.preferredShell.trim() && !shells.some((shell) => shell.toLowerCase() === form.preferredShell.trim().toLowerCase())) {
      shells.unshift(form.preferredShell.trim());
    }
    return shells;
  }, [form.allowedShells, form.preferredShell]);

  const hasChanges = JSON.stringify(buildSettingsPayload(form)) !== JSON.stringify(props.settings);

  async function handlePickPath(kind: AppSettingsPathKind, field: keyof SettingsFormState) {
    setPickingKind(kind);
    try {
      const selectedPath = await pickAppSettingsPath(kind);
      if (!selectedPath) {
        return;
      }

      setForm((current) => ({
        ...current,
        [field]: selectedPath,
      }));
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: "No fue posible abrir el selector de rutas de ajustes.",
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setPickingKind(null);
    }
  }

  async function handleSave() {
    setIsSaving(true);

    try {
      const savedSettings = await saveAppSettings(buildSettingsPayload(form));
      props.onSettingsSaved(savedSettings);
      setForm(buildSettingsForm(savedSettings));
      props.onFeedback({
        tone: "success",
        message: "Configuracion guardada.",
        detail: `Cadencia ${savedSettings.dashboardRefreshSeconds}s/${savedSettings.realtimeRefreshSeconds}s, GPU ${savedSettings.gpuMode}.`,
      });
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: "No fue posible guardar la configuracion.",
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="screen-shell settings-screen">
      <div className="panel settings-hero">
        <div>
          <p className="eyebrow">Ajustes</p>
          <h3>Entorno de trabajo</h3>
          <p className="lede">
            Ajusta rutas, shells permitidas, cadencia de actualizacion, modo GPU y la ruta del binario
            de k6. La interfaz ahora usa una sola identidad visual firma.
          </p>
        </div>
        <div className="summary-strip">
          <div className="summary-badge">
            <span>Identidad</span>
            <strong>Firma ejecutiva</strong>
          </div>
          <div className="summary-badge">
            <span>GPU</span>
            <strong>{props.settings.gpuMode}</strong>
          </div>
          <div className="summary-badge">
            <span>Cadencia</span>
            <strong>{props.settings.dashboardRefreshSeconds}s / {props.settings.realtimeRefreshSeconds}s</strong>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel settings-card">
          <div className="section-heading">
            <h3>Rutas base</h3>
            <span>Global</span>
          </div>
          <div className="manual-form-grid">
            <label className="control control-wide">
              <span>Carpeta base del workspace</span>
              <input
                type="text"
                value={form.defaultWorkspaceRoot}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  defaultWorkspaceRoot: event.target.value,
                }))}
                placeholder="C:/dev/microservices"
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="utility-button"
                onClick={() => void handlePickPath("workspaceRoot", "defaultWorkspaceRoot")}
                disabled={!props.isDesktopRuntime || pickingKind !== null}
              >
                {pickingKind === "workspaceRoot" ? "Seleccionando..." : "Explorar workspace"}
              </button>
            </div>
            <label className="control control-wide">
              <span>Ruta de exportacion</span>
              <input
                type="text"
                value={form.defaultLogExportRoot}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  defaultLogExportRoot: event.target.value,
                }))}
                placeholder="C:/dev/ms-control-exports"
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="utility-button"
                onClick={() => void handlePickPath("logExportRoot", "defaultLogExportRoot")}
                disabled={!props.isDesktopRuntime || pickingKind !== null}
              >
                {pickingKind === "logExportRoot" ? "Seleccionando..." : "Explorar exportacion"}
              </button>
            </div>
            <label className="control control-wide">
              <span>Binario k6</span>
              <input
                type="text"
                value={form.k6BinaryPath}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  k6BinaryPath: event.target.value,
                }))}
                placeholder="C:/Program Files/k6/k6.exe"
              />
            </label>
            <div className="action-row">
              <button
                type="button"
                className="utility-button"
                onClick={() => void handlePickPath("k6BinaryFile", "k6BinaryPath")}
                disabled={!props.isDesktopRuntime || pickingKind !== null}
              >
                {pickingKind === "k6BinaryFile" ? "Seleccionando..." : "Explorar k6"}
              </button>
            </div>
          </div>
          <p className="form-hint">
            Estas rutas se reutilizan para seleccionar workspaces, exportar logs y validar el
            ejecutable de k6. Solo se permite <code>k6</code> o <code>k6.exe</code>.
          </p>
        </div>

        <div className="panel settings-card">
          <div className="section-heading">
            <h3>Shell y actualizacion</h3>
            <span>Operativo</span>
          </div>
          <div className="manual-form-grid">
            <label className="control">
              <span>Shell preferida</span>
              <select
                value={form.preferredShell}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  preferredShell: event.target.value,
                }))}
              >
                {availableShells.map((shell) => (
                  <option key={shell} value={shell}>{shell}</option>
                ))}
              </select>
            </label>
            <label className="control">
              <span>Cadencia del panel (s)</span>
              <input
                type="number"
                min="1"
                max="30"
                value={form.dashboardRefreshSeconds}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  dashboardRefreshSeconds: event.target.value,
                }))}
              />
            </label>
            <label className="control control-wide">
              <span>Shells permitidas</span>
              <textarea
                value={form.allowedShells}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  allowedShells: event.target.value,
                }))}
                rows={4}
                placeholder={"cmd.exe\npowershell.exe\npwsh.exe"}
              />
            </label>
            <label className="control">
              <span>Cadencia en vivo (s)</span>
              <input
                type="number"
                min="1"
                max="10"
                value={form.realtimeRefreshSeconds}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  realtimeRefreshSeconds: event.target.value,
                }))}
              />
            </label>
          </div>
          <p className="form-hint">
            <code>Abrir terminal</code> solo usa shells incluidas en esta lista. Si la preferida no
            esta permitida, la accion se bloquea.
          </p>
        </div>

        <div className="panel settings-card settings-signature-card">
          <div className="section-heading">
            <h3>Firma visual y GPU</h3>
            <span>Producto</span>
          </div>
          <p className="form-hint">
            La app conserva <code>theme</code> por compatibilidad de persistencia, pero la UI ya no
            expone variantes. Todo el shell se renderiza con una sola identidad visual.
          </p>
          <label className="control control-wide">
            <span>Modo GPU</span>
            <select
              value={form.gpuMode}
              onChange={(event) => setForm((current) => ({
                ...current,
                gpuMode: event.target.value as AppSettings["gpuMode"],
              }))}
            >
              {gpuOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <ul className="architecture-list">
            {gpuOptions.map((option) => (
              <li key={option.value}>
                <strong>{option.label}</strong>
                <p>{option.detail}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel settings-card">
          <div className="section-heading">
            <h3>Aplicacion de cambios</h3>
            <span>{hasChanges ? "Borrador" : "Sincronizado"}</span>
          </div>
          <ul className="architecture-list">
            <li>
              <strong>Aplicacion completa</strong>
              <p>Rutas, cadencias, shell y GPU se reutilizan en resumen, inspector y laboratorio.</p>
            </li>
            <li>
              <strong>Compatibilidad</strong>
              <p>La preferencia de tema se conserva en storage, aunque la UI ya no permita cambiarla.</p>
            </li>
            <li>
              <strong>Persistencia</strong>
              <p>Los cambios se guardan solo en escritorio y reaparecen al abrir la app.</p>
            </li>
          </ul>
          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setForm(buildSettingsForm(props.settings))}
              disabled={isSaving || !hasChanges}
            >
              Resetear borrador
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleSave()}
              disabled={isSaving || !hasChanges}
              >
                {isSaving ? "Guardando..." : "Guardar ajustes"}
              </button>
          </div>
          {!props.isDesktopRuntime ? (
            <p className="form-hint">El guardado esta disponible solo en la app de escritorio.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function buildSettingsForm(settings: AppSettings): SettingsFormState {
  return {
    defaultWorkspaceRoot: settings.defaultWorkspaceRoot,
    defaultLogExportRoot: settings.defaultLogExportRoot,
    allowedShells: settings.allowedShells.join("\n"),
    preferredShell: settings.preferredShell,
    dashboardRefreshSeconds: String(settings.dashboardRefreshSeconds),
    realtimeRefreshSeconds: String(settings.realtimeRefreshSeconds),
    theme: settings.theme,
    gpuMode: settings.gpuMode,
    k6BinaryPath: settings.k6BinaryPath,
  };
}

function buildSettingsPayload(form: SettingsFormState): AppSettings {
  return {
    defaultWorkspaceRoot: form.defaultWorkspaceRoot.trim(),
    defaultLogExportRoot: form.defaultLogExportRoot.trim(),
    allowedShells: parseAllowedShells(form.allowedShells),
    preferredShell: form.preferredShell.trim(),
    dashboardRefreshSeconds: clampNumber(form.dashboardRefreshSeconds, 2, 1, 30),
    realtimeRefreshSeconds: clampNumber(form.realtimeRefreshSeconds, 1, 1, 10),
    theme: form.theme,
    gpuMode: form.gpuMode,
    k6BinaryPath: form.k6BinaryPath.trim(),
  };
}

function parseAllowedShells(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 && lines.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) === index);
}

function clampNumber(rawValue: string, fallback: number, min: number, max: number) {
  const parsed = Number(rawValue.trim());
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}
