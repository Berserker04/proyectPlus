# Backlog funcional del MVP

## Reglas de uso
- Marcar una historia como `[x]` solo cuando todas sus tareas ligadas en el roadmap esten completas y sus criterios de aceptacion se cumplan.
- Mantener la trazabilidad por IDs entre este backlog, el roadmap y los READMEs de area.
- Si aparece una historia nueva durante la ejecucion, agregarla aqui antes de cerrar el prompt.

## [x] E1 - Descubrimiento y dashboard inicial
Valor: permitir que un desarrollador registre un workspace y vea sus servicios Nest sin montar el catalogo a mano.

### [x] US1.1 - Registrar y recordar workspaces locales
Objetivo: elegir una carpeta raiz, persistirla y volver a escanearla cuando haga falta.

Estado actual:
- `T1.1.1` completada.
- `T1.1.2` completada.
- `T1.1.3` completada.

Criterios de aceptacion:
- El usuario puede seleccionar una carpeta raiz local desde la app.
- La app recuerda workspaces recientes y el ultimo workspace activo.
- El usuario puede disparar un reescaneo manual del workspace.

Dependencias:
- `E5` para persistencia de workspaces.

Trazabilidad:
- Roadmap: `T1.1.1`, `T1.1.2`, `T1.1.3`
- Area: `areas/discovery/README.md`

### [x] US1.2 - Descubrir servicios Nest automaticamente
Objetivo: detectar servicios Nest usando heuristicas consistentes en repos simples y multiproyecto.

Estado actual:
- `T1.2.1` completada.
- `T1.2.2` completada.
- `T1.2.3` completada.

Criterios de aceptacion:
- La deteccion considera `package.json`, `nest-cli.json`, scripts y estructura tipica.
- La app detecta servicios en repos separados y en carpetas con multiples servicios.
- Cada servicio detectado obtiene metadata minima util para el dashboard.

Dependencias:
- `US1.1`

Trazabilidad:
- Roadmap: `T1.2.1`, `T1.2.2`, `T1.2.3`
- Area: `areas/discovery/README.md`

### [x] US1.3 - Permitir manifests y servicios manuales
Objetivo: no depender solo de heuristicas para catalogar servicios.

Estado actual:
- `T1.3.1` completada.
- `T1.3.2` completada.
- `T1.3.3` completada.

Criterios de aceptacion:
- El usuario puede declarar metadata manual por servicio.
- El sistema respeta la prioridad `manifest > convencion > heuristica`.
- Se pueden registrar servicios que no cumplan las convenciones de Nest.

Dependencias:
- `US1.1`
- `US1.2`

Trazabilidad:
- Roadmap: `T1.3.1`, `T1.3.2`, `T1.3.3`
- Area: `areas/discovery/README.md`

### [x] US1.4 - Visualizar tablero inicial con orden y filtros
Objetivo: ver un panel util desde el primer escaneo.

Estado actual:
- `T1.4.1` completada.
- `T1.4.2` completada.
- `T1.4.3` completada.
- `T1.4.4` completada.

Criterios de aceptacion:
- El dashboard muestra nombre, ruta, framework, estado, PID, puerto y uptime.
- El dashboard soporta orden por nombre, estado, puerto, RAM, CPU y fecha de inicio.
- El dashboard soporta filtros por estado, tipo, tags y busqueda textual.

Dependencias:
- `US1.2`
- `US1.3`
- `US3.1` para metricas en tiempo real

Trazabilidad:
- Roadmap: `T1.4.1`, `T1.4.2`, `T1.4.3`, `T1.4.4`
- Area: `areas/discovery/README.md`

## [x] E2 - Operacion de servicios
Valor: permitir operar microservicios locales sin cambiar de terminal ni ejecutar comandos manuales repetitivos.

### [x] US2.1 - Iniciar servicios desde la UI
Objetivo: lanzar un servicio detenido y supervisarlo desde la app.

Estado actual:
- `T2.1.1` completada.
- `T2.1.2` completada.
- `T2.1.3` completada.
- `T2.1.4` completada.
- `T2.1.5` completada.

Criterios de aceptacion:
- Un servicio detenido muestra `Run` como accion principal.
- Al iniciar, el estado cambia a `starting` y luego a `running` o `error`.
- La app correlaciona servicio, PID y puerto detectado.
- La UI se mantiene interactiva mientras `Run`, `Restart` o `Start all` disparan el runtime.

