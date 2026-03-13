# Workflow operativo por prompt

## Objetivo
Este documento define el flujo obligatorio que debe seguirse cada vez que se ejecute un prompt relacionado con `MS Control Center`. Su fin es evitar deriva entre el PRD, el backlog, el roadmap y los READMEs de area.

## Lectura obligatoria al iniciar
1. Leer este archivo completo.
2. Revisar el alcance base en [`../prd/mvp-ms-control-center.md`](../prd/mvp-ms-control-center.md).
3. Ubicar la epica e historia objetivo en [`../product/mvp-epics-stories.md`](../product/mvp-epics-stories.md).
4. Ubicar las tareas activas en [`../product/mvp-roadmap.md`](../product/mvp-roadmap.md).
5. Abrir el `README.md` del area impactada dentro de `../areas/`.

## Como localizar la epica, historia y tarea correctas
1. Identificar primero el area funcional afectada: discovery, operations, observability, k6-lab o platform-persistence.
2. Resolver la epica por area:
   - `E1` discovery
   - `E2` operations
   - `E3` observability
   - `E4` k6-lab
   - `E5` platform-persistence
3. Dentro de la epica, ubicar la historia `US#.#` cuya promesa funcional coincide con el prompt.
4. Dentro del roadmap, usar la serie `T#.#.#` de esa historia como checklist operativo.
5. Si el prompt afecta varias areas, actualizar todas las historias y READMEs implicados antes de cerrar.

## Cuando crear o actualizar un README de area
- Actualizar el README del area siempre que una tarea modifique comportamiento, decisiones, dependencias o alcance del area.
- Crear un nuevo README a partir de [`../templates/area-readme-template.md`](../templates/area-readme-template.md) si aparece una nueva macro-area o una subarea que ya no quepa con claridad en el README actual.
- No duplicar el PRD dentro del README. El README debe capturar estado real, decisiones vigentes y checklist local.

## Regla para marcar checks
- Marcar una tarea `T#.#.#` como `[x]` en el roadmap cuando la implementacion o decision asociada este cerrada.
- Reflejar esa misma finalizacion en el checklist del README del area afectada.
- Marcar una historia `US#.#` como `[x]` solo cuando:
  - todas sus tareas ligadas en el roadmap esten en `[x]`;
  - sus criterios de aceptacion esten satisfechos;
  - el README del area refleje el estado final vigente.
- Marcar una epica `E#` como `[x]` solo cuando todas sus historias esten en `[x]`.

## Como registrar cambios de alcance no previstos
1. Identificar si el trabajo nuevo es:
   - una tarea adicional dentro de una historia existente; o
   - una nueva historia dentro de una epica existente; o
   - una nueva epica si abre un bloque funcional distinto.
2. Agregar el cambio primero en la seccion `Scope changes` de [`../product/mvp-roadmap.md`](../product/mvp-roadmap.md) usando un ID `SC-###`.
3. Si cambia el contrato funcional, reflejarlo en [`../product/mvp-epics-stories.md`](../product/mvp-epics-stories.md).
4. Actualizar el README del area con:
   - la razon del cambio;
   - el nuevo estado esperado;
   - las tareas nuevas que nacen de ese cambio.
5. No cerrar el prompt mientras exista trabajo nuevo sin aterrizar en roadmap y README.

## Sincronizacion antes de cerrar una iteracion
1. Verificar que los cambios implementados estan representados en el roadmap.
2. Verificar que la historia impactada refleja el estado correcto en el backlog.
3. Verificar que el README del area captura decisiones actuales, checklist y cambios extra.
4. Verificar enlaces y IDs cruzados.
5. Si hubo desviaciones respecto al PRD, decidir si se trata de:
   - una aclaracion menor, que puede vivir en backlog y README; o
   - un cambio de alcance, que requiere actualizar el PRD.

## Checklist de cierre rapido
- [ ] Se identifico la epica correcta
- [ ] Se identifico la historia correcta
- [ ] Se actualizaron las tareas del roadmap
- [ ] Se sincronizo el README del area
- [ ] Se registraron los cambios de alcance no previstos, si existieron
- [ ] Se revisaron enlaces e IDs antes de cerrar
