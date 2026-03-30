# Area Observability

## Proposito y alcance
Esta area cubre metricas por servicio, puertos, consumo de recursos, soporte GPU best-effort y la experiencia de logs en vivo del MVP.

## Epica e historias relacionadas
- [x] `E3` Observabilidad local
- [x] `US3.1` Ver metricas y estado operativo por servicio
- [x] `US3.2` Exponer GPU global y por proceso cuando aplique
- [x] `US3.3` Consultar logs en vivo con controles basicos

## Decisiones actuales
- En Windows, la app consulta CPU, RAM y procesos mediante telemetria del SO via `PowerShell`/`CIM`, sin agregar dependencias nuevas al core.
- El dashboard refresca el snapshot cada 2 segundos y acelera a 1 segundo mientras algun servicio esta en `starting`.
- El puerto visible de nodos supervisados se autodetecta inspeccionando el arbol del proceso y sus listeners TCP locales en Windows; `expectedPort` queda solo como compatibilidad para detectar procesos externos heredados.
- La capa GPU del MVP es `best effort`: intenta usar `nvidia-smi` desde `PATH` o desde la instalacion tipica de NVIDIA en Windows.
- GPU global se calcula solo cuando `nvidia-smi` devuelve datos confiables; en ese caso se expone el promedio de utilizacion de las GPUs visibles.
- GPU por proceso se cruza por PID usando `nvidia-smi pmon` y memoria de `compute-apps`; si el driver, el modo del dispositivo o el vendor no lo soportan, la UI muestra `Not available`.
- Los logs del MVP viviran en memoria con exportacion manual; no se incluye persistencia historica completa.
- El supervisor lanza procesos con `stdout` y `stderr` en `pipe`, conserva un buffer circular en memoria por servicio y lo expone a la UI con polling liviano.
- La severidad de los logs es best effort: usa palabras clave (`error`, `warn`, `debug`, `trace`) y fallback por stream (`stderr` -> `error`).
- La severidad de los logs colorea la lectura dentro del inspector, pero ya no fuerza el rojo del nodo por si sola; el canvas reserva el tono critico para fallas bloqueantes reales del runtime.
- `Start` y `Restart` reinician el buffer visible del servicio enfocado para que la nueva corrida no herede el contexto visual anterior en el inspector.
- Cuando el servicio corre bajo un watcher que deja un wrapper vivo, observabilidad combina senales de error fatal en logs con ausencia de listener TCP para detectar bootstraps caidos sin depender solo del PID del wrapper.
- Esa deteccion de bootstrap bloqueante ahora incluye fallas Prisma de inicializacion de base de datos como `PrismaClientInitializationError` o `P1001`, siempre que el servicio no alcance a abrir listener TCP.
- La UI ya permite buscar dentro del buffer, filtrar por stream, limpiar el buffer, pausar autoscroll y exportar un `.log` manual.
- La observabilidad ahora se reparte entre `Resumen` e inspector de servicios: la vista ejecutiva concentra salud global, focos y hotspots, mientras logs e historial quedan dentro del contexto del servicio seleccionado.
- El rediseño mantiene el mismo polling y fuentes de telemetria, pero mejora la jerarquia visual con cards de metricas, chips de estado y paneles de incidencias.

- La telemetria del dashboard ahora se sirve desde una cache por ciclo de refresh para evitar repetir `PowerShell`, GPU y probes de puerto cuando el snapshot sigue fresco.
- La cache compartida de `sysinfo` ya no usa `refresh_all()` en cada tick: refresca RAM, CPU global y solo los PIDs que la app supervisa, evitando scans completos de procesos en Windows durante el arranque.
- Logs e historial del inspector ya se cargan y refrescan solo en la pestana visible, y el autoscroll continuo usa bottom-lock inmediato para no encadenar animaciones.
- El refresh del dashboard ya no se reconstruye inline desde cada evento local: un worker coalescido serializa `build_snapshot()` y aplica la cadencia rapida real cuando existe runtime activo o un refresh urgente.
- El runtime ya guarda logs en buffer circular y el inspector los ingiere en batches cortos con windowing simple, evitando copias O(n) y renders completos por cada linea nueva.