Dependencias:
- `US1.2`
- `US1.3`

Trazabilidad:
- Roadmap: `T2.1.1`, `T2.1.2`, `T2.1.3`, `T2.1.4`, `T2.1.5`
- Area: `areas/operations/README.md`

### [x] US2.2 - Detener y reiniciar servicios supervisados
Objetivo: recuperar control operativo completo desde la misma interfaz.

Estado actual:
- `T2.2.1` completada.
- `T2.2.2` completada.
- `T2.2.3` completada.

Criterios de aceptacion:
- Un servicio en ejecucion expone `Stop` y `Restart`.
- La app termina correctamente procesos lanzados por ella.
- Los reinicios dejan rastro basico del intento y no pierden supervision.

Dependencias:
- `US2.1`
- `US5.2`

Trazabilidad:
- Roadmap: `T2.2.1`, `T2.2.2`, `T2.2.3`
- Area: `areas/operations/README.md`

### [x] US2.3 - Ejecutar acciones operativas rapidas y manejar conflictos
Objetivo: reducir friccion en tareas alrededor del arranque y diagnostico.

Estado actual:
- `T2.3.1` completada.
- `T2.3.2` completada.
- `T2.3.3` completada.
- `T2.3.4` completada.

Criterios de aceptacion:
- La UI permite abrir carpeta y terminal en la carpeta del servicio.
- La UI permite copiar puerto y comando asociado.
- Tras iniciar un servicio supervisado, la app muestra claramente el puerto TCP detectado cuando el proceso abre un listener local.

Dependencias:
- `US2.1`
- `US3.3`

Trazabilidad:
- Roadmap: `T2.3.1`, `T2.3.2`, `T2.3.3`
- Area: `areas/operations/README.md`

## [x] E3 - Observabilidad local
Valor: dar visibilidad inmediata del estado tecnico de cada servicio sin depender de herramientas externas.

### [x] US3.1 - Ver metricas y estado operativo por servicio
Objetivo: mostrar estado, PID, uptime, puerto, CPU y RAM en tiempo real.

Estado actual:
- `T3.1.1` completada.
- `T3.1.2` completada.
- `T3.1.3` completada.
- `T3.1.4` completada.

Criterios de aceptacion:
- La UI refresca estado visible cada 1 o 2 segundos sin bloquearse.
- Cada servicio expone CPU, RAM, puerto detectado y uptime; en el canvas el nodo sintetiza la presion y el inspector derecho concentra CPU/RAM.
- La app muestra totales de CPU y RAM del sistema.

Dependencias:
- `US2.1`

Trazabilidad:
- Roadmap: `T3.1.1`, `T3.1.2`, `T3.1.3`, `T3.1.4`
- Area: `areas/observability/README.md`

### [x] US3.2 - Exponer GPU global y por proceso cuando aplique
Objetivo: cubrir el caso de uso GPU con un alcance realista y honesto.

Estado actual:
- `T3.2.1` completada.
- `T3.2.2` completada.
- `T3.2.3` completada.

Criterios de aceptacion:
- La app muestra uso global de GPU cuando el entorno lo soporta.
- La app muestra uso de GPU por proceso cuando el SO, driver y vendor lo permiten.
- Si la informacion no es confiable, la UI muestra `Not available` o equivalente.

Dependencias:
- `US3.1`

Trazabilidad:
- Roadmap: `T3.2.1`, `T3.2.2`, `T3.2.3`
- Area: `areas/observability/README.md`

### [x] US3.3 - Consultar logs en vivo con controles basicos
Objetivo: revisar salida de servicio sin salir del panel.

Estado actual:
- `T3.3.1` completada.
- `T3.3.2` completada.
- `T3.3.3` completada.
- `T3.3.4` completada.

Criterios de aceptacion:
- La vista de logs separa `stdout` y `stderr`.
- El usuario puede buscar, limpiar el buffer visible y pausar autoscroll.
- Cuando sea posible, los logs resaltan nivel de severidad.

Dependencias:
- `US2.1`

Trazabilidad:
- Roadmap: `T3.3.1`, `T3.3.2`, `T3.3.3`, `T3.3.4`
- Area: `areas/observability/README.md`

