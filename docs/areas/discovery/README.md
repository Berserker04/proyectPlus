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
- Cada servicio detectado resuelve como minimo nombre, path relativo, runtime, framework, puerto esperado y comando de arranque sugerido.
- El manifest manual del workspace vive en `.ms-control-center/services.manifest.json`.
- La UI ya permite registrar un servicio manual minimo; guardar ese formulario actualiza el manifest y reescanea el catalogo activo.
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

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
- Manifest: [`./service-manifest.md`](./service-manifest.md)
