# Roadmap vivo del MVP

## Reglas de uso
- Todas las tareas parten en `[ ]` hasta que exista trabajo ejecutado del producto.
- Marcar una tarea `T#.#.#` en `[x]` cuando el trabajo este realmente cerrado.
- Marcar una historia en `[x]` solo cuando todas sus tareas esten en `[x]` y su aceptacion se cumpla.
- Registrar cualquier trabajo no previsto en `Scope changes` antes de cerrar el prompt.

## Estado inicial
Este roadmap representa el backlog operativo del MVP. La base documental ya existe, pero el producto aun no tiene tareas funcionales marcadas como completadas.

## E1 - Descubrimiento y dashboard inicial
Dependencias de epica:
- Coordinar con `E5` para persistencia de workspaces y manifests.

Definition of done:
- Existe un flujo de seleccion y recuerdo de workspace.
- La app detecta servicios Nest de forma automatica y permite override manual.
- El dashboard inicial muestra informacion minima, orden y filtros base.

### [x] US1.1 - Registrar y recordar workspaces locales
- [x] `T1.1.1 | US1.1 |` Definir el modelo de `Workspace` con `rootPath`, nombre visible y timestamps.
- [x] `T1.1.2 | US1.1 |` Implementar selector de carpeta raiz con reescaneo manual del workspace.
- [x] `T1.1.3 | US1.1 |` Persistir lista de workspaces recientes y ultimo workspace activo.

### [x] US1.2 - Descubrir servicios Nest automaticamente
- [x] `T1.2.1 | US1.2 |` Definir heuristicas de deteccion Nest usando `package.json`, `nest-cli.json`, scripts y estructura tipica.
- [x] `T1.2.2 | US1.2 |` Implementar escaneo incremental para repos separados y carpetas multiproyecto.
- [x] `T1.2.3 | US1.2 |` Resolver metadata minima por servicio: nombre, path, runtime, framework y puerto estimado.

### [x] US1.3 - Permitir manifests y servicios manuales
- [x] `T1.3.1 | US1.3 |` Definir esquema de manifest manual por servicio con comandos, puerto, tags, env y tipo.
- [x] `T1.3.2 | US1.3 |` Implementar prioridad `manifest > convencion > heuristica` en la resolucion de metadata.
- [x] `T1.3.3 | US1.3 |` Permitir registrar servicios manuales que no aparezcan en autodiscovery.

### [x] US1.4 - Visualizar tablero inicial con orden y filtros
- [x] `T1.4.1 | US1.4 |` Disenar la vista principal con nombre, ruta, framework, estado, PID, puerto y uptime.
- [x] `T1.4.2 | US1.4 |` Implementar orden por nombre, estado, puerto, RAM, CPU y fecha de inicio.
- [x] `T1.4.3 | US1.4 |` Implementar filtros por estado, tipo de servicio, tags y busqueda textual.
- [x] `T1.4.4 | US1.4 |` Estabilizar la pantalla de servicios con subarboles mas estables, memoizacion y refresco contextual sin degradar el SLA visual.

## E2 - Operacion de servicios
Dependencias de epica:
- `E1` para catalogo y metadata de servicios.
- `E5` para historial y politicas de seguridad.

Definition of done:
- La UI puede iniciar, detener y reiniciar servicios supervisados.
- La app puede abrir recursos operativos asociados al servicio.
- Los conflictos de arranque y puertos se comunican de forma clara.

### [x] US2.1 - Iniciar servicios desde la UI
- [x] `T2.1.1 | US2.1 |` Modelar la accion `Run` con feedback inmediato y estado `starting`.
- [x] `T2.1.2 | US2.1 |` Lanzar procesos supervisados y correlacionar servicio, PID y puerto.
- [x] `T2.1.3 | US2.1 |` Reportar error estructurado cuando falle el arranque.

### [x] US2.2 - Detener y reiniciar servicios supervisados
- [x] `T2.2.1 | US2.2 |` Implementar `Stop` con cierre controlado de procesos lanzados por la app.
- [x] `T2.2.2 | US2.2 |` Implementar `Restart` con historial de intento y reejecucion del comando.
- [x] `T2.2.3 | US2.2 |` Detectar y marcar procesos huerfanos al reiniciar o cerrar la app.