## [x] E4 - Laboratorio k6
Valor: permitir pruebas de carga locales desde la misma app y concentrar resultados utiles en un solo lugar.

### [x] US4.1 - Registrar scripts y perfiles de prueba
Objetivo: preparar corridas k6 sin salir de la app.

Estado actual:
- `T4.1.1` completada.
- `T4.1.2` completada.
- `T4.1.3` completada.

Criterios de aceptacion:
- El usuario puede elegir un script k6 por servicio o endpoint.
- El usuario puede usar perfiles `smoke`, `load`, `stress` y `spike`.
- El usuario puede editar VUs, duracion, rate y thresholds basicos.

Dependencias:
- `US1.2`
- `US5.2`

Trazabilidad:
- Roadmap: `T4.1.1`, `T4.1.2`, `T4.1.3`
- Area: `areas/k6-lab/README.md`

### [x] US4.2 - Ejecutar y cancelar corridas k6 desde la app
Objetivo: orquestar k6 localmente como proceso hijo y controlar su ciclo de vida.

Estado actual:
- `T4.2.1` completada.
- `T4.2.2` completada.
- `T4.2.3` completada.

Criterios de aceptacion:
- La app valida que el binario k6 existe antes de correr.
- La corrida expone progreso y salida basica en vivo.
- El usuario puede cancelar una corrida en curso.

Dependencias:
- `US4.1`
- `US2.1`

Trazabilidad:
- Roadmap: `T4.2.1`, `T4.2.2`, `T4.2.3`
- Area: `areas/k6-lab/README.md`

### [x] US4.3 - Visualizar resultados, graficas e historial basico
Objetivo: aterrizar la informacion minima de rendimiento directamente en la interfaz.

Estado actual:
- `T4.3.1` completada.
- `T4.3.2` completada.
- `T4.3.3` completada.
- `T4.3.4` completada.

Criterios de aceptacion:
- La app persiste resumen y JSON crudo por corrida.
- La app grafica `avg`, `p95`, `p99`, `rps`, errores, VUs, duracion, `checks` y thresholds.
- La app muestra historial basico de corridas por servicio.

Dependencias:
- `US4.2`
- `US5.2`

Trazabilidad:
- Roadmap: `T4.3.1`, `T4.3.2`, `T4.3.3`, `T4.3.4`
- Area: `areas/k6-lab/README.md`

## [x] E5 - Persistencia y settings
Valor: recordar configuraciones, proteger la ejecucion local y sostener el estado del producto entre sesiones.

### [x] US5.1 - Persistir workspaces, servicios y manifests
Objetivo: que el catalogo sobreviva entre sesiones y no dependa de un rescaneo ciego cada vez.

Estado actual:
- `T5.1.1` completada.
- `T5.1.2` completada.
- `T5.1.3` completada.

Criterios de aceptacion:
- La app persiste workspaces y servicios detectados.
- La app persiste manifests y configuraciones manuales por servicio.
- La app restaura el catalogo inicial sin bloquear la UI.

Dependencias:
- Ninguna bloqueante.

Trazabilidad:
- Roadmap: `T5.1.1`, `T5.1.2`, `T5.1.3`
- Area: `areas/platform-persistence/README.md`

### [x] US5.2 - Persistir ejecuciones, corridas k6 y preferencias
Objetivo: mantener contexto operativo e historico del usuario.

Estado actual:
- `T5.2.1` completada.
- `T5.2.2` completada.
- `T5.2.3` completada.
- `T5.2.4` completada.

Criterios de aceptacion:
- La app persiste historial de ejecuciones de servicios.
- La app persiste historial de corridas k6.
- La app persiste preferencias de settings relevantes para la operacion local.

Dependencias:
- `US5.1`

Trazabilidad:
- Roadmap: `T5.2.1`, `T5.2.2`, `T5.2.3`, `T5.2.4`
- Area: `areas/platform-persistence/README.md`

### [x] US5.3 - Aplicar guardrails de seguridad y limpieza de procesos
Objetivo: mantener el MVP local, seguro y confiable.

Estado actual:
- `T5.3.1` completada.
- `T5.3.2` completada.
- `T5.3.3` completada.

Criterios de aceptacion:
- Solo se ejecutan comandos y rutas en allowlists definidas.
- El frontend no puede disparar shell arbitraria.
- La app limpia o marca claramente procesos huerfanos cuando cierre.

