import { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  K6BinaryStatus,
  K6LabPreferences,
  K6LabSnapshot,
  K6ProfilePreset,
  K6RunSnapshot,
  K6ThresholdResult,
  K6ValidationResult,
  ServiceLogEntry,
  ServiceRecord,
} from "@/lib/domain/models";
import {
  cancelK6Run,
  loadK6LabSnapshot,
  loadK6RunSnapshot,
  registerK6Script,
  saveK6LabPreferences,
  startK6Run,
  validateK6Setup,
} from "@/lib/platform/desktop";

const K6MetricChart = lazy(async () => {
  const module = await import("@/components/K6MetricChart");
  return { default: module.K6MetricChart };
});

type FeedbackPayload = {
  tone: "info" | "error" | "success";
  message: string;
  detail?: string | null;
};

type K6LabPanelProps = {
  activeWorkspacePath: string | null;
  catalogKey: string;
  isDesktopRuntime: boolean;
  realtimeRefreshSeconds: number;
  services: ServiceRecord[];
  onFeedback: (feedback: FeedbackPayload) => void;
};

type K6ScriptFormState = {
  path: string;
  name: string;
};

type K6ConfigFormState = {
  profileId: string;
  scriptId: string;
  vus: string;
  duration: string;
  rate: string;
  thresholds: string;
  k6BinaryPath: string;
};

const initialK6ScriptForm: K6ScriptFormState = {
  path: "",
  name: "",
};

const initialK6ConfigForm: K6ConfigFormState = {
  profileId: "smoke",
  scriptId: "",
  vus: "1",
  duration: "30s",
  rate: "1",
  thresholds: "http_req_failed<0.01\nchecks>0.95",
  k6BinaryPath: "",
};

const fallbackBinaryStatus: K6BinaryStatus = {
  isAvailable: false,
  resolvedPath: null,
  detail: "La validacion de k6 esta disponible solo en la app de escritorio.",
};

const fallbackRunSnapshot: K6RunSnapshot = {
  activeRun: null,
  latestRun: null,
  history: [],
  latestReport: null,
  outputEntries: [],
  droppedOutputEntries: 0,
  lastUpdatedAt: new Date().toISOString(),
};

