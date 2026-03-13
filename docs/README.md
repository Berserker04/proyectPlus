# Documentacion de MS Control Center

## Proposito
Este directorio centraliza la documentacion viva del MVP de `MS Control Center`. La estructura separa:

- el alcance canonico del producto;
- el backlog funcional por epicas e historias;
- el roadmap operativo con tareas y checks;
- el estado real de cada area funcional;
- el workflow que debe seguirse en cada prompt.

## Orden de lectura recomendado
1. [`process/prompt-delivery-workflow.md`](./process/prompt-delivery-workflow.md)
2. [`prd/mvp-ms-control-center.md`](./prd/mvp-ms-control-center.md)
3. [`product/mvp-epics-stories.md`](./product/mvp-epics-stories.md)
4. [`product/mvp-roadmap.md`](./product/mvp-roadmap.md)
5. `areas/*/README.md` del area impactada

## Mapa documental
| Documento | Proposito | Fuente de verdad |
| --- | --- | --- |
| [`prd/mvp-ms-control-center.md`](./prd/mvp-ms-control-center.md) | Define vision, alcance, NFR, arquitectura y criterios de aceptacion del MVP | Que construir |
| [`product/mvp-epics-stories.md`](./product/mvp-epics-stories.md) | Define epicas, historias, criterios de aceptacion y dependencias | Por que y para quien |
| [`product/mvp-roadmap.md`](./product/mvp-roadmap.md) | Define tareas, dependencias de implementacion, definition of done y scope changes | Como ejecutar |
| [`process/prompt-delivery-workflow.md`](./process/prompt-delivery-workflow.md) | Define el protocolo obligatorio de lectura, actualizacion y cierre por prompt | Como operar la documentacion |
| [`areas/discovery/README.md`](./areas/discovery/README.md) | Estado real del area de descubrimiento y dashboard inicial | Estado del area E1 |
| [`areas/discovery/service-manifest.md`](./areas/discovery/service-manifest.md) | Contrato del manifest manual por servicio y regla de prioridad sobre heuristicas | Contrato operativo del manifest E1 |
| [`areas/operations/README.md`](./areas/operations/README.md) | Estado real del area de control operativo | Estado del area E2 |
| [`areas/observability/README.md`](./areas/observability/README.md) | Estado real de metricas, puertos, GPU y logs | Estado del area E3 |
| [`areas/k6-lab/README.md`](./areas/k6-lab/README.md) | Estado real de integracion k6, ejecucion y graficas | Estado del area E4 |
| [`areas/platform-persistence/README.md`](./areas/platform-persistence/README.md) | Estado real de persistencia, settings y guardrails de plataforma | Estado del area E5 |
| [`templates/area-readme-template.md`](./templates/area-readme-template.md) | Plantilla para nuevas areas o subareas | Estandar de documentacion |

## Matriz de fuente de verdad
| Pregunta | Documento a actualizar primero |
| --- | --- |
| Que entra o no entra en el MVP | PRD |
| Que epicas e historias existen | Backlog de epicas e historias |
| Que tareas quedan, se completaron o aparecieron nuevas | Roadmap vivo |
| Cual es el estado real de un area | README del area |
| Como sincronizar y cerrar un prompt | Workflow operativo |

## Convencion de IDs
- `E#`: epicas. Ejemplo: `E3`.
- `US#.#`: historias de usuario. Ejemplo: `US3.2`.
- `T#.#.#`: tareas del roadmap. Ejemplo: `T3.2.1`.
- `SC-###`: cambios de alcance descubiertos durante la ejecucion. Ejemplo: `SC-001`.

## Reglas de seguimiento
- Solo usar checkboxes Markdown `[ ]` y `[x]`.
- Una tarea debe apuntar a una historia existente.
- Una historia debe pertenecer a una epica existente.
- Un cambio de alcance no planificado debe agregarse primero al roadmap y luego reflejarse en el README del area afectada.
- Si una historia cambia de alcance, actualizar primero el README del area y luego la historia y el roadmap relacionados.

## Bootstrap documental
- [x] PRD canonico creado
- [x] Backlog de epicas e historias creado
- [x] Roadmap vivo creado
- [x] Workflow operativo creado
- [x] READMEs de area creados
- [x] Plantilla reusable creada