- La UI principal ahora renderiza observabilidad dentro de nodos React Flow: el estado visual combina status, CPU y RAM en una sola senal de presion por nodo.
- Las metricas crudas de CPU y RAM ya no se duplican dentro del nodo; viven solo en el inspector derecho del servicio seleccionado.
- El inspector derecho concentra `Logs`, y reserva `Events`, `k6` y `Alerts` como superficies placeholder ya conectadas al nodo seleccionado.
- La navegacion del inspector entre nodos ya no usa una banda de chips creciente; ahora agrupa `microservices` y `workers` en dos selects para dejar mas espacio al rail de logs.
- Los edges manuales se renderizan como lineas limpias con tono neutro; mientras no exista backend de red no muestran cards ni trafico placeholder.
- La rail de logs en vivo vuelve a depender de permisos explicitos de eventos Tauri; el canvas ya no carga acciones secundarias para priorizar seleccion, telemetria y relacion entre nodos.
- El highlight del nodo y el inspector ahora comparten `focusedServiceId` como unica fuente de verdad, asi que logs y contexto visual se mantienen alineados incluso si el usuario hace click en el fondo del canvas.
- La linea temporal de conexion y el edge final ahora usan flecha y geometria flotante: el preview sale del borde mas cercano, conserva el tono visual del flujo y muestra estado valido/invalido durante el gesto.
- Los refreshes de telemetria ya no reemplazan el estado interactivo del canvas; React Flow conserva localmente `dragging` y `selected` mientras el dashboard rehidrata solo los datos operativos del nodo.
- El rail derecho de logs ahora mantiene el overflow encapsulado dentro de su viewport, hace wrap seguro de lineas largas y permite resize horizontal manual; el ancho elegido queda recordado localmente para no obligar al usuario a reajustarlo en cada sesion.
- La captura de logs ahora sanea secuencias ANSI/CSI/OSC, retornos de carro inline y otros controles de terminal antes de guardar el buffer y emitir eventos en vivo, para que la UI muestre texto limpio equivalente a una consola real.
- La UI de logs ahora renderiza el prefijo en hora local del equipo, puede ocultar o mostrar manualmente los metadatos de cada linea y colorea entidades utiles del mensaje como contexto Nest, verbos HTTP, rutas, duraciones y JSON inline.
- Las lineas que contienen JSON valido ahora pueden expandirse o colapsarse individualmente: por defecto quedan compactas, pero al abrirlas muestran una vista pretty multiline para inspeccionar payloads sin salir del inspector.

## Checklist local
- [x] `T3.1.1 | US3.1 |` Recolectar CPU y RAM por proceso y totales del sistema.
- [x] `T3.1.2 | US3.1 |` Resolver puertos en escucha y uptime por servicio.
- [x] `T3.1.3 | US3.1 |` Emitir refrescos de estado cada 1 o 2 segundos sin bloquear la UI.
- [x] `T3.1.4 | US3.1 |` Cachear telemetria y probes de puerto por ciclo de dashboard para sostener el polling de 1s/2s sin recalculo nativo redundante.
- [x] `T3.2.1 | US3.2 |` Integrar lectura de GPU global con soporte prioritario para NVIDIA.
- [x] `T3.2.2 | US3.2 |` Exponer GPU por proceso cuando el entorno lo soporte de forma confiable.
- [x] `T3.2.3 | US3.2 |` Mostrar fallback `Not available` o equivalente cuando no haya datos confiables.
- [x] `T3.3.1 | US3.3 |` Capturar `stdout` y `stderr` en un buffer en memoria por servicio.
- [x] `T3.3.2 | US3.3 |` Implementar resaltado por nivel, busqueda y limpieza del buffer visible.
- [x] `T3.3.3 | US3.3 |` Implementar pausa de autoscroll y exportacion manual de logs.
- [x] `T3.3.4 | US3.3 |` Limitar polling y render de logs e historial solo a la pestana visible del inspector para evitar trabajo oculto y scroll encadenado.