### [x] US2.3 - Ejecutar acciones operativas rapidas y manejar conflictos
- [x] `T2.3.1 | US2.3 |` Implementar `Open folder` y `Open terminal in folder`.
- [x] `T2.3.2 | US2.3 |` Implementar `Copy port` y `Copy command`.
- [x] `T2.3.3 | US2.3 |` Advertir puertos ocupados y enlazar la apertura de logs desde la UI.

## E3 - Observabilidad local
Dependencias de epica:
- `E2` para procesos supervisados.
- `E5` para persistencia eventual de historicos basicos.

Definition of done:
- La UI muestra estado tecnico de cada servicio en tiempo real.
- La app expone CPU, RAM, puertos y GPU con alcance honesto.
- La app permite revisar logs en vivo con controles minimos.

### [x] US3.1 - Ver metricas y estado operativo por servicio
- [x] `T3.1.1 | US3.1 |` Recolectar CPU y RAM por proceso y totales del sistema.
- [x] `T3.1.2 | US3.1 |` Resolver puertos en escucha y uptime por servicio.
- [x] `T3.1.3 | US3.1 |` Emitir refrescos de estado cada 1 o 2 segundos sin bloquear la UI.
- [x] `T3.1.4 | US3.1 |` Cachear telemetria y probes de puerto por ciclo de dashboard para sostener el polling de 1s/2s sin recalculo nativo redundante.

### [x] US3.2 - Exponer GPU global y por proceso cuando aplique
- [x] `T3.2.1 | US3.2 |` Integrar lectura de GPU global con soporte prioritario para NVIDIA.
- [x] `T3.2.2 | US3.2 |` Exponer GPU por proceso cuando el entorno lo soporte de forma confiable.
- [x] `T3.2.3 | US3.2 |` Mostrar fallback `Not available` o equivalente cuando no haya datos confiables.

### [x] US3.3 - Consultar logs en vivo con controles basicos
- [x] `T3.3.1 | US3.3 |` Capturar `stdout` y `stderr` en un buffer en memoria por servicio.
- [x] `T3.3.2 | US3.3 |` Implementar resaltado por nivel, busqueda y limpieza del buffer visible.
- [x] `T3.3.3 | US3.3 |` Implementar pausa de autoscroll y exportacion manual de logs.
- [x] `T3.3.4 | US3.3 |` Limitar polling y render de logs e historial solo a la pestana visible del inspector para evitar trabajo oculto y scroll encadenado.

## E4 - Laboratorio k6
Dependencias de epica:
- `E2` para operar servicios objetivos.
- `E5` para persistir corridas y preferencias.

Definition of done:
- La app permite preparar corridas k6 desde UI.
- La app ejecuta y cancela corridas k6 locales.
- La app persiste resultados y muestra graficas minimas del MVP.

### [x] US4.1 - Registrar scripts y perfiles de prueba
- [x] `T4.1.1 | US4.1 |` Descubrir o registrar scripts k6 por servicio o endpoint.
- [x] `T4.1.2 | US4.1 |` Exponer perfiles `smoke`, `load`, `stress` y `spike` con parametros editables.
- [x] `T4.1.3 | US4.1 |` Validar thresholds basicos y ruta configurada del binario k6.

### [x] US4.2 - Ejecutar y cancelar corridas k6 desde la app
- [x] `T4.2.1 | US4.2 |` Ejecutar k6 CLI como proceso hijo y capturar `stdout` y `stderr`.
- [x] `T4.2.2 | US4.2 |` Permitir cancelar una corrida en curso desde la UI.
- [x] `T4.2.3 | US4.2 |` Guardar el resultado JSON y un resumen estructurado por corrida.

### [x] US4.3 - Visualizar resultados, graficas e historial basico
- [x] `T4.3.1 | US4.3 |` Parsear metricas clave: `avg`, `p95`, `p99`, `rps`, errores, VUs, duracion, checks y thresholds.
- [x] `T4.3.2 | US4.3 |` Renderizar graficas dentro de la app con `ECharts`.
- [x] `T4.3.3 | US4.3 |` Exponer historial basico de corridas y opcion de abrir dashboard externo cuando se habilite.
- [x] `T4.3.4 | US4.3 |` Reutilizar instancias de chart y cachear el ultimo reporte k6 para evitar parseo y recreacion completa por cada poll activo.