Dependencias:
- `US5.1`
- `US2.1`

Trazabilidad:
- Roadmap: `T5.3.1`, `T5.3.2`, `T5.3.3`
- Area: `areas/platform-persistence/README.md`

## Scope Changes (SC)

### [x] SC-007 - Mejoras de UX (Bulk Actions, Native Dir, Toasts, Drag&Drop)
Objetivo: Lograr que el panel de control se perciba mas robusto, fluido y profesional, agregando controles bulk, validacion proactiva de puertos y mejoras visuales sustanciales.

Estado actual:
- Validacion de rutas (folder picker) nativa mediante Tauri.
- Alertas en forma de Toasts en lugar de Banners fijos.
- Actions "Run All" y "Stop All" por proyecto.
- Reordenamiento mediante HTML5 Drag and Drop guardado en SQLite.
- Filtro rapido de Error/Stdout/Stderr y coloreo de mensajes en Logs.

Criterios de aceptacion:
- Toasts apilables en UI oscura.
- El usuario puede elegir folder desde OS dialog.
- La validacion alerta por puerto ocupado en bluro o arranque.
- Se puede copiar y filtrar logs en un click.
- El drag and drop preserva el orden entre sesiones.

Dependencias:
- N/A

Trazabilidad:
- Roadmap: `SC-007`

### [x] SC-008 - Migracion a canvas React Flow
Objetivo: Reemplazar la lista central por un canvas topologico editable, mantener la telemetria viva por nodo y mover la inspeccion/logs a una rail lateral persistente.

Estado actual:
- La shell principal ya usa canvas React Flow.
- Los nodos soportan `service` y `worker` como variantes visuales del mismo runtime base.
- La topologia manual por proyecto queda persistida y el inspector derecho concentra logs vivos y placeholders de `events`, `k6` y `alerts`.

Criterios de aceptacion:
- El canvas carga y persiste posicion de nodos y edges manuales por proyecto.
- Las acciones operativas principales viven tanto en el nodo como en el inspector derecho.
- Los logs del servicio seleccionado siguen llegando en tiempo real dentro del inspector.

Dependencias:
- `US2.1`
- `US3.3`
- `US5.2`

Trazabilidad:
- Roadmap: `SC-008`

### [x] SC-009 - Estabilizacion del canvas topologico
Objetivo: Corregir la interaccion real del canvas para que seleccionar, arrastrar, conectar y persistir nodos funcione de forma confiable en desktop.

Estado actual:
- El drag principal del nodo ahora vive en el header y ya no compite con el pane drag del canvas.
- Los nodos del canvas conservan solo `Start`, `Stop` y `Restart`; el resto de acciones quedan en el inspector derecho.
- La topologia vuelve a guardarse y los logs en vivo pueden escucharse porque la capability Tauri ya expone comandos y eventos requeridos.

Criterios de aceptacion:
- El usuario puede seleccionar un nodo y ver su inspector derecho sin perder interaccion del canvas.
- El usuario puede arrastrar nodos y conectar handles de forma consistente.
- Cambiar a `Flow Topology` no muestra errores de permisos para guardar topologia ni escuchar logs vivos.

Dependencias:
- `SC-008`

Trazabilidad:
- Roadmap: `SC-009`

### [x] SC-010 - Hardening final de interacciones del canvas
Objetivo: Cerrar los huecos remanentes de UX del canvas para que el foco del inspector, la seleccion visual y las acciones embebidas compartan la misma fuente de verdad.

Estado actual:
- `focusedServiceId` ahora gobierna tanto el highlight del nodo como el contexto del inspector derecho.
- El drag del nodo queda restringido al header real mediante `dragHandle`, y las acciones runtime usan `nodrag` y `nopan`.
- Las acciones `Start`, `Stop` y `Restart` dentro del nodo enfocan primero el servicio antes de ejecutar el runtime.

Criterios de aceptacion:
- Click en el cuerpo del nodo actualiza el inspector y mantiene el highlight correcto.
- Click en el fondo del canvas no limpia el ultimo contexto del inspector.
- La seleccion de enlaces y las acciones runtime se pueden usar sin arrastres o paneos accidentales.

Dependencias:
- `SC-009`

