# Area K6 Lab

## Proposito y alcance
Esta area cubre la integracion local con k6: seleccion de scripts, perfiles de prueba, ejecucion de corridas, cancelacion, persistencia de resultados y visualizacion de graficas del MVP.

## Epica e historias relacionadas
- [x] `E4` Laboratorio k6
- [x] `US4.1` Registrar scripts y perfiles de prueba
- [x] `US4.2` Ejecutar y cancelar corridas k6 desde la app
- [x] `US4.3` Visualizar resultados, graficas e historial basico

## Decisiones actuales
- k6 se integrara como CLI local orquestada por la app, no como un motor reimplementado.
- Cada corrida debe producir un JSON persistible y un resumen util para la interfaz.
- Las graficas minimas del MVP cubriran latencia, throughput, errores, VUs, duracion, checks y thresholds.
- El laboratorio ya autodetecta scripts k6 por servicio usando heuristicas cercanas al archivo y permite registrar rutas manuales dentro del workspace activo.
- Los presets `smoke`, `load`, `stress` y `spike` se exponen desde UI, pero siguen siendo editables antes de validar o ejecutar.
- La validacion actual cubre binario k6, `VUs`, `duration`, `rate` y sintaxis basica de thresholds; la ejecucion real ya corre desde la misma UI.
- El MVP soporta una sola corrida k6 global activa a la vez; si ya hay una corrida en curso, cualquier nuevo `Run` queda bloqueado.
- Si el servicio asociado esta `stopped`, la app emite warning estructurado pero deja continuar la corrida.
- Cada corrida persiste `result.json` y `summary.json` bajo `app_data_dir()/k6-runs/<run_id>/`, y el wrapper operativo queda en `k6_run.summary_json`.
- La UI ya evalua thresholds basicos de forma local contra el resumen parseado cuando existen metricas compatibles, y marca `Not evaluated` cuando no hay base confiable.
- El historial del MVP queda acotado a corridas finalizadas del workspace activo, con graficas del ultimo reporte y boton de dashboard externo solo si la corrida capturo una URL.
- El laboratorio ya restaura por workspace el ultimo servicio/script/perfil usado y sus parametros, mientras `k6BinaryPath` se conserva a nivel global para toda la app.
- `k6BinaryPath` ahora tambien puede configurarse desde la pantalla global de `Settings`, y ambos flujos comparten la misma preferencia persistida para evitar drift.
- `k6BinaryPath` ya no acepta ejecutables arbitrarios: solo se permite un binario llamado `k6` o `k6.exe`, y la ruta se rechaza antes de guardarse o ejecutar validaciones/corridas si no cumple ese contrato.
- Las acciones `validate`, `run` y `cancel` del laboratorio ya quedan encapsuladas por permisos explicitos del app manifest dentro del set `k6-runtime`, accesible solo desde la ventana `main`.

## Checklist local
- [x] `T4.1.1 | US4.1 |` Descubrir o registrar scripts k6 por servicio o endpoint.
- [x] `T4.1.2 | US4.1 |` Exponer perfiles `smoke`, `load`, `stress` y `spike` con parametros editables.
- [x] `T4.1.3 | US4.1 |` Validar thresholds basicos y ruta configurada del binario k6.
- [x] `T4.2.1 | US4.2 |` Ejecutar k6 CLI como proceso hijo y capturar `stdout` y `stderr`.
- [x] `T4.2.2 | US4.2 |` Permitir cancelar una corrida en curso desde la UI.
- [x] `T4.2.3 | US4.2 |` Guardar el resultado JSON y un resumen estructurado por corrida.
- [x] `T4.3.1 | US4.3 |` Parsear metricas clave: `avg`, `p95`, `p99`, `rps`, errores, VUs, duracion, checks y thresholds.
- [x] `T4.3.2 | US4.3 |` Renderizar graficas dentro de la app con `ECharts`.
- [x] `T4.3.3 | US4.3 |` Exponer historial basico de corridas y opcion de abrir dashboard externo cuando se habilite.

## Cambios no previstos incorporados
- Ninguno por ahora.

## Enlaces
- PRD: [`../../prd/mvp-ms-control-center.md`](../../prd/mvp-ms-control-center.md)
- Backlog: [`../../product/mvp-epics-stories.md`](../../product/mvp-epics-stories.md)
- Roadmap: [`../../product/mvp-roadmap.md`](../../product/mvp-roadmap.md)
