# Area Platform And Persistence

## Proposito y alcance
Esta area cubre persistencia local, settings, seguridad operativa, allowlists y manejo de procesos huerfanos. Tambien sirve de soporte transversal para discovery, operations, observability y k6-lab.

## Epica e historias relacionadas
- [x] `E5` Persistencia y settings
- [x] `US5.1` Persistir workspaces, servicios y manifests
- [x] `US5.2` Persistir ejecuciones, corridas k6 y preferencias
- [x] `US5.3` Aplicar guardrails de seguridad y limpieza de procesos

## Decisiones actuales
- SQLite sera el almacenamiento local para workspaces, servicios, ejecuciones, corridas k6 y preferencias.
- La shell y los procesos del sistema deben quedar encapsulados por el modelo de capacidades de Tauri.
- El cierre de la app debe limpiar procesos lanzados por ella o marcarlos claramente como huerfanos.
- Se adopta un bootstrap tecnico manual del repo para mantener control sobre el scaffolding de React, Vite y Tauri 2.
- El catalogo del MVP ya se restaura desde SQLite en el arranque y vuelve a persistirse al seleccionar o reescanear el workspace activo.
- El snapshot publico del dashboard queda limitado a `workspaces`, `services` y `system`; deja de exponer instrumentacion interna de toolchain o bootstrap.
- El catalogo ahora tambien persiste el ultimo estado operativo, la ultima senal y el ultimo issue estructurado por servicio para poder recuperar errores y huerfanos al reiniciar la app.
- El catalogo de `k6_script` ahora distingue origen `autodiscovery` vs `manual`, y la vista del laboratorio solo expone scripts del workspace activo.
- `k6_run.summary_json` pasa a ser el contrato operativo de persistencia para corridas k6: guarda config, outcome, warning por servicio detenido, `summaryExportPath`, resumen parseado y tail de salida.
- Ese mismo wrapper ahora tambien alimenta el resumen del historial: de ahi salen metricas clave, thresholds evaluados localmente y la futura URL de dashboard externo si la corrida la registra.
- Los artefactos de cada corrida k6 se escriben bajo `app_data_dir()/k6-runs/<run_id>/`, con `result.json` y `summary.json` desacoplados del schema base de SQLite.
- `user_preference` pasa a ser la capa generica para preferencias persistidas con scope `global` y `workspace`, preparada para reutilizarse en `Settings`.
- El laboratorio k6 ya restaura su ultimo contexto por workspace (`service`, `script`, `profile`, `vus`, `duration`, `rate`, `thresholds`) y conserva `k6BinaryPath` como preferencia global.
- La pantalla `Settings` ya persiste tema, refresh operativo, modo GPU, rutas por defecto, shell preferida y `k6BinaryPath`, y reutiliza el mismo contrato de `user_preference`.
- La UI ahora renderiza una sola identidad visual firma; la preferencia `theme` se conserva solo como compatibilidad de persistencia y ya no define variantes visibles del shell.
- El selector de workspace y la exportacion de logs ya usan las rutas por defecto configuradas en `Settings` como hint del dialogo nativo.
- La apertura rapida de terminal ya respeta la shell preferida configurada en `Settings` y ahora bloquea shells fuera de `allowedShells`.
- El modo GPU `disabled` ya evita consultas best effort de `nvidia-smi` sin afectar CPU, RAM, puertos ni uptime.
- `process_instance` pasa a ser el contrato operativo del historial de ejecuciones por servicio: guarda trigger `run/restart`, comando, PID, puerto, estado, timestamps, senal final e issue estructurado.
- El reescaneo del workspace ya no borra en cascada historiales de ejecucion para servicios que conservan el mismo ID estable por path.
- La validacion nativa de Tauri en Windows depende de un recurso `icon.ico`; el repo ya incluye un icono minimo para no bloquear `cargo check` ni `cargo test`.
- Los manifests manuales del workspace se guardan en `.ms-control-center/services.manifest.json` y luego se materializan en SQLite al refrescar el catalogo.
- La allowlist del MVP para `startCommand` queda limitada a launchers de ecosistema Node/Nest (`npm`, `pnpm`, `yarn`, `bun`, `node`, `nest`, `nx`, `turbo`, `tsx`, etc.) y bloquea chaining, pipes, redirecciones y escapes por ruta.
- Las rutas sensibles ya se revalidan contra el workspace activo: directorios de servicio, launchers relativos y scripts k6 no pueden escapar del root permitido.
- `k6BinaryPath` ya se valida como binario explicito de `k6` o `k6.exe`; cualquier otro ejecutable se rechaza antes de persistirse o ejecutarse.
- El `build.rs` de Tauri ya declara un `AppManifest` con todos los comandos propios del producto para que el sistema genere permisos `allow-*` y deje de depender de `core:default`.
- La capability `default` ahora queda reducida a la ventana `main`, modo local, y consume solo el set `desktop-main` definido en `src-tauri/permissions/app-desktop.toml`.
- Los comandos sensibles quedan agrupados por sets (`catalog-read`, `workspace-management`, `service-runtime`, `k6-runtime`) para preparar una futura segmentacion por ventanas o webviews sin reabrir el IPC entero.
- El dashboard, Settings y el laboratorio k6 ya no muestran copy de avance tecnico ni paneles internos de infraestructura; solo mensajes funcionales o restricciones accionables.
- La shell frontend ya quedo fragmentada en sidebar, resumen, servicios, laboratorio k6 y ajustes, sin introducir routing ni cambiar contratos Tauri o SQLite.
- La inicializacion de schema SQLite ahora ocurre una sola vez al arrancar la app; `open_connection()` queda como apertura liviana para no penalizar cada comando del polling.
- La plataforma ahora mantiene caches internos para telemetria del dashboard y para el ultimo reporte k6 parseado, desacoplando rutas caras de persistencia y lectura frecuente.
- `user_preference` ahora tambien persiste la `project_topology` por proyecto: layout de nodos, dimensiones y edges manuales del canvas React Flow.
- `microservice` ya incorpora el campo `kind` para diferenciar `service` y `worker` sin abrir un runtime nuevo.
- La plataforma expone comandos Tauri dedicados para leer y guardar topologia por proyecto, manteniendo el snapshot runtime separado de esa capa visual.
- La capability `default` de desktop ahora referencia el set `desktop-main` y vuelve a incluir permisos para topologia (`get/save_project_topology`) y eventos core (`core:event:default`) necesarios para logs y refresh reactivos.
- `SC-010` no abre nuevos contratos backend: la topologia y permisos existentes se mantienen, mientras el frontend endurece la interaccion usando `focusedServiceId` como fuente de verdad del canvas.
- `tauri:dev` ahora arranca via `scripts/tauri-dev.mjs`: limpia `ms-control-center.exe` huerfanos del repo, valida colisiones en `127.0.0.1:1420` y fuerza `RUST_BACKTRACE=1` para que los fallos nativos de desktop queden diagnosticables.
- Ese wrapper ahora tambien inspecciona el arbol `shell/cmd/npm/tauri/vite` alrededor del listener de `1420` y usa `taskkill /T /F` para cortar sesiones repo-locales stale sin confundirlas con procesos ajenos.
- `TelemetryCache` ahora se inicializa con RAM y CPU global, y el refresh periodico del dashboard solo actualiza PIDs supervisados; esto evita que el shell desktop haga scans completos de procesos al arrancar en Windows.
- `RefreshConfig` ahora mantiene cadencias `normal` y `realtime`, un lock explicito alrededor de `build_snapshot()` y un worker coalescido para serializar refreshes urgentes y periodicos del dashboard.
- Guardar `AppSettings` ya actualiza ambos intervalos (`dashboardRefreshSeconds` y `realtimeRefreshSeconds`) sin depender de mutaciones ad hoc en el ticker.

