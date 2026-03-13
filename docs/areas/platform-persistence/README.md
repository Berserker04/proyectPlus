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

## Checklist local
- [x] `T5.1.1 | US5.1 |` Definir esquema SQLite para `Workspace`, `Service`, `ProcessInstance`, `K6Script` y `K6Run`.
- [x] `T5.1.2 | US5.1 |` Persistir workspaces, servicios detectados y manifests manuales.
- [x] `T5.1.3 | US5.1 |` Restaurar el catalogo al abrir la app sin bloquear la UI.
- [x] `T5.2.1 | US5.2 |` Persistir historial de ejecuciones de servicios.
- [x] `T5.2.2 | US5.2 |` Persistir historial de corridas k6 y preferencias del usuario.
- [x] `T5.2.3 | US5.2 |` Implementar pantalla `Settings` con rutas por defecto, shell permitida, refresh, tema, GPU y `k6 path`.
- [x] `T5.3.1 | US5.3 |` Aplicar allowlist estricta de comandos y rutas permitidas.
- [x] `T5.3.2 | US5.3 |` Encapsular shell y procesos mediante capacidades de Tauri.
- [x] `T5.3.3 | US5.3 |` Definir y aplicar la politica de limpieza o marcado de procesos huerfanos al cerrar la app.

## Cambios no previstos incorporados
- [x] `SC-001` Bootstrap tecnico del repo con estructura React/Vite, base `src-tauri`, configuracion inicial y shell visual para empezar las historias funcionales.
- [x] `SC-002` Recurso minimo `src-tauri/icons/icon.ico` agregado para destrabar la validacion nativa de Tauri en Windows.
- [x] `SC-003` Limpieza del snapshot publico y de la UI para remover paneles internos de toolchain/bootstrap y mensajes de avance tecnico.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