Trazabilidad:
- Roadmap: `SC-010`

### [x] SC-016 - Hardening del launcher desktop de desarrollo
Objetivo: Evitar sesiones de desarrollo rotas por procesos desktop o listeners huerfanos, y volver accionables los crashes nativos de Tauri durante el arranque local.

Estado actual:
- `tauri:dev` ahora pasa por un wrapper repo-local antes de invocar `tauri dev`.
- El wrapper limpia `ms-control-center.exe` huerfanos del repo, valida si el puerto `1420` esta ocupado y deja un error claro cuando el owner no pertenece a este workspace.
- El arranque de desarrollo fuerza `RUST_BACKTRACE=1` para que el siguiente fallo nativo no quede en un mensaje opaco.

Criterios de aceptacion:
- Reejecutar `npm run tauri:dev` despues de una sesion rota no deja otra instancia desktop vieja compitiendo con el arranque nuevo.
- Si el puerto `1420` lo ocupa otro proceso, el comando falla con un diagnostico explicito en lugar de una cadena opaca de errores.
- Los fallos nativos de Rust/Tauri durante desarrollo heredan `RUST_BACKTRACE=1`.

Dependencias:
- N/A

Trazabilidad:
- Roadmap: `SC-016`

### [x] SC-018 - Limpieza de arboles stale en el launcher desktop
Objetivo: evitar falsos positivos de puerto ocupado cuando una sesion `tauri:dev` deja wrappers shell intermedios vivos en Windows.

Estado actual:
- El wrapper inspecciona ancestros y descendientes del PID que escucha `1420` para detectar la sesion repo-local completa de desarrollo.
- Si el listener pertenece a la cadena `shell -> npm -> tauri -> vite` del repo, el launcher corta la raiz relevante con `taskkill /T /F` en lugar de limitarse al PID directo de Vite.
- Cuando `1420` pertenece a otro proceso ajeno al workspace, el error explicito se mantiene y ya no se limpia nada por heuristica amplia.

Criterios de aceptacion:
- Reejecutar `npm run tauri:dev` despues de una sesion rota con wrappers `cmd` o `powershell` no falla por un falso positivo de puerto ocupado.
- La limpieza mata solo arboles repo-locales relacionados con `tauri:dev`.
- Tras limpiar el arbol stale, el launcher vuelve a levantar `MS Control Center` en `127.0.0.1:1420`.

Dependencias:
- `SC-016`

Trazabilidad:
- Roadmap: `SC-018`

### [x] SC-019 - Severidad de logs reflejada en nodos del canvas
Objetivo: hacer visible en el grafo cuando un servicio sigue vivo pero su salida ya reporta errores.

Estado actual:
- El runtime clasifica severidad por palabras clave (`error`, `warn`, `debug`, `trace`, etc.) y mantiene `stderr` como fallback a `error`.
- Cada servicio expone una bandera derivada del buffer actual de logs para que el canvas pinte el nodo en rojo sin convertir el proceso a `status=error`.
- Limpiar logs o reiniciar el servicio elimina la senal visual de error heredada del buffer anterior.

Criterios de aceptacion:
- Una linea estilo Nest con `ERROR` aunque llegue por `stdout` lleva el nodo a tono critico.
- Un proceso que sigue corriendo conserva acciones como `Stop` y `Restart`; solo cambia la senal visual del nodo.
- Al limpiar logs o reiniciar el servicio, el nodo deja de heredar el rojo si no existen nuevos errores en el buffer.

Dependencias:
- `US3.3`
- `SC-008`

Trazabilidad:
- Roadmap: `SC-019`

### [x] SC-020 - Autodeteccion de puerto real en nodos manuales
Objetivo: eliminar la configuracion manual del puerto al registrar nodos y mostrar el puerto TCP real que abre el proceso supervisado.

Estado actual:
- El modal de alta y edicion de nodos ya no pide `Puerto esperado`.
- Los nodos nuevos o editados se guardan sin puerto manual y el dashboard muestra solo `detectedPort`.
- El backend resuelve el puerto visible inspeccionando el arbol de procesos supervisado y sus listeners TCP en Windows.

Criterios de aceptacion:
- El usuario puede crear o editar un nodo sin ingresar puerto.
- Tras iniciar un nodo supervisado, la UI muestra el puerto detectado si el proceso abre un listener TCP local.
- La UI deja de depender de `expectedPort` para renderizar el puerto de los nodos supervisados.