## Cambios no previstos incorporados
- `SC-005`: se estabilizo la observabilidad desktop con cache de telemetria y polling contextual por pestana sin cambiar contratos IPC.
- `SC-004`: se rearmo la experiencia de observabilidad para separar salud global e inspeccion por servicio sin introducir nuevos contratos backend.

- `SC-008`: observabilidad ahora vive en un canvas React Flow con nodos de telemetria viva, logs en la rail derecha y edges preparados para telemetria futura.
- `SC-009`: se corrigio la escucha de logs en vivo y la seleccion de nodos para que el inspector derecho mantenga contexto sin romper la interaccion del canvas.
- `SC-010`: observabilidad endurecio la seleccion del canvas para que el rail derecho, el highlight del nodo y la seleccion de enlaces no pierdan contexto por drag o paneos accidentales.
- `SC-011`: observabilidad compacto el switcher del inspector derecho en dos selects por tipo para que el rail de logs no pierda espacio util al crecer el grafo.
- `SC-012`: la rail derecha encapsula el scroll de logs y ahora se puede expandir o encoger manualmente para diagnostico sin que las lineas largas rompan el layout.
- `SC-013`: los logs en vivo ahora eliminan secuencias ANSI y otros controles de terminal antes de renderizarse, evitando basura visual al capturar salidas coloreadas como `nest start --watch`.
- `SC-014`: observabilidad ahora muestra el prefijo de logs en hora local, deja alternar manualmente la visibilidad de `hora + stream` y aplica resaltado semantico para que Nest, rutas y JSON se lean mas rapido.
- `SC-015`: los logs JSON ahora tienen toggle por linea para alternar entre una vista compacta y otra pretty multiline, util cuando un servicio emite objetos estructurados largos.
- `SC-017`: el polling del dashboard dejo de refrescar toda la tabla de procesos del SO; ahora limita `sysinfo` a RAM, CPU global y PIDs supervisados para evitar el crash nativo de Windows al abrir la app.
- `SC-020`: observabilidad dejo de depender del puerto manual en la UI y ahora expone solo el puerto TCP real detectado para cada nodo supervisado.
- `SC-019`: introdujo la propagacion de severidad de logs hacia el canvas como senal visual inicial, incluyendo lineas `ERROR` emitidas por Nest via `stdout`, sin degradar el `status` operativo del proceso.
- `SC-021`: observabilidad retiro las cards duplicadas de CPU/RAM del nodo y elimino los overlays placeholder de trafico en los edges, dejando la telemetria detallada solo en el inspector.
- `SC-022`: el canvas dejo de tratar la severidad de logs o la presion alta como criterio de rojo; ahora el tono critico solo representa fallas reales del runtime, y cada `Start`/`Restart` limpia el buffer visible del inspector antes de la nueva corrida.
- `SC-024`: el canvas vuelve a escalar a rojo cuando el buffer contiene logs criticos y deja de renderizar el bloque de error dentro del nodo; el detalle textual queda en inspector y toasts para no contaminar el grafo.
- `SC-025`: se retiro el falso positivo visual de `SC-024`; un nodo vivo ya no entra en rojo por cualquier `ERROR` o `stderr`, y el rojo vuelve a significar fallo bloqueante real del servicio.
- `SC-027`: los fallos de bootstrap por Prisma o conectividad de base de datos ahora cuentan como bloqueo real bajo watchers tipo `nest start --watch`, evitando que el nodo quede falso-`running` cuando nunca abrio el puerto.
- `SC-029`: observabilidad ahora coalescea rebuilds globales, usa `realtimeRefreshSeconds` como cadencia viva efectiva y reduce el costo del rail de logs con batching de eventos, memoizacion de lineas y windowing del viewport.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