## Checklist local
- [x] `T5.1.1 | US5.1 |` Definir esquema SQLite para `Workspace`, `Service`, `ProcessInstance`, `K6Script` y `K6Run`.
- [x] `T5.1.2 | US5.1 |` Persistir workspaces, servicios detectados y manifests manuales.
- [x] `T5.1.3 | US5.1 |` Restaurar el catalogo al abrir la app sin bloquear la UI.
- [x] `T5.2.1 | US5.2 |` Persistir historial de ejecuciones de servicios.
- [x] `T5.2.2 | US5.2 |` Persistir historial de corridas k6 y preferencias del usuario.
- [x] `T5.2.3 | US5.2 |` Implementar pantalla `Settings` con rutas por defecto, shell permitida, refresh, tema, GPU y `k6 path`.
- [x] `T5.2.4 | US5.2 |` Mover inicializacion de schema y persistencia frecuente a rutas livianas para que SQLite y preferencias no penalicen cada refresh operativo.
- [x] `T5.3.1 | US5.3 |` Aplicar allowlist estricta de comandos y rutas permitidas.
- [x] `T5.3.2 | US5.3 |` Encapsular shell y procesos mediante capacidades de Tauri.
- [x] `T5.3.3 | US5.3 |` Definir y aplicar la politica de limpieza o marcado de procesos huerfanos al cerrar la app.

## Cambios no previstos incorporados
- [x] `SC-005` Pasada de estabilizacion desktop con init de schema una vez por proceso, cache de snapshot/reportes y rutas de persistencia livianas para polling operativo.
- [x] `SC-001` Bootstrap tecnico del repo con estructura React/Vite, base `src-tauri`, configuracion inicial y shell visual para empezar las historias funcionales.
- [x] `SC-002` Recurso minimo `src-tauri/icons/icon.ico` agregado para destrabar la validacion nativa de Tauri en Windows.
- [x] `SC-003` Limpieza del snapshot publico y de la UI para remover paneles internos de toolchain/bootstrap y mensajes de avance tecnico.
- [x] `SC-004` Rediseño integral de la shell UI/UX con una sola identidad visual, navegacion lateral persistente y reorganizacion completa de las superficies frontend sin cambiar persistencia ni backend.

- `SC-008`: la plataforma ahora persiste topologia React Flow por proyecto y extiende el contrato de `microservice` con `kind` y metadata visual.
- `SC-009`: se alinearon build manifest, permissions y capabilities para exponer topologia y eventos en vivo sin errores `not allowed` en la shell desktop.
- `SC-010`: no hubo cambios de schema ni de IPC; la plataforma sostiene el mismo contrato de topologia mientras el frontend completa el hardening de seleccion y drag en el canvas.
- `SC-016`: el launcher de desarrollo desktop ahora endurece el arranque local limpiando procesos huerfanos del repo, diagnosticando conflictos del puerto `1420` y forzando `RUST_BACKTRACE=1`.
- `SC-017`: la plataforma acoto el uso de `sysinfo` del dashboard para que el proceso desktop no intente cargar toda la tabla de procesos del SO durante el arranque local en Windows.
- `SC-018`: el launcher ahora tambien resuelve listeners `1420` que quedaron colgados detras de wrappers `shell/cmd/npm/tauri/vite`, cerrando el arbol repo-local completo antes de relanzar.
- `SC-029`: la plataforma introdujo un coordinador de refresh serializado para el dashboard, eliminando rebuilds concurrentes de snapshot y haciendo que las preferencias de refresh normal/realtime gobiernen la emision real del estado operativo.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
