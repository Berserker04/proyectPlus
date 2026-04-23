# Area Operations

## Proposito y alcance
Esta area cubre el ciclo de vida operativo de los servicios: iniciar, detener, reiniciar y ejecutar acciones rapidas sobre cada servicio desde la interfaz.

## Epica e historias relacionadas
- [x] `E2` Operacion de servicios
- [x] `US2.1` Iniciar servicios desde la UI
- [x] `US2.2` Detener y reiniciar servicios supervisados
- [x] `US2.3` Ejecutar acciones operativas rapidas y manejar conflictos

## Decisiones actuales
- El boton principal sera `Run` para servicios detenidos y `Stop`/`Restart` para servicios en ejecucion.
- Todo proceso iniciado por la app debe quedar supervisado para poder detenerse o reiniciarse de forma controlada.
- Los conflictos de arranque, especialmente puertos ocupados y comandos invalidos, deben mostrarse como errores estructurados.
- `US2.1` se resuelve con un supervisor en memoria: la UI solicita `Run`, el backend lanza el proceso, refleja `starting` y refresca el snapshot hasta `running` o `error`.
- `Run` y `Restart` ahora se despachan fuera del hilo critico de Tauri con `spawn_blocking`; la app marca el servicio como `starting` antes del trabajo pesado y solo emite un snapshot final cuando termina el lanzamiento.
- La correlacion de puerto para nodos supervisados ahora es runtime-only: el backend inspecciona el arbol del proceso y toma el primer listener TCP local que encuentra como `detectedPort`.
- `US2.2` cierra `Stop` y `Restart` sobre el mismo supervisor: `Stop` corta el arbol de procesos y `Restart` reusa el catalogo del servicio para relanzarlo sin perder supervision.
- En Windows, el cierre operativo usa `taskkill /PID <pid> /T /F` sobre el proceso shell supervisado para poder matar tambien hijos del comando de arranque.
- Si el cierre no logra liberar el puerto o la app encuentra estados `starting/running` sin supervisor al reabrir, el servicio se marca como `error` con issue estructurado de proceso huerfano o arranque interrumpido.
- `US2.3` agrega accesos rapidos nativos por servicio: abrir carpeta, abrir terminal, copiar puerto, copiar comando y un handoff de logs desde la UI hacia el contexto operativo actual.
- Los nodos nuevos ya no piden `Puerto esperado`; los conflictos preventivos solo siguen siendo posibles en registros legacy que todavia conservan ese dato persistido.
- El handoff de logs no intenta suplir `US3.3`: por ahora centraliza ultima senal, issue, ruta, puerto y comando como punto de entrada operativo.
- `Run` y `Restart` ya validan `startCommand` contra una allowlist estricta de launchers y rechazan chaining, pipes, redirecciones o rutas relativas que intenten salir del workspace activo.
- `Open terminal` ya valida que la shell preferida este incluida en `allowedShells`; si no, la accion se bloquea con error estructurado en vez de abrir una shell arbitraria.
- Esas acciones operativas ya no dependen de un IPC abierto por defecto: la ventana `main` las obtiene mediante permisos explicitos del app manifest agrupados en el set `service-runtime`.
- La operacion ya no vive en una tabla ancha: la UI expone acciones primarias en tarjetas compactas y un inspector lateral con tabs de `Resumen`, `Logs`, `Historial` y `Configuracion`.
- Los accesos rapidos operativos (`detener`, `reiniciar`, carpeta, terminal, copiar puerto/comando`) quedaron visibles tanto en la lista como en el inspector para reducir cambios de contexto.
- El sidebar izquierdo ahora expone una utilidad adicional por puerto: el usuario puede ingresar un `port`, resolver el listener TCP activo y cortar su arbol con `taskkill /T /F` sin salir del dashboard.
- `Port tools` ya no corre en el hilo critico de Tauri y mantiene un pending propio en UI; liberar un puerto no debe congelar acciones no relacionadas mientras el kill y la resincronizacion terminan.
- La operacion principal ahora sucede sobre nodos React Flow: `Run`, `Stop`, `Restart`, logs, shell y edicion viven tanto en el nodo como en el inspector derecho.
- Los edges manuales del canvas no alteran todavia el runtime; en esta iteracion solo modelan relaciones visuales y contexto operativo por proyecto.
- Tras la estabilizacion del canvas, el nodo quedo reducido a acciones runtime (`Start`, `Stop`, `Restart`) y las acciones secundarias permanecen solo en el inspector para no competir con drag ni conexiones.
- Las acciones runtime embebidas ahora reafirman el foco del inspector antes de ejecutar `Start`, `Stop` o `Restart`, evitando clicks perdidos y arrastres accidentales sobre el nodo.
- El overlay de conexion ahora cubre toda la tarjeta del nodo, pero el grip de drag y los botones runtime quedan aislados por encima para que conectar, mover y operar no compitan entre si.
- La conmutacion entre nodos desde el inspector ya se resuelve con dos selects por tipo (`microservices` y `workers`), manteniendo las acciones runtime ligadas al foco actual sin llenar la rail de botones.
- Las acciones runtime y utilitarias del inspector ya no comparten espacio con topology y logs en la misma columna visible; ahora viven en la tab `Overview`, lo que reduce ruido y mantiene el rail operativo mas legible.
- Cada `Start` o `Restart` sobre el servicio enfocado limpia el buffer visible de logs antes de la nueva corrida, evitando que el inspector mezcle la salida anterior con la actual.
- Si un watcher deja vivo el wrapper de desarrollo pero el microservicio queda bloqueado durante bootstrap o pierde el bind del puerto, operaciones lo marca como `error` sin perder la posibilidad de `Stop` o `Restart` mientras exista PID supervisado.
- Ese criterio de bloqueo ahora cubre tambien fallas Prisma de inicializacion de base de datos, para que un watcher vivo sin listener real no quede en estado `running`.
- `Start all` conserva el orden actual del proyecto, pero corre como cola no bloqueante: el canvas y el inspector siguen interactivos y el boton bulk no permite un segundo disparo mientras la cola sigue viva.
- El runtime ya no reconstruye snapshots inline desde cada accion o linea critica de logs; un worker de refresh coalescido absorbe el estado `starting` y la resincronizacion operativa sin duplicar trabajo pesado.
- La cadencia rapida del dashboard ahora respeta `realtimeRefreshSeconds` cuando hay servicios supervisados activos o un refresh urgente en cola.
- Las acciones `Run`, `Stop`, `Restart` y `Port tools` ya no disparan resincronizacion de topology manifests; el canvas derivado se actualiza solo cuando el usuario ejecuta `Refresh topology`.
- Para bounded contexts StylePlus `hybrid`, operaciones asume un solo `/internal/topology` expuesto por la API y deja que ese endpoint reporte tambien el estado del worker, sin intentar descubrir un segundo endpoint por separado.

## Checklist local
- [x] `T2.1.1 | US2.1 |` Modelar la accion `Run` con feedback inmediato y estado `starting`.
- [x] `T2.1.2 | US2.1 |` Lanzar procesos supervisados y correlacionar servicio, PID y puerto.
- [x] `T2.1.3 | US2.1 |` Reportar error estructurado cuando falle el arranque.
- [x] `T2.1.4 | US2.1 |` Ejecutar `Run` y `Restart` fuera del hilo critico de Tauri con feedback inmediato en `starting`.
- [x] `T2.1.5 | US2.1 |` Mantener `Start all` secuencial y no bloqueante, evitando dobles disparos mientras la cola corre.
- [x] `T2.2.1 | US2.2 |` Implementar `Stop` con cierre controlado de procesos lanzados por la app.
- [x] `T2.2.2 | US2.2 |` Implementar `Restart` con historial de intento y reejecucion del comando.
- [x] `T2.2.3 | US2.2 |` Detectar y marcar procesos huerfanos al reiniciar o cerrar la app.
- [x] `T2.3.1 | US2.3 |` Implementar `Open folder` y `Open terminal in folder`.
- [x] `T2.3.2 | US2.3 |` Implementar `Copy port` y `Copy command`.
- [x] `T2.3.3 | US2.3 |` Advertir puertos ocupados y enlazar la apertura de logs desde la UI.
- [x] `T2.3.4 | US2.3 |` Ejecutar `Port tools` fuera del hilo critico de Tauri y aislar su pending en UI.

## Cambios no previstos incorporados
- `SC-004`: se rediseño la experiencia operativa hacia un patron maestro-detalle con acciones compactas e inspector persistente, sin cambiar contratos del supervisor.
- `SC-007`: se mejoró la UX sustancialmente, agregando controles bulk a nivel de proyecto (run all / stop all), notificaciones en toasts, validación de puertos ocupados mediante Tauri, filtros de logs, y reordenamiento del UI persistido en base de datos.

- `SC-008`: operaciones ya no se disparan desde tarjetas; ahora viven en un canvas React Flow con nodos `service/worker` y un inspector lateral persistente.
- `SC-009`: las interacciones del canvas quedaron separadas por intencion: drag desde el header, seleccion fiable por click y acciones operativas secundarias solo en la rail derecha.
- `SC-010`: operaciones termino de blindar botones y labels del canvas con `nodrag` y `nopan`, y alinea el foco del inspector con cualquier accion runtime disparada desde el nodo.
- `SC-011`: operaciones compacto el switcher del inspector derecho con selects por tipo para sostener la escalabilidad visual del rail sin cambiar los contratos runtime.
- `SC-020`: operaciones elimino el campo manual de puerto del modal de nodos y ahora refleja solo el puerto TCP real detectado tras arrancar el proceso supervisado.
- `SC-022`: operaciones limpia el buffer visible de logs al hacer `Start` o `Restart` del servicio enfocado y deja que el rojo del nodo represente solo fallas reales del runtime, no ruido de logs.
- `SC-023`: operaciones agrego una accion global en el sidebar para liberar un puerto ocupado; si el listener pertenece a un nodo supervisado, el supervisor tambien se limpia para no dejar estado inconsistente.
- `SC-026`: operaciones saco `Run`/`Restart`/`Stop` del hilo critico de Tauri, reaprovecho un solo snapshot por accion y dejo `Start all` como cola secuencial no bloqueante con bloqueo local del boton bulk.
- `SC-027`: operaciones ahora detecta como fallo real los bootstraps Prisma que dejan vivo el watcher pero nunca abren listener, manteniendo disponibles `Stop` y `Restart` sobre el wrapper supervisado.
- `SC-028`: operaciones movio `Port tools` a `spawn_blocking`, evito snapshots redundantes al limpiar nodos supervisados y desacoplo su pending del bloqueo global de la UI.
- `SC-029`: operaciones movio la resincronizacion del dashboard a un worker coalescido con prioridad `urgent`, dejo `Run`/`Restart` libres de rebuilds redundantes y mantuvo el estado `starting` visible sin volver a cargar el hilo critico.
- `SC-030`: operaciones conecta el runtime con la nueva capa de topology por manifests, dejando la recalibracion de edges y readiness disponible cuando el usuario resincroniza topology desde el canvas.
- `SC-030`: operaciones ya respeta el contrato `hybrid` de StylePlus y los port hints canonicos para resincronizar topologia aunque el puerto real aun no haya sido detectado por supervision local.
- `SC-031`: operaciones mueve `Start`, `Stop`, `Restart`, carpeta, shell y edicion a un `Overview` tab dedicado dentro del inspector, separando el diagnostico operativo de `Topology`, `Logs` y `Alerts`.
- `SC-032`: operaciones deja de disparar refresh de topology desde acciones runtime o `Port tools`; la resincronizacion derivada queda bajo control manual desde el boton `Refresh topology`.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