export function K6LabPanel(props: K6LabPanelProps) {
  const suppressAutosaveRef = useRef(false);
  const lastSavedPreferencesRef = useRef("");
  const [k6LabSnapshot, setK6LabSnapshot] = useState<K6LabSnapshot | null>(null);
  const [k6RunSnapshot, setK6RunSnapshot] = useState<K6RunSnapshot>(fallbackRunSnapshot);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [scriptForm, setScriptForm] = useState<K6ScriptFormState>(initialK6ScriptForm);
  const [configForm, setConfigForm] = useState<K6ConfigFormState>(initialK6ConfigForm);
  const [validation, setValidation] = useState<K6ValidationResult | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isCancellingRun, setIsCancellingRun] = useState(false);

  const scripts = k6LabSnapshot?.scripts ?? [];
  const profiles = k6LabSnapshot?.profiles ?? [];
  const binary = k6LabSnapshot?.binary ?? fallbackBinaryStatus;
  const selectedService = props.services.find((service) => service.id === selectedServiceId) ?? null;
  const serviceScripts = scripts.filter((script) => script.serviceId === selectedServiceId);
  const selectedScript = serviceScripts.find((script) => script.id === configForm.scriptId) ?? null;
  const selectedProfile = profiles.find((profile) => profile.id === configForm.profileId) ?? null;
  const activeRun = k6RunSnapshot.activeRun;
  const latestRun = k6RunSnapshot.latestRun;
  const history = k6RunSnapshot.history;
  const latestReport = k6RunSnapshot.latestReport;
  const canRun = Boolean(selectedService && selectedScript) && !activeRun && !isStartingRun;

  useEffect(() => {
    let ignore = false;

    setIsLoadingSnapshot(true);
    void Promise.all([loadK6LabSnapshot(), loadK6RunSnapshot()])
      .then(([nextLabSnapshot, nextRunSnapshot]) => {
        if (!ignore) {
          setK6LabSnapshot(nextLabSnapshot);
          setK6RunSnapshot(nextRunSnapshot);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          props.onFeedback({
            tone: "error",
            message: "No fue posible cargar el laboratorio k6.",
            detail: error instanceof Error ? error.message : null,
          });
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingSnapshot(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [props.activeWorkspacePath, props.catalogKey]);

  useEffect(() => {
    if (!k6LabSnapshot) {
      return;
    }

    const hydrated = buildHydratedLabState(k6LabSnapshot.preferences, props.services, scripts, profiles);
    const serialized = JSON.stringify(hydrated.preferences);
    suppressAutosaveRef.current = true;
    lastSavedPreferencesRef.current = serialized;
    setSelectedServiceId((current) => (current === hydrated.selectedServiceId ? current : hydrated.selectedServiceId));
    setConfigForm((current) => (areConfigFormsEqual(current, hydrated.configForm) ? current : hydrated.configForm));

    const timer = window.setTimeout(() => {
      suppressAutosaveRef.current = false;
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [k6LabSnapshot, props.services, scripts, profiles]);

  useEffect(() => {
    if (!activeRun) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadK6RunSnapshot()
        .then((snapshot) => setK6RunSnapshot(snapshot))
        .catch((error: unknown) => {
          props.onFeedback({
            tone: "error",
            message: "No fue posible refrescar la corrida k6 activa.",
            detail: error instanceof Error ? error.message : null,
          });
        });
    }, Math.max(1, props.realtimeRefreshSeconds) * 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeRun?.id, props.realtimeRefreshSeconds]);

  useEffect(() => {
    if (!props.isDesktopRuntime || !k6LabSnapshot || suppressAutosaveRef.current) {
      return undefined;
    }

    const nextPreferences = buildPersistablePreferences(selectedServiceId, configForm);
    if (!nextPreferences) {
      return undefined;
    }

    const serialized = JSON.stringify(nextPreferences);
    if (serialized === lastSavedPreferencesRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void saveK6LabPreferences(nextPreferences)
        .then((snapshot) => {
          lastSavedPreferencesRef.current = serialized;
          setK6LabSnapshot(snapshot);
        })
        .catch((error: unknown) => {
          props.onFeedback({
            tone: "error",
            message: "No fue posible guardar la configuracion del laboratorio k6.",
            detail: error instanceof Error ? error.message : null,
          });
        });
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [configForm, k6LabSnapshot, props.isDesktopRuntime, selectedServiceId]);

  useEffect(() => {
    const fallbackServiceId = props.services[0]?.id ?? "";
    setSelectedServiceId((current) => {
      if (current && props.services.some((service) => service.id === current)) {
        return current;
      }

      return fallbackServiceId;
    });
  }, [props.services]);

  useEffect(() => {
    const fallbackScriptId = serviceScripts[0]?.id ?? "";
    setConfigForm((current) => {
      const nextScriptId = serviceScripts.some((script) => script.id === current.scriptId)
        ? current.scriptId
        : fallbackScriptId;

      if (current.scriptId === nextScriptId) {
        return current;
      }

      return {
        ...current,
        scriptId: nextScriptId,
      };
    });
  }, [serviceScripts]);

  useEffect(() => {
    if (profiles.length === 0 || profiles.some((profile) => profile.id === configForm.profileId)) {
      return;
    }

    applyProfilePreset(profiles[0]);
  }, [configForm.profileId, profiles]);

  function applyProfilePreset(profile: K6ProfilePreset) {
    setConfigForm((current) => ({
      ...current,
      profileId: profile.id,
      vus: String(profile.vus),
      duration: profile.duration,
      rate: profile.rate === null ? "" : String(profile.rate),
      thresholds: profile.thresholds.join("\n"),
    }));
    setValidation(null);
  }

  async function refreshK6Lab(successMessage?: string) {
    setIsLoadingSnapshot(true);

    try {
      const [nextLabSnapshot, nextRunSnapshot] = await Promise.all([
        loadK6LabSnapshot(),
        loadK6RunSnapshot(),
      ]);
      setK6LabSnapshot(nextLabSnapshot);
      setK6RunSnapshot(nextRunSnapshot);
      if (successMessage) {
        props.onFeedback({
          tone: "success",
          message: successMessage,
          detail: nextLabSnapshot.binary.detail,
        });
      }
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: "No fue posible refrescar los scripts k6 del workspace activo.",
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  async function handleRegisterScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedService) {
      props.onFeedback({
        tone: "error",
        message: "Selecciona un servicio antes de registrar un script k6.",
        detail: null,
      });
      return;
    }

    setIsSavingScript(true);
    setValidation(null);

    try {
      const nextSnapshot = await registerK6Script({
        serviceId: selectedService.id,
        path: scriptForm.path.trim(),
        name: scriptForm.name.trim() || null,
      });
      setK6LabSnapshot(nextSnapshot);
      setScriptForm(initialK6ScriptForm);
      props.onFeedback({
        tone: "success",
        message: `Script k6 registrado para ${selectedService.name}.`,
        detail: scriptForm.path.trim(),
      });
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: `No fue posible registrar un script k6 para ${selectedService.name}.`,
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setIsSavingScript(false);
    }
  }

  async function handleValidate() {
    setIsValidating(true);

    try {
      const result = await validateK6Setup({
        k6BinaryPath: configForm.k6BinaryPath.trim() || null,
        vus: Number(configForm.vus.trim() || "0"),
        duration: configForm.duration.trim(),
        rate: configForm.rate.trim() ? Number(configForm.rate.trim()) : null,
        thresholds: parseMultilineList(configForm.thresholds),
      });
      setValidation(result);
      props.onFeedback({
        tone: result.isValid ? "success" : "error",
        message: result.isValid
          ? "Setup k6 validado correctamente."
          : "El setup k6 tiene observaciones antes de ejecutar corridas.",
        detail: result.issues[0] ?? result.binary.detail,
      });
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: "No fue posible validar el setup k6.",
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setIsValidating(false);
    }
  }

  async function handleRun() {
    if (!selectedService || !selectedScript) {
      props.onFeedback({
        tone: "error",
        message: "Selecciona un servicio y un script antes de ejecutar k6.",
        detail: null,
      });
      return;
    }

    setIsStartingRun(true);

    try {
      const response = await startK6Run({
        serviceId: selectedService.id,
        scriptId: selectedScript.id,
        profileId: configForm.profileId,
        vus: Number(configForm.vus.trim() || "0"),
        duration: configForm.duration.trim(),
        rate: configForm.rate.trim() ? Number(configForm.rate.trim()) : null,
        thresholds: parseMultilineList(configForm.thresholds),
        k6BinaryPath: configForm.k6BinaryPath.trim() || null,
      });
      setK6RunSnapshot(response.snapshot);

      if (response.issue) {
        props.onFeedback({
          tone: response.snapshot.activeRun ? "info" : "error",
          message: response.issue.message,
          detail: response.issue.detail ?? null,
        });
      } else {
        props.onFeedback({
          tone: "success",
          message: `Corrida k6 iniciada para ${selectedService.name}.`,
          detail: response.snapshot.activeRun?.commandLine ?? null,
        });
      }
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: "No fue posible iniciar la corrida k6.",
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setIsStartingRun(false);
    }
  }

  async function handleCancelRun() {
    setIsCancellingRun(true);

    try {
      const response = await cancelK6Run();
      setK6RunSnapshot(response.snapshot);
      props.onFeedback({
        tone: response.issue ? "error" : "success",
        message: response.issue?.message ?? "Corrida k6 cancelada.",
        detail: response.issue?.detail ?? response.snapshot.latestRun?.summaryExportPath ?? null,
      });
    } catch (error: unknown) {
      props.onFeedback({
        tone: "error",
        message: "No fue posible cancelar la corrida k6.",
        detail: error instanceof Error ? error.message : null,
      });
    } finally {
      setIsCancellingRun(false);
    }
  }

  function handleOpenExternalDashboard(url: string | null) {
    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="panel rail-panel">
      <div className="section-heading">
        <h3>Lab k6</h3>
        <span>{isLoadingSnapshot ? "Sync..." : `${scripts.length} scripts`}</span>
      </div>
      <p className="form-hint">
        Prepara corridas k6 desde el mismo panel: selecciona servicio y script, aplica un perfil
        base, ajusta <code>VUs</code>, <code>duration</code>, <code>rate</code> y valida el binario
        local antes de ejecutar.
      </p>

      <div className="k6-lab-stack">
        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Contexto activo</h4>
            <span>{selectedService ? selectedService.name : "Sin servicio"}</span>
          </div>
          <div className="manual-form-grid">
            <label className="control">
              <span>Servicio</span>
              <select
                value={selectedServiceId}
                onChange={(event) => setSelectedServiceId(event.target.value)}
              >
                {props.services.length === 0 ? (
                  <option value="">Sin servicios</option>
                ) : (
                  props.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="control">
              <span>Script</span>
              <select
                value={configForm.scriptId}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    scriptId: event.target.value,
                  }))
                }
                disabled={serviceScripts.length === 0}
              >
                {serviceScripts.length === 0 ? (
                  <option value="">Sin scripts detectados</option>
                ) : (
                  serviceScripts.map((script) => (
                    <option key={script.id} value={script.id}>
                      {script.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="control control-wide">
              <span>Workspace activo</span>
              <input
                type="text"
                value={props.activeWorkspacePath ?? "Selecciona un workspace para descubrir scripts k6."}
                readOnly
              />
            </label>
          </div>
          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => void refreshK6Lab("Scripts k6 actualizados para el workspace activo.")}
              disabled={isLoadingSnapshot}
            >
              {isLoadingSnapshot ? "Refreshing..." : "Refresh scripts"}
            </button>
          </div>
          <ul className="k6-script-list">
            {selectedService ? (
              serviceScripts.length === 0 ? (
                <li className="k6-script-card">
                  <strong>Sin scripts para {selectedService.name}</strong>
                  <p>
                    Registra una ruta manual del workspace o agrega un archivo con convencion
                    <code>k6</code>, <code>perf</code>, <code>load</code> o imports desde
                    <code>k6/http</code>.
                  </p>
                </li>
              ) : (
                serviceScripts.map((script) => (
                  <li
                    key={script.id}
                    className={`k6-script-card ${configForm.scriptId === script.id ? "is-selected" : ""}`}
                  >
                    <div className="handoff-head">
                      <strong>{script.name}</strong>
                      <span className={`tag-chip source-chip ${script.source}`}>
                        {script.source === "manual" ? "manual" : "auto"}
                      </span>
                    </div>
                    <p>{script.path}</p>
                  </li>
                ))
              )
            ) : (
              <li className="k6-script-card">
                <strong>Sin servicio seleccionado</strong>
                <p>El laboratorio k6 se habilita cuando exista al menos un servicio en el catalogo.</p>
              </li>
            )}
          </ul>
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Registrar script</h4>
            <span>{selectedService ? selectedService.name : "Bloqueado"}</span>
          </div>
          <form className="manual-form" onSubmit={(event) => void handleRegisterScript(event)}>
            <div className="manual-form-grid">
              <label className="control control-wide">
                <span>Ruta relativa</span>
                <input
                  type="text"
                  value={scriptForm.path}
                  onChange={(event) =>
                    setScriptForm((current) => ({
                      ...current,
                      path: event.target.value,
                    }))
                  }
                  placeholder="services/auth/perf/smoke.js"
                />
              </label>
              <label className="control control-wide">
                <span>Nombre opcional</span>
                <input
                  type="text"
                  value={scriptForm.name}
                  onChange={(event) =>
                    setScriptForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Auth smoke"
                />
              </label>
            </div>
            <div className="action-row">
              <button
                type="submit"
                className="ghost-button"
                disabled={isSavingScript || !selectedService}
              >
                {isSavingScript ? "Saving..." : "Save script"}
              </button>
            </div>
          </form>
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Perfil y parametros</h4>
            <span>{selectedProfile?.label ?? "Custom"}</span>
          </div>
          <div className="k6-profile-grid">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`k6-profile-card ${configForm.profileId === profile.id ? "is-active" : ""}`}
                onClick={() => applyProfilePreset(profile)}
              >
                <strong>{profile.label}</strong>
                <span>{profile.vus} VUs</span>
                <span>{profile.duration}</span>
                <span>{profile.rate === null ? "sin rate" : `${profile.rate}/s`}</span>
              </button>
            ))}
          </div>
          <div className="manual-form-grid">
            <label className="control">
              <span>VUs</span>
              <input
                type="number"
                min="0"
                value={configForm.vus}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    vus: event.target.value,
                  }))
                }
              />
            </label>
            <label className="control">
              <span>Duration</span>
              <input
                type="text"
                value={configForm.duration}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    duration: event.target.value,
                  }))
                }
                placeholder="30s"
              />
            </label>
            <label className="control">
              <span>Rate</span>
              <input
                type="number"
                min="0"
                value={configForm.rate}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    rate: event.target.value,
                  }))
                }
                placeholder="10"
              />
            </label>
            <label className="control control-wide">
              <span>k6 binary path opcional</span>
              <input
                type="text"
                value={configForm.k6BinaryPath}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    k6BinaryPath: event.target.value,
                  }))
                }
                placeholder="C:/Program Files/k6/k6.exe"
              />
            </label>
            <label className="control control-wide">
              <span>Thresholds</span>
              <textarea
                value={configForm.thresholds}
                onChange={(event) =>
                  setConfigForm((current) => ({
                    ...current,
                    thresholds: event.target.value,
                  }))
                }
                rows={5}
                placeholder={"http_req_failed<0.01\nchecks>0.95"}
              />
            </label>
          </div>
          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleValidate()}
              disabled={isValidating || !selectedService}
            >
              {isValidating ? "Validating..." : "Validate setup"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleRun()}
              disabled={!canRun}
            >
              {isStartingRun ? "Starting..." : "Run load test"}
            </button>
            {activeRun ? (
              <button
                type="button"
                className="utility-button"
                onClick={() => void handleCancelRun()}
                disabled={isCancellingRun}
              >
                {isCancellingRun ? "Cancelling..." : "Cancel run"}
              </button>
            ) : null}
          </div>
          {!props.isDesktopRuntime ? (
            <p className="form-hint">
              La ejecucion de pruebas esta disponible solo en la app de escritorio.
            </p>
          ) : null}
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Validacion</h4>
            <span>{validation ? (validation.isValid ? "OK" : "Con issues") : "Pendiente"}</span>
          </div>
          <div className={`k6-binary-status ${binary.isAvailable ? "ready" : "missing"}`}>
            <strong>{binary.isAvailable ? "k6 listo" : "k6 pendiente"}</strong>
            <p>{binary.resolvedPath ?? binary.detail}</p>
          </div>
          <ul className="architecture-list">
            <li>
              <strong>Servicio objetivo</strong>
              <p>{selectedService?.name ?? "Selecciona un servicio del catalogo."}</p>
            </li>
            <li>
              <strong>Script objetivo</strong>
              <p>
                {selectedScript
                  ? `${selectedScript.name} (${selectedScript.path})`
                  : "Todavia no hay script seleccionado."}
              </p>
            </li>
            <li>
              <strong>Perfil activo</strong>
              <p>
                {selectedProfile
                  ? `${selectedProfile.label} con ${configForm.vus} VUs, ${configForm.duration} y ${configForm.rate || "sin rate"}`
                  : "Ajuste manual sin preset activo."}
              </p>
            </li>
          </ul>
          {validation ? (
            <>
              {validation.issues.length > 0 ? (
                <ul className="k6-validation-list">
                  {validation.issues.map((issue) => (
                    <li key={issue} className="k6-validation-item invalid">
                      <strong>Issue</strong>
                      <p>{issue}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="form-hint">No se detectaron issues bloqueantes en el setup k6.</p>
              )}
              <ul className="k6-validation-list">
                {validation.thresholds.map((threshold) => (
                  <li
                    key={threshold.expression || threshold.detail}
                    className={`k6-validation-item ${threshold.isValid ? "valid" : "invalid"}`}
                  >
                    <strong>{threshold.expression || "(vacio)"}</strong>
                    <p>{threshold.detail}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="form-hint">
              Ejecuta <code>Validate setup</code> antes de correr la prueba para revisar binario,
              thresholds y parametros base.
            </p>
          )}
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Corrida activa</h4>
            <span>{activeRun ? activeRun.status : "Sin corrida"}</span>
          </div>
          {activeRun ? (
            <>
              <div className="k6-run-summary">
                <div>
                  <strong>{activeRun.serviceName}</strong>
                  <p>{activeRun.scriptName}</p>
                </div>
                <span className={`status-pill ${mapK6StatusPill(activeRun.status)}`}>{activeRun.status}</span>
              </div>
              <div className="k6-progress-track" aria-hidden="true">
                <div
                  className="k6-progress-fill"
                  style={{ width: `${Math.max(activeRun.progressPercent, 2)}%` }}
                />
              </div>
              <ul className="architecture-list">
                <li>
                  <strong>PID</strong>
                  <p>{activeRun.pid ?? "Sin PID"}</p>
                </li>
                <li>
                  <strong>Elapsed</strong>
                  <p>
                    {formatRunSeconds(activeRun.elapsedSeconds)} / {formatRunSeconds(activeRun.configuredDurationSeconds)}
                  </p>
                </li>
                <li>
                  <strong>Command</strong>
                  <p>{activeRun.commandLine}</p>
                </li>
                {activeRun.warningServiceStopped ? (
                  <li>
                    <strong>Warning</strong>
                    <p>El servicio asociado estaba detenido o sin supervisor activo cuando arrancó la corrida.</p>
                  </li>
                ) : null}
              </ul>
              <div className="k6-output-stack">
                {k6RunSnapshot.outputEntries.length === 0 ? (
                  <p className="form-hint">Esperando salida live de k6...</p>
                ) : (
                  k6RunSnapshot.outputEntries.map((entry) => (
                    <K6OutputEntryView key={`${entry.sequence}-${entry.timestamp}`} entry={entry} />
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="form-hint">
              No hay una corrida k6 activa. Cuando exista una ejecucion en curso veras progreso,
              PID, salida live y opcion de cancelarla desde aqui.
            </p>
          )}
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Ultimo intento</h4>
            <span>{latestRun ? latestRun.status : "Sin historial"}</span>
          </div>
          {latestRun ? (
            <>
              <div className="k6-run-summary">
                <div>
                  <strong>{latestRun.serviceName}</strong>
                  <p>{latestRun.scriptName}</p>
                </div>
                <span className={`status-pill ${mapK6StatusPill(latestRun.status)}`}>{latestRun.status}</span>
              </div>
              <ul className="architecture-list">
                <li>
                  <strong>Exit code</strong>
                  <p>{latestRun.exitCode ?? "n/a"}</p>
                </li>
                <li>
                  <strong>Raw result path</strong>
                  <p>{latestRun.rawResultPath ?? "Esta corrida no genero archivo de resultados."}</p>
                </li>
                <li>
                  <strong>Summary export path</strong>
                  <p>{latestRun.summaryExportPath ?? "Esta corrida no genero resumen exportado."}</p>
                </li>
                <li>
                  <strong>Elapsed</strong>
                  <p>
                    {formatRunSeconds(latestRun.elapsedSeconds)} / {formatRunSeconds(latestRun.configuredDurationSeconds)}
                  </p>
                </li>
                <li>
                  <strong>Dashboard externo</strong>
                  <p>
                    {latestRun.externalDashboardUrl
                      ? latestRun.externalDashboardUrl
                      : "Esta corrida no capturo una URL de dashboard externo."}
                  </p>
                </li>
              </ul>
              <div className="action-row">
                <button
                  type="button"
                  className="utility-button"
                  onClick={() => handleOpenExternalDashboard(latestRun.externalDashboardUrl)}
                  disabled={!latestRun.externalDashboardUrl}
                >
                  Open external dashboard
                </button>
              </div>
            </>
          ) : (
            <p className="form-hint">Todavia no hay corridas k6 finalizadas para este workspace.</p>
          )}
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Resumen del ultimo reporte</h4>
            <span>{latestReport ? "Graficas listas" : "Sin reporte"}</span>
          </div>
          {latestReport ? (
            <>
              <div className="k6-metric-grid">
                <MetricCard label="Latency avg" value={formatMetric(latestReport.summary.latencyAvgMs, "ms")} />
                <MetricCard label="Latency p95" value={formatMetric(latestReport.summary.latencyP95Ms, "ms")} />
                <MetricCard label="Latency p99" value={formatMetric(latestReport.summary.latencyP99Ms, "ms")} />
                <MetricCard label="RPS" value={formatMetric(latestReport.summary.requestsPerSecond, "/s")} />
                <MetricCard label="Error rate" value={formatMetric(latestReport.summary.errorRate, "", 4)} />
                <MetricCard
                  label="Checks"
                  value={`${latestReport.summary.checksPass} ok / ${latestReport.summary.checksFail} fail`}
                />
                <MetricCard
                  label="Checks pass rate"
                  value={formatMetric(latestReport.summary.checksPassRate, "", 4)}
                />
                <MetricCard label="Active VUs" value={formatMetric(latestReport.summary.activeVus, "")} />
              </div>
              <div className="k6-threshold-grid">
                {latestReport.summary.thresholds.length === 0 ? (
                  <p className="form-hint">
                    Esta corrida no tiene thresholds evaluables en el resumen disponible.
                  </p>
                ) : (
                  latestReport.summary.thresholds.map((threshold) => (
                    <ThresholdCard key={threshold.expression} threshold={threshold} />
                  ))
                )}
              </div>
              <Suspense fallback={<p className="form-hint">Cargando modulo de graficas...</p>}>
                <div className="k6-chart-grid">
                  <K6MetricChart
                    title="Latency"
                    subtitle="avg, p95 y p99 por segundo"
                    yAxisLabel="ms"
                    series={[
                      { name: "avg", color: "#5fc6ff", points: latestReport.charts.latencyAvgMs },
                      { name: "p95", color: "#ffbd59", points: latestReport.charts.latencyP95Ms },
                      { name: "p99", color: "#ff7b7b", points: latestReport.charts.latencyP99Ms },
                    ]}
                  />
                  <K6MetricChart
                    title="Throughput"
                    subtitle="requests por segundo"
                    yAxisLabel="req/s"
                    series={[{ name: "rps", color: "#7bec97", points: latestReport.charts.requestsPerSecond }]}
                  />
                  <K6MetricChart
                    title="VUs activos"
                    subtitle="gauge agregado por segundo"
                    yAxisLabel="vus"
                    series={[{ name: "vus", color: "#9edcff", points: latestReport.charts.vusActive }]}
                  />
                  <K6MetricChart
                    title="Errores y checks"
                    subtitle="rate agregado por segundo"
                    yAxisLabel="ratio"
                    series={[
                      { name: "error rate", color: "#ff7b7b", points: latestReport.charts.errorRate },
                      { name: "checks pass", color: "#7bec97", points: latestReport.charts.checksPassRate },
                    ]}
                  />
                </div>
              </Suspense>
            </>
          ) : (
            <p className="form-hint">
              Cuando exista una corrida finalizada veras aqui el resumen parseado, thresholds y
              graficas minimas del MVP.
            </p>
          )}
        </div>

        <div className="k6-section-card">
          <div className="section-heading">
            <h4>Historial basico</h4>
            <span>{history.length} corridas</span>
          </div>
          {history.length === 0 ? (
            <p className="form-hint">Todavia no hay corridas finalizadas para listar en historial.</p>
          ) : (
            <div className="k6-history-list">
              {history.map((run) => (
                <article key={run.id} className="k6-history-card">
                  <div className="k6-run-summary">
                    <div>
                      <strong>{run.serviceName}</strong>
                      <p>{run.scriptName}</p>
                    </div>
                    <span className={`status-pill ${mapK6StatusPill(run.status)}`}>{run.status}</span>
                  </div>
                  <ul className="architecture-list">
                    <li>
                      <strong>Inicio</strong>
                      <p>{new Date(run.startedAt).toLocaleString()}</p>
                    </li>
                    <li>
                      <strong>Duration</strong>
                      <p>{formatRunSeconds(run.elapsedSeconds)}</p>
                    </li>
                    <li>
                      <strong>Avg / p95</strong>
                      <p>
                        {formatMetric(run.summaryMetrics?.latencyAvgMs ?? null, "ms")} /{" "}
                        {formatMetric(run.summaryMetrics?.latencyP95Ms ?? null, "ms")}
                      </p>
                    </li>
                    <li>
                      <strong>RPS / errors</strong>
                      <p>
                        {formatMetric(run.summaryMetrics?.requestsPerSecond ?? null, "/s")} /{" "}
                        {formatMetric(run.summaryMetrics?.errorRate ?? null, "", 4)}
                      </p>
                    </li>
                  </ul>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function K6OutputEntryView({ entry }: { entry: ServiceLogEntry }) {
  return (
    <article className={`log-entry ${entry.level}`}>
      <div className="log-entry-meta">
        <span className="log-stream-pill">{entry.stream}</span>
        <span className="log-level-pill">{entry.level}</span>
        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </div>
      <pre>{entry.message}</pre>
    </article>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="k6-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ThresholdCard({ threshold }: { threshold: K6ThresholdResult }) {
  return (
    <article className={`k6-threshold-card ${threshold.status}`}>
      <strong>{threshold.expression}</strong>
      <span>{translateThresholdStatus(threshold.status)}</span>
      <p>{threshold.detail}</p>
    </article>
  );
}

function parseMultilineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index);
}

function buildDefaultPreferences(): K6LabPreferences {
  return {
    selectedServiceId: null,
    scriptId: null,
    profileId: "smoke",
    vus: 1,
    duration: "30s",
    rate: 1,
    thresholds: ["http_req_failed<0.01", "checks>0.95"],
    k6BinaryPath: "",
  };
}

function buildHydratedLabState(
  preferences: K6LabPreferences,
  services: ServiceRecord[],
  scripts: K6LabSnapshot["scripts"],
  profiles: K6ProfilePreset[],
) {
  const selectedServiceId = preferences.selectedServiceId
    && services.some((service) => service.id === preferences.selectedServiceId)
    ? preferences.selectedServiceId
    : (services[0]?.id ?? "");
  const availableScripts = scripts.filter((script) => script.serviceId === selectedServiceId);
  const scriptId = preferences.scriptId
    && availableScripts.some((script) => script.id === preferences.scriptId)
    ? preferences.scriptId
    : (availableScripts[0]?.id ?? "");
  const profileId = profiles.some((profile) => profile.id === preferences.profileId)
    ? preferences.profileId
    : (profiles[0]?.id ?? "smoke");
  const profileDefaults = profiles.find((profile) => profile.id === profileId);

  const hydratedPreferences: K6LabPreferences = {
    selectedServiceId: selectedServiceId || null,
    scriptId: scriptId || null,
    profileId,
    vus: preferences.vus > 0 ? preferences.vus : (profileDefaults?.vus ?? 1),
    duration: isLikelyValidK6Duration(preferences.duration)
      ? preferences.duration
      : (profileDefaults?.duration ?? "30s"),
    rate: preferences.rate === 0 ? (profileDefaults?.rate ?? null) : preferences.rate,
    thresholds: preferences.thresholds,
    k6BinaryPath: preferences.k6BinaryPath,
  };

  return {
    selectedServiceId,
    configForm: {
      profileId: hydratedPreferences.profileId,
      scriptId,
      vus: String(hydratedPreferences.vus),
      duration: hydratedPreferences.duration,
      rate: hydratedPreferences.rate === null ? "" : String(hydratedPreferences.rate),
      thresholds: hydratedPreferences.thresholds.join("\n"),
      k6BinaryPath: hydratedPreferences.k6BinaryPath,
    },
    preferences: hydratedPreferences,
  };
}

function buildPersistablePreferences(
  selectedServiceId: string,
  configForm: K6ConfigFormState,
): K6LabPreferences | null {
  const trimmedVus = configForm.vus.trim();
  const parsedVus = Number(trimmedVus);
  if (!trimmedVus || !Number.isInteger(parsedVus) || parsedVus <= 0) {
    return null;
  }

  const trimmedDuration = configForm.duration.trim();
  if (!isLikelyValidK6Duration(trimmedDuration)) {
    return null;
  }

  const trimmedRate = configForm.rate.trim();
  const parsedRate = trimmedRate ? Number(trimmedRate) : null;
  if (trimmedRate && (!Number.isInteger(parsedRate) || (parsedRate ?? 0) <= 0)) {
    return null;
  }

  return {
    selectedServiceId: selectedServiceId || null,
    scriptId: configForm.scriptId.trim() || null,
    profileId: configForm.profileId.trim() || "smoke",
    vus: parsedVus,
    duration: trimmedDuration,
    rate: parsedRate,
    thresholds: parseMultilineList(configForm.thresholds),
    k6BinaryPath: configForm.k6BinaryPath.trim(),
  };
}

function areConfigFormsEqual(left: K6ConfigFormState, right: K6ConfigFormState) {
  return left.profileId === right.profileId
    && left.scriptId === right.scriptId
    && left.vus === right.vus
    && left.duration === right.duration
    && left.rate === right.rate
    && left.thresholds === right.thresholds
    && left.k6BinaryPath === right.k6BinaryPath;
}

function isLikelyValidK6Duration(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return /^(\d+(ms|s|m|h))+$/i.test(trimmed);
}

function formatRunSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0s";
  }

  if (value >= 60) {
    return `${(value / 60).toFixed(value >= 600 ? 0 : 1)}m`;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}s`;
}

function mapK6StatusPill(status: string) {
  switch (status) {
    case "completed":
      return "running";
    case "cancelled":
      return "stopped";
    case "failed":
      return "error";
    default:
      return "starting";
  }
}

function formatMetric(value: number | null, suffix: string, decimals = 2) {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }

  const rendered = value
    .toFixed(decimals)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
  return suffix ? `${rendered}${suffix}` : rendered;
}

function translateThresholdStatus(status: string) {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    default:
      return "Not evaluated";
  }
}
