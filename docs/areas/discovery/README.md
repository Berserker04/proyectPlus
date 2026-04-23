# Area Discovery

## Proposito y alcance
Esta area cubre el registro de workspaces, el escaneo de carpetas, el autodiscovery de servicios Nest, los manifests manuales y el dashboard inicial para listar servicios detectados.

## Epica e historias relacionadas
- [x] `E1` Descubrimiento y dashboard inicial
- [x] `US1.1` Registrar y recordar workspaces locales
- [x] `US1.2` Descubrir servicios Nest automaticamente
- [x] `US1.3` Permitir manifests y servicios manuales
- [x] `US1.4` Visualizar tablero inicial con orden y filtros

## Decisiones actuales
- El descubrimiento sera hibrido: autodiscovery mas manifest manual por servicio.
- La prioridad de resolucion sera `manifest > convencion > heuristica`.
- El dashboard inicial debe mostrar estado minimo util desde el primer escaneo, sin esperar a observabilidad avanzada.
- La seleccion de workspace dispara un escaneo inicial de candidatos Nest para poblar el catalogo persistido.
- El autodiscovery actual ya cubre `package.json`, `nest-cli.json`, scripts, estructura tipica Nest, monorepos con `projects` y carpetas con repos separados.
- Cada servicio detectado resuelve como minimo nombre, path relativo, runtime, framework, puerto estimado y comando de arranque sugerido.
- El manifest manual del workspace vive en `.ms-control-center/services.manifest.json`.
- La UI ya permite registrar un servicio manual minimo; guardar ese formulario actualiza el manifest y reescanea el catalogo activo.
- El alta manual de nodos ya no solicita puerto; ese dato se resuelve despues en runtime cuando el proceso supervisado abre un listener TCP local.
- Si un `path` del manifest coincide con un servicio autodetectado, el manifest gana; si no coincide, crea un servicio manual nuevo.
- El dashboard ya ordena por nombre, estado, puerto, CPU, RAM e inicio catalogado del servicio.
- Mientras no existan procesos supervisados, el orden por `Inicio` usa la fecha de catalogacion persistida como referencia visible del servicio.
- El dashboard ya filtra por estado, tipo `framework/runtime`, tags y busqueda textual.
- La vista principal del dashboard ya no expone paneles internos de toolchain, bootstrap o estado de implementacion; solo muestra superficies funcionales del producto.
- La shell ahora separa `Resumen` y `Servicios`: discovery vive en una navegacion lateral persistente y el catalogo operativo se resuelve en una vista maestro-detalle.
- El alta manual ya no ocupa una rail permanente; ahora se precarga desde el inspector del servicio y se guarda como override contextual dentro de `Configuracion`.
- La lista de servicios ahora usa subarboles mas estables y memoizacion por tarjeta para que el polling operativo no vuelva a pintar todo el catalogo cuando un servicio no cambio.
- Los chips de tipos, etiquetas, filtros y el ordenado visible ahora se recalculan como estado derivado memoizado para sostener fluidez con workspaces medianos o grandes.
- La shell principal ya migro de cards/lista a un canvas React Flow con posiciones persistidas por proyecto.
- Discovery ahora entrega nodos con `kind` (`service` o `worker`) y ya no solo una lista ordenable.
- La topologia manual del proyecto vive por encima del catalogo: las conexiones son editables y se persisten como parte del contexto del proyecto activo.
- Discovery ahora puede derivar la topologia desde manifests por servicio: primero intenta `GET /internal/topology` usando el puerto runtime del nodo y, si aun no existe, cae a `workingDirectory/topology.manifest.json`.
- Si el puerto runtime aun no existe, discovery bootstrappea el intento HTTP con los puertos canonicos de StylePlus (`3000-3014`) antes de resignarse al fallback local/manual.
- El layout del canvas sigue persistido por proyecto, pero los edges ya no tienen por que ser manuales: en `TOPOLOGY_SOURCE=hybrid` los manifests pasan a ser la fuente primaria para servicios migrados y los enlaces manuales se conservan solo para nodos legacy.
- La resincronizacion de manifests/topology ahora es manual: el canvas solo vuelve a consultar `/internal/topology` o el fallback local cuando el usuario activa `Refresh topology`.
- El manifest ya puede representar un bounded context `hybrid`: un solo nodo visual resume runtimes `api` y `worker`, y el canvas no necesita descubrir un endpoint separado del worker para ese servicio.
- La interaccion primaria del canvas ahora separa seleccion y movimiento: el nodo se selecciona desde React Flow y se arrastra desde el header para evitar pans accidentales del lienzo.
- El foco visible del canvas ahora nace de `focusedServiceId`: seleccionar un nodo actualiza el inspector, hacer click en el pane conserva el ultimo contexto y el drag solo vive en un grip visible dentro del header.
- El switcher del inspector derecho ya no enumera todos los nodos como chips: ahora separa `microservices` y `workers` en dos selects compactos para preservar espacio util en proyectos grandes.
- La rail derecha ahora separa la informacion del nodo en tabs reales: `Overview` concentra metadata base, `Topology` muestra manifests y dependencias, y `Logs` deja de compartir scroll con el resto del detalle.
- Cada nodo ahora expone un `easy-connect` sobre toda la tarjeta; el grip del header sigue siendo el unico punto de drag y las conexiones flotan desde la cara mas cercana del nodo en vez de quedar fijas izquierda/derecha.
- Los edges del canvas ya no renderizan cards overlay; la relacion se lee desde la linea y un enlace seleccionado se elimina con `Suprimir/Delete`.
- El canvas mantiene un estado local de nodos para React Flow; los refreshes de dashboard solo hidratan telemetria y metadata, sin reinicializar el estado transitorio del drag.