## E5 - Persistencia y settings
Dependencias de epica:
- Ninguna bloqueante. Esta epica soporta transversalmente a `E1`, `E2`, `E3` y `E4`.

Definition of done:
- La app recuerda workspaces, servicios, manifests e historicos basicos.
- La app expone settings operativos relevantes.
- La app aplica guardrails de seguridad y manejo de procesos huerfanos.

### [x] US5.1 - Persistir workspaces, servicios y manifests
- [x] `T5.1.1 | US5.1 |` Definir esquema SQLite para `Workspace`, `Service`, `ProcessInstance`, `K6Script` y `K6Run`.
- [x] `T5.1.2 | US5.1 |` Persistir workspaces, servicios detectados y manifests manuales.
- [x] `T5.1.3 | US5.1 |` Restaurar el catalogo al abrir la app sin bloquear la UI.

### [x] US5.2 - Persistir ejecuciones, corridas k6 y preferencias
- [x] `T5.2.1 | US5.2 |` Persistir historial de ejecuciones de servicios.
- [x] `T5.2.2 | US5.2 |` Persistir historial de corridas k6 y preferencias del usuario.
- [x] `T5.2.3 | US5.2 |` Implementar pantalla `Settings` con rutas por defecto, shell permitida, refresh, tema, GPU y `k6 path`.
- [x] `T5.2.4 | US5.2 |` Mover inicializacion de schema y persistencia frecuente a rutas livianas para que SQLite y preferencias no penalicen cada refresh operativo.

### [x] US5.3 - Aplicar guardrails de seguridad y limpieza de procesos
- [x] `T5.3.1 | US5.3 |` Aplicar allowlist estricta de comandos y rutas permitidas.
- [x] `T5.3.2 | US5.3 |` Encapsular shell y procesos mediante capacidades de Tauri.
- [x] `T5.3.3 | US5.3 |` Definir y aplicar la politica de limpieza o marcado de procesos huerfanos al cerrar la app.

## Scope changes
- [ ] `SC-006 | discovery, operations, observability, platform-persistence |` Reorientar el producto al MVP manual del PRD canonico: proyectos y microservicios manuales, runtime basico, logs, CPU/RAM y graficas ligeras; retirar autodiscovery, k6, GPU y superficies fuera de alcance.
- [x] `SC-007 | operations, observability, ui |` Implementar mejoras de UX: Bulk Actions (proyectos), Selección nativa de directorios, Toasts Notifications, Sidebar status, validación de puertos ocupados, reordenamiento Drag & Drop, resaltado y filtros de logs.
- [x] `SC-001 | platform-persistence |` Bootstrap tecnico del repo con estructura manual React/Vite, base `src-tauri`, configuracion inicial y shell visual del dashboard para iniciar la implementacion funcional.
- [x] `SC-002 | platform-persistence |` Agregar el recurso minimo `src-tauri/icons/icon.ico` para permitir validacion nativa de Tauri en Windows durante el desarrollo local.
- [x] `SC-003 | discovery, platform-persistence |` Remover del producto y del snapshot publico los paneles internos de toolchain/bootstrap y el copy de avance tecnico, dejando solo informacion funcional y operativa en dashboard, settings y laboratorio k6.
- [x] `SC-004 | discovery, operations, observability, k6-lab, platform-persistence |` Redisenar integralmente la shell UI/UX con estetica dark premium, navegacion lateral persistente, resumen ejecutivo, vista maestro-detalle de servicios, laboratorio k6 dedicado y una sola identidad visual firma manteniendo los contratos backend existentes.
- [x] `SC-005 | discovery, observability, k6-lab, platform-persistence |` Pasada profesional de estabilizacion de rendimiento desktop: cache de telemetria y reportes, polling contextual por vista y reutilizacion de subarboles/charts para sostener fluidez sin bajar la cadencia de refresh.
- [x] `SC-008 | discovery, operations, observability, platform-persistence |` Migrar la shell principal a React Flow con canvas persistido por proyecto, nodos `service/worker`, edges manuales y un inspector lateral derecho con logs vivos y tabs placeholder para eventos, k6 y alertas.
- Plantilla de registro:
  - [ ] `SC-001 | area |` Descripcion del cambio detectado, razon, impacto en historias y docs afectados.