Dependencias:
- `US2.1`
- `US3.1`

Trazabilidad:
- Roadmap: `SC-020`

### [x] SC-021 - Limpieza visual y teclado del canvas
Objetivo: reducir ruido en el grafo dejando la telemetria detallada en el inspector y haciendo que los enlaces se editen desde una interaccion mas directa.

Estado actual:
- Los nodos del canvas ya no renderizan cards de CPU o RAM; esas metricas viven solo en el inspector derecho.
- Los edges del canvas ya no muestran cards placeholder de trafico ni acciones inline; quedan como lineas limpias con estado visual.
- Un edge seleccionado se puede eliminar con `Suprimir/Delete` y la topologia persiste sin depender del overlay viejo.

Criterios de aceptacion:
- El nodo del canvas conserva estado, puerto, PID y senal de presion sin duplicar CPU/RAM.
- Los enlaces manuales se leen visualmente desde la linea, sin cards de trafico ficticio entre nodos.
- Seleccionar un enlace y pulsar `Suprimir/Delete` lo elimina del canvas y de la topologia persistida.

Dependencias:
- `SC-010`
- `US3.1`

Trazabilidad:
- Roadmap: `SC-021`

### [x] SC-022 - Estado critico real y reset de logs por corrida
Objetivo: evitar falsos rojos en el canvas y hacer que cada arranque o reinicio arranque con contexto de logs limpio.

Estado actual:
- El tono rojo del nodo ya no depende de palabras clave ni de `stderr`; queda reservado para fallas operativas reales (`status=error`).
- La presion por CPU o RAM sigue visible como senal intermedia del nodo, pero ya no escala a rojo por si sola.
- Cuando el usuario hace `Start` o `Restart` sobre el servicio enfocado, el inspector limpia el buffer visible y se resincroniza con la nueva corrida.
- En servicios lanzados con wrappers tipo `nest start --watch`, un error fatal de bootstrap o bind (`ExceptionHandler`, dependencias no resueltas, `EADDRINUSE`, uncaught exception) puede marcar el nodo en rojo aunque el wrapper siga vivo, siempre que el runtime quede sin puerto/listener operativo.

Criterios de aceptacion:
- Un servicio `running` con logs que contengan `ERROR` o salidas por `stderr` no se pinta rojo si sigue operativo.
- Un servicio solo entra en rojo cuando el runtime detecta una falla real y lo deja en `error`.
- El inspector de logs no mezcla la corrida nueva con el buffer visible anterior tras `Start` o `Restart`.
- Si el wrapper del watcher sigue vivo pero el bootstrap real falla y el servicio no queda escuchando, el nodo tambien entra en rojo y conserva acciones para detener o reiniciar.

Dependencias:
- `US2.1`
- `US2.2`
- `US3.3`

Trazabilidad:
- Roadmap: `SC-022`

### [x] SC-023 - Liberar puertos ocupados desde el sidebar
Objetivo: resolver rapido conflictos locales de puerto sin salir de la app ni buscar el PID manualmente.

Estado actual:
- El menu izquierdo ya incluye un bloque para ingresar un puerto y disparar la accion.
- El backend resuelve el PID listener en Windows y ejecuta `taskkill /T /F` sobre el arbol asociado.
- Si el puerto pertenece a un nodo supervisado por la app, la supervision se resincroniza para no dejar estados stale.

Criterios de aceptacion:
- El usuario puede ingresar un puerto valido desde el sidebar y matar el proceso que escucha en ese puerto.
- Si el proceso corresponde a un servicio supervisado, el dashboard deja de mostrarlo como corriendo de forma stale.
- Si no existe un listener en ese puerto o el kill falla, la app muestra un error claro.

Dependencias:
- `US2.2`
- `US2.3`

Trazabilidad:
- Roadmap: `SC-023`

### [x] SC-024 - Senal critica por logs y nodo sin error inline
Objetivo: volver a hacer visible en el canvas cuando un servicio sigue vivo pero ya emitio fallos criticos, sin llenar el nodo con texto de error.