## Checklist local
- [x] `T1.1.1 | US1.1 |` Definir el modelo de `Workspace` con `rootPath`, nombre visible y timestamps.
- [x] `T1.1.2 | US1.1 |` Implementar selector de carpeta raiz con reescaneo manual del workspace.
- [x] `T1.1.3 | US1.1 |` Persistir lista de workspaces recientes y ultimo workspace activo.
- [x] `T1.2.1 | US1.2 |` Definir heuristicas de deteccion Nest usando `package.json`, `nest-cli.json`, scripts y estructura tipica.
- [x] `T1.2.2 | US1.2 |` Implementar escaneo incremental para repos separados y carpetas multiproyecto.
- [x] `T1.2.3 | US1.2 |` Resolver metadata minima por servicio: nombre, path, runtime, framework y puerto estimado.
- [x] `T1.3.1 | US1.3 |` Definir esquema de manifest manual por servicio con comandos, puerto, tags, env y tipo.
- [x] `T1.3.2 | US1.3 |` Implementar prioridad `manifest > convencion > heuristica` en la resolucion de metadata.
- [x] `T1.3.3 | US1.3 |` Permitir registrar servicios manuales que no aparezcan en autodiscovery.
- [x] `T1.4.1 | US1.4 |` Disenar la vista principal con nombre, ruta, framework, estado, PID, puerto y uptime.
- [x] `T1.4.2 | US1.4 |` Implementar orden por nombre, estado, puerto, RAM, CPU y fecha de inicio.
- [x] `T1.4.3 | US1.4 |` Implementar filtros por estado, tipo de servicio, tags y busqueda textual.
- [x] `T1.4.4 | US1.4 |` Estabilizar la pantalla de servicios con subarboles mas estables, memoizacion y refresco contextual sin degradar el SLA visual.

## Cambios no previstos incorporados
- `SC-005`: se estabilizo el catalogo desktop para que filtros, seleccion e inspector convivan con polling operativo sin re-render masivo del listado.
- `SC-001`: se agrego un bootstrap tecnico del repo porque el proyecto partio sin scaffolding ejecutable. La shell inicial permite avanzar discovery y plataforma en paralelo sin bloquear el orden funcional.
- `SC-003`: se limpio la vista principal para retirar paneles internos de progreso y dejar solo copy operativo orientado al usuario final.
- `SC-004`: se rediseño la experiencia de discovery para integrarla en una shell modular con resumen ejecutivo, sidebar persistente y catalogo maestro-detalle alineado al PRD.

- `SC-008`: discovery ahora materializa un canvas topologico editable con layout persistido, nodos `service/worker` y edges manuales por proyecto.
- `SC-009`: el canvas topologico se estabilizo con drag handle dedicado, seleccion consistente de nodos y conexiones manuales mas confiables.
- `SC-010`: discovery termino de endurecer el canvas usando `focusedServiceId` como fuente de verdad, `dragHandle` explicito en un grip visible del nodo y superficies interactivas protegidas con `nodrag` y `nopan`.
- `SC-011`: discovery compacto el switcher del inspector derecho en dos selects por tipo de nodo para que la rail escale mejor cuando aumenta el catalogo.
- `SC-020`: discovery simplifico el modal de nodos quitando el puerto manual; desde ahora la metadata de puerto visible llega solo desde observabilidad en runtime.
- `SC-021`: discovery limpio el canvas retirando overlays de edges y habilitando eliminacion directa de enlaces seleccionados con `Suprimir/Delete`.
- `SC-030`: discovery dejo de usar el canvas manual como verdad unica y ahora consume manifests/topology por servicio para derivar edges HTTP/RabbitMQ, manteniendo `hybrid` como modo de transicion.
- `SC-030`: discovery tambien adopto port hints canonicos de StylePlus para bootstrap de `/internal/topology` y soporta manifests `hybrid` con runtimes compuestos dentro del mismo nodo.
- `SC-031`: discovery reorganiza el inspector derecho para que topology tenga su propia tab y deje de competir visualmente con overview y logs dentro del rail.
- `SC-032`: discovery deja de recargar manifests automaticamente; la topologia derivada solo se resincroniza cuando el usuario pulsa `Refresh topology` en el canvas.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
- Manifest: [`./service-manifest.md`](./service-manifest.md)
