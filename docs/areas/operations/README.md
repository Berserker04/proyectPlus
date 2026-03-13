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
- En este lote la correlacion de puerto es best effort: usa el puerto esperado como confirmacion de disponibilidad durante el arranque y expone el PID real del proceso hijo.
- `US2.2` cierra `Stop` y `Restart` sobre el mismo supervisor: `Stop` corta el arbol de procesos y `Restart` reusa el catalogo del servicio para relanzarlo sin perder supervision.
- En Windows, el cierre operativo usa `taskkill /PID <pid> /T /F` sobre el proceso shell supervisado para poder matar tambien hijos del comando de arranque.
- Si el cierre no logra liberar el puerto o la app encuentra estados `starting/running` sin supervisor al reabrir, el servicio se marca como `error` con issue estructurado de proceso huerfano o arranque interrumpido.
- `US2.3` agrega accesos rapidos nativos por servicio: abrir carpeta, abrir terminal, copiar puerto, copiar comando y un handoff de logs desde la UI hacia el contexto operativo actual.
- Las advertencias de puerto ocupado ahora tambien son preventivas: un servicio detenido o en error puede marcar `port busy` si el puerto esperado responde fuera del supervisor.
- El handoff de logs no intenta suplir `US3.3`: por ahora centraliza ultima senal, issue, ruta, puerto y comando como punto de entrada operativo.
- `Run` y `Restart` ya validan `startCommand` contra una allowlist estricta de launchers y rechazan chaining, pipes, redirecciones o rutas relativas que intenten salir del workspace activo.
- `Open terminal` ya valida que la shell preferida este incluida en `allowedShells`; si no, la accion se bloquea con error estructurado en vez de abrir una shell arbitraria.
- Esas acciones operativas ya no dependen de un IPC abierto por defecto: la ventana `main` las obtiene mediante permisos explicitos del app manifest agrupados en el set `service-runtime`.

## Checklist local
- [x] `T2.1.1 | US2.1 |` Modelar la accion `Run` con feedback inmediato y estado `starting`.
- [x] `T2.1.2 | US2.1 |` Lanzar procesos supervisados y correlacionar servicio, PID y puerto.
- [x] `T2.1.3 | US2.1 |` Reportar error estructurado cuando falle el arranque.
- [x] `T2.2.1 | US2.2 |` Implementar `Stop` con cierre controlado de procesos lanzados por la app.
- [x] `T2.2.2 | US2.2 |` Implementar `Restart` con historial de intento y reejecucion del comando.
- [x] `T2.2.3 | US2.2 |` Detectar y marcar procesos huerfanos al reiniciar o cerrar la app.
- [x] `T2.3.1 | US2.3 |` Implementar `Open folder` y `Open terminal in folder`.
- [x] `T2.3.2 | US2.3 |` Implementar `Copy port` y `Copy command`.
- [x] `T2.3.3 | US2.3 |` Advertir puertos ocupados y enlazar la apertura de logs desde la UI.

## Cambios no previstos incorporados
- Ninguno por ahora.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