Estado actual:
- El tono rojo del nodo vuelve a activarse cuando el buffer del servicio ya contiene logs de nivel `error`, incluso si el wrapper del watcher sigue vivo y el runtime aun no cae a `status=error`.
- Mensajes como `Cannot find module .../dist/main` vuelven accionable el problema desde el canvas sin exigir que el proceso muera primero.
- El bloque de error textual deja de renderizarse dentro del nodo; el detalle queda en el inspector derecho y en los toasts operativos.

Criterios de aceptacion:
- Un log critico por `stderr` o por palabras clave de error pinta el nodo en rojo aunque el servicio siga en `running`.
- El nodo del canvas ya no muestra tarjetas o bloques con el mensaje completo del error.
- El usuario conserva el detalle del fallo fuera del nodo, en el inspector y feedback operativo de la app.

Dependencias:
- `US3.3`
- `SC-022`

Trazabilidad:
- Roadmap: `SC-024`

### [x] SC-025 - Rojo solo para fallas bloqueantes reales
Objetivo: evitar falsos positivos visuales cuando un microservicio sigue operativo pero emite logs `ERROR` esperables de negocio o peticiones rechazadas.

Estado actual:
- Un nodo `running` ya no se pinta rojo solo porque el buffer contenga lineas `ERROR` o `stderr`.
- El rojo del canvas vuelve a quedar reservado para `status=error` o para fallas de bootstrap realmente bloqueantes detectadas por runtime cuando el proceso no queda escuchando.
- La severidad de logs se conserva en el inspector derecho para diagnostico, sin degradar el estado visual del nodo por errores no bloqueantes.

Criterios de aceptacion:
- Un servicio que responde y mantiene listener operativo no entra en rojo por logs 4xx/5xx, `stderr` o mensajes de nivel `error` aislados.
- Un servicio solo entra en rojo cuando su estado operativo cae a error o cuando el arranque falla de forma bloqueante.
- El detalle de severidad sigue visible en el inspector y en la lectura de logs.

Dependencias:
- `US3.3`
- `SC-022`

Trazabilidad:
- Roadmap: `SC-025`

### [x] SC-027 - Bootstrap fallido por base de datos bajo watchers
Objetivo: reflejar como fallo real del nodo los arranques que dejan vivo el watcher pero nunca levantan el servicio por errores bloqueantes de base de datos.

Estado actual:
- errores tipo `PrismaClientInitializationError` o `P1001` ahora se clasifican como bloqueo de bootstrap en el runtime
- si el watcher queda vivo pero el servicio no llega a abrir listener TCP local, el nodo pasa a rojo y expone issue estructurado
- la deteccion queda cubierta por tests unitarios en `storage/runtime`

Criterios de aceptacion:
- un `nest start --watch` que falle al conectar PostgreSQL u otra dependencia Prisma bloqueante no permanece visualmente en `running`
- el nodo conserva acciones operativas (`Stop` y `Restart`) mientras el wrapper siga supervisado
- el comportamiento no reintroduce falsos rojos para logs no bloqueantes de negocio

Dependencias:
- `US2.1`
- `US3.3`
- `SC-025`

Trazabilidad:
- Roadmap: `SC-027`

### [x] SC-028 - Port tools no bloqueante
Objetivo: liberar puertos ocupados desde el sidebar sin congelar acciones del dashboard ni meter trabajo pesado en el hilo critico de Tauri.

Estado actual:
- `kill_process_on_port` ahora corre en `spawn_blocking` igual que otras acciones runtime pesadas.
- Cuando el puerto pertenece a nodos supervisados, la limpieza reutiliza el cierre interno del supervisor sin recomponer snapshots por cada servicio afectado.
- La UI mantiene un pending aislado para `Port tools`, de modo que liberar un puerto no deshabilita otras acciones del canvas o del inspector.

Criterios de aceptacion:
- Disparar `Kill` desde `Port tools` no bloquea el hilo critico de Tauri mientras corre `taskkill` o la resincronizacion del supervisor.
- La UI sigue permitiendo acciones no relacionadas mientras el kill por puerto esta en curso.
- Si el puerto pertenece a nodos supervisados, el dashboard queda resincronizado con un solo snapshot final.

Dependencias:
- `US2.3`
- `SC-023`
- `SC-026`

Trazabilidad:
- Roadmap: `SC-028`

### [x] SC-029 - Hardening de refresh, logs y canvas del core operativo
Objetivo: quitar rebuilds globales redundantes y bajar el costo de render/log streaming para que el dashboard siga fluido bajo carga real.

