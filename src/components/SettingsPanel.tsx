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

const themeOptions: Array<{ value: AppSettings["theme"]; label: string; detail: string }> = [
  { value: "midnight", label: "Midnight", detail: "Azul oscuro, alto contraste y acentos frios." },
  { value: "ember", label: "Ember", detail: "Fondo carbon con acentos ambar y tono mas calido." },
  { value: "arctic", label: "Arctic", detail: "Oscuro grafito con acentos mas limpios y tecnicos." },
];

const gpuOptions: Array<{ value: AppSettings["gpuMode"]; label: string; detail: string }> = [
  { value: "auto", label: "Auto", detail: "Consulta GPU cuando el entorno lo soporta." },
  { value: "disabled", label: "Disabled", detail: "Desactiva las consultas de GPU para ahorrar ruido o compatibilidad." },
  { value: "nvidia", label: "NVIDIA only", detail: "Mantiene el modo actual basado en nvidia-smi." },
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
        message: "No fue posible abrir el selector de rutas de Settings.",
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
        detail: `Tema ${savedSettings.theme}, refresh ${savedSettings.dashboardRefreshSeconds}s/${savedSettings.realtimeRefreshSeconds}s, GPU ${savedSettings.gpuMode}.`,
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
    <section className="settings-screen">
      <div className="panel settings-hero">
        <div>
          <p className="eyebrow">Settings</p>
          <h3>Configuracion general</h3>
          <p className="lede">
            Ajusta rutas por defecto, shell, frecuencia de refresco, tema, modo GPU y
            la ruta del binario k6 para adaptar la app a tu entorno local.
          </p>
        </div>
        <div className="summary-strip">
          <div className="summary-badge">
            <span>Tema</span>
            <strong>{props.settings.theme}</strong>
          </div>
          <div className="summary-badge">
            <span>GPU</span>
            <strong>{props.settings.gpuMode}</strong>
          </div>
          <div className="summary-badge">
            <span>Refresh</span>
            <strong>{props.settings.dashboardRefreshSeconds}s / {props.settings.realtimeRefreshSeconds}s</strong>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel settings-card">
          <div className="section-heading">
            <h3>Rutas por defecto</h3>
            <span>Global</span>
          </div>
          <div className="manual-form-grid">
            <label className="control control-wide">
              <span>Workspace root</span>
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
                {pickingKind === "workspaceRoot" ? "Selecting..." : "Browse workspace root"}
              </button>
            </div>
            <label className="control control-wide">
              <span>Export root</span>
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
                {pickingKind === "logExportRoot" ? "Selecting..." : "Browse export root"}
              </button>
            </div>
            <label className="control control-wide">
              <span>k6 binary path</span>
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
                {pickingKind === "k6BinaryFile" ? "Selecting..." : "Browse k6 binary"}
              </button>
            </div>
          </div>
          <p className="form-hint">
            Estas rutas se reutilizan como punto de partida al seleccionar un workspace,
            exportar logs o validar el binario de k6. La app solo acepta ejecutables
            llamados <code>k6</code> o <code>k6.exe</code>.
          </p>
        </div>

        <div className="panel settings-card">
          <div className="section-heading">
            <h3>Shell y refresh</h3>
            <span>Operativo</span>
          </div>
          <div className="manual-form-grid">
            <label className="control">
              <span>Preferred shell</span>
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
              <span>Dashboard refresh (s)</span>
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
              <span>Allowed shells</span>
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
              <span>Realtime refresh (s)</span>
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
            <code>Open terminal</code> solo usa shells incluidas en esta lista. Si la shell
            preferida no esta permitida, la apertura se bloquea.
          </p>
        </div>

        <div className="panel settings-card">
          <div className="section-heading">
            <h3>Tema y GPU</h3>
            <span>Visual y metricas</span>
          </div>
          <div className="k6-profile-grid">
            {themeOptions.map((theme) => (
              <button
                key={theme.value}
                type="button"
                className={`k6-profile-card ${form.theme === theme.value ? "is-active" : ""}`}
                onClick={() => setForm((current) => ({
                  ...current,
                  theme: theme.value,
                }))}
              >
                <strong>{theme.label}</strong>
                <span>{theme.detail}</span>
              </button>
            ))}
          </div>
          <div className="manual-form-grid">
            <label className="control control-wide">
              <span>GPU mode</span>
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
          </div>
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
            <h3>Uso de la configuracion</h3>
            <span>{hasChanges ? "Draft" : "Synced"}</span>
          </div>
          <ul className="architecture-list">
            <li>
              <strong>Aplicacion completa</strong>
              <p>Tema, GPU, shell, refresco y rutas se reutilizan en toda la app.</p>
            </li>
            <li>
              <strong>Laboratorio k6</strong>
              <p>La ruta de k6 reaparece automaticamente en el laboratorio de pruebas.</p>
            </li>
            <li>
              <strong>Workspace inicial</strong>
              <p>El selector de carpetas vuelve a abrir donde lo dejaste configurado.</p>
            </li>
          </ul>
          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setForm(buildSettingsForm(props.settings))}
              disabled={isSaving || !hasChanges}
            >
              Reset draft
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleSave()}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? "Saving..." : "Save settings"}
            </button>
          </div>
          {!props.isDesktopRuntime ? (
            <p className="form-hint">
              El guardado esta disponible solo en la app de escritorio.
            </p>
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
