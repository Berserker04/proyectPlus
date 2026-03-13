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
- El puerto visible usa el puerto detectado por el supervisor y, si falta, cae al `expectedPort` cuando el socket esta realmente escuchando.
- La capa GPU del MVP es `best effort`: intenta usar `nvidia-smi` desde `PATH` o desde la instalacion tipica de NVIDIA en Windows.
- GPU global se calcula solo cuando `nvidia-smi` devuelve datos confiables; en ese caso se expone el promedio de utilizacion de las GPUs visibles.
- GPU por proceso se cruza por PID usando `nvidia-smi pmon` y memoria de `compute-apps`; si el driver, el modo del dispositivo o el vendor no lo soportan, la UI muestra `Not available`.
- Los logs del MVP viviran en memoria con exportacion manual; no se incluye persistencia historica completa.
- El supervisor lanza procesos con `stdout` y `stderr` en `pipe`, conserva un buffer circular en memoria por servicio y lo expone a la UI con polling liviano.
- La severidad de los logs es best effort: usa palabras clave (`error`, `warn`, `debug`, `trace`) y fallback por stream (`stderr` -> `error`).
- La UI ya permite buscar dentro del buffer, filtrar por stream, limpiar el buffer, pausar autoscroll y exportar un `.log` manual.

## Checklist local
- [x] `T3.1.1 | US3.1 |` Recolectar CPU y RAM por proceso y totales del sistema.
- [x] `T3.1.2 | US3.1 |` Resolver puertos en escucha y uptime por servicio.
- [x] `T3.1.3 | US3.1 |` Emitir refrescos de estado cada 1 o 2 segundos sin bloquear la UI.
- [x] `T3.2.1 | US3.2 |` Integrar lectura de GPU global con soporte prioritario para NVIDIA.
- [x] `T3.2.2 | US3.2 |` Exponer GPU por proceso cuando el entorno lo soporte de forma confiable.
- [x] `T3.2.3 | US3.2 |` Mostrar fallback `Not available` o equivalente cuando no haya datos confiables.
- [x] `T3.3.1 | US3.3 |` Capturar `stdout` y `stderr` en un buffer en memoria por servicio.
- [x] `T3.3.2 | US3.3 |` Implementar resaltado por nivel, busqueda y limpieza del buffer visible.
- [x] `T3.3.3 | US3.3 |` Implementar pausa de autoscroll y exportacion manual de logs.

## Cambios no previstos incorporados
- Ninguno por ahora.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