Estado actual:
- El backend ahora usa un worker unico de refresh con prioridades `normal/urgent`, serializa `build_snapshot()` y aplica `dashboardRefreshSeconds` vs `realtimeRefreshSeconds` segun actividad real del runtime.
- Los hilos de logs ya no fuerzan snapshots globales inline; solo emiten lineas vivas y solicitan refresh coalescido cuando cambia una senal relevante.
- El runtime ya conserva logs en buffer circular y el frontend procesa las lineas en lotes cortos con windowing en el inspector.
- El canvas reutiliza nodos estables por `id` y evita recrear handlers inline por refresh.

Criterios de aceptacion:
- `Run`, `Restart`, ticker y logs criticos no disparan una rafaga de snapshots redundantes.
- La preferencia `realtimeRefreshSeconds` gobierna la cadencia rapida cuando hay runtime activo o refresh urgente.
- Un stream de logs intenso no congela el inspector ni obliga a renderizar todas las lineas retenidas.
- El canvas no recompone todos los nodos cuando solo cambia una parte del snapshot.

Dependencias:
- `US2.1`
- `US3.1`
- `US3.3`
- `US5.2`

Trazabilidad:
- Roadmap: `SC-029`

### [x] SC-030 - Topologia derivada por manifests de microservicios
Objetivo: dejar de dibujar dependencias a mano en el canvas y pasar a un modelo derivado desde `/internal/topology` con fallback local mientras termina la migracion de StylePlus.

Estado actual:
- ProjectsPlus ya carga manifests desde `GET /internal/topology` por servicio cuando el runtime expone puerto local.
- Cuando el puerto aun no fue detectado, la carga intenta primero `detectedPort/expectedPort` y luego los puertos canonicos de StylePlus (`3000-3014`) como port hints de bootstrap.
- Si el endpoint aun no existe, la app cae a `workingDirectory/topology.manifest.json` mediante un comando Tauri acotado al directorio del servicio.
- Un topology store en memoria recompone nodos/edges derivados, resuelve HTTP y RabbitMQ en vista simple, recalcula estados `declared/active` y conserva manual edges solo para servicios legacy bajo `TOPOLOGY_SOURCE=hybrid`.
- El parser acepta manifests `api`, `worker` y `hybrid`, incluyendo runtimes compuestos `api/worker` sin exigir un segundo endpoint para el worker.
- El inspector ahora expone manifest raw, health endpoints, dependencias HTTP, publish/consume RabbitMQ, runtime summary, sub-runtimes, runtime checks y alertas de `topology stale`.

Criterios de aceptacion:
- El canvas crea y reconcilia edges automaticamente para servicios migrados sin depender de lineas manuales.
- El modo `hybrid` mantiene compatibilidad temporal con nodos legacy/manual mientras los manifests se incorporan gradualmente.
- Un fallo o manifest invalido de un servicio no rompe el canvas completo y conserva el ultimo manifest valido conocido.

Dependencias:
- `SC-008`
- `SC-029`

Trazabilidad:
- Roadmap: `SC-030`

### [x] SC-032 - Refresh manual de topology manifests
Objetivo: evitar refreshes automaticos de topology que recompongan manifests y edges sin intencion explicita del usuario, dejando la resincronizacion bajo control manual desde el canvas.

Estado actual:
- La app mantiene el topology store en memoria y recompone nodos/edges legacy o manuales con cada cambio de contexto del proyecto.
- La carga de manifests `/internal/topology` o `topology.manifest.json` ya no corre al montar, ni en polling, ni tras `Run`, `Stop`, `Restart` o `Kill port`.
- El boton `Refresh topology` en la vista del canvas es ahora el unico disparador para volver a resolver manifests, dependencias HTTP/RabbitMQ y estados derivados asociados.

Criterios de aceptacion:
- Abrir un proyecto o cambiar el estado runtime de un servicio no dispara automaticamente una recarga de topology manifests.
- El usuario puede resincronizar topology bajo demanda desde el canvas sin perder nodos, layout ni edges manuales legacy.
- La documentacion de discovery, operations y observability refleja que topology se refresca manualmente.

Dependencias:
- `SC-030`

Trazabilidad:
- Roadmap: `SC-032`
