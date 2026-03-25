# PRD MVP - Gestor local de microservicios

## 1. Resumen ejecutivo

Este producto sera una aplicacion de escritorio local para organizar proyectos y administrar microservicios desde una sola interfaz. En el MVP, el usuario podra crear proyectos, registrar microservicios manualmente, ejecutarlos, detenerlos, visualizar logs en tiempo real y monitorear consumo de CPU y RAM tanto por proceso como a nivel global del equipo.

El objetivo de esta primera version es reducir la friccion operativa del entorno local de desarrollo, centralizando la administracion basica de multiples microservicios sin depender de scripts dispersos, multiples terminales abiertas o monitoreo manual.

## 2. Problema

Hoy, trabajar con varios microservicios locales suele implicar:

- abrir multiples terminales
- recordar comandos de arranque distintos
- navegar manualmente entre carpetas
- revisar logs en varias ventanas
- no tener una vista rapida del estado de cada servicio
- no saber facilmente que proceso esta consumiendo mas recursos
- perder tiempo para iniciar, detener o reiniciar entornos de desarrollo

Esto empeora cuando un proyecto crece y empieza a tener varios microservicios ejecutandose al mismo tiempo.

## 3. Objetivo del producto

Construir una aplicacion de escritorio que permita administrar microservicios locales por proyecto desde un panel visual unificado.

### Objetivos del MVP

1. Permitir crear y organizar proyectos.
2. Permitir registrar microservicios manualmente dentro de cada proyecto.
3. Permitir iniciar y detener microservicios desde la app.
4. Permitir visualizar logs en tiempo real desde la misma interfaz.
5. Mostrar consumo de CPU y RAM por microservicio.
6. Mostrar consumo global de CPU y RAM del equipo.
7. Mostrar graficas superiores con el comportamiento de CPU y RAM.

## 4. Alcance del MVP

### Incluye

- creacion, edicion y eliminacion de proyectos
- listado de proyectos en sidebar izquierda
- creacion, edicion y eliminacion de microservicios dentro de un proyecto
- registro manual del nombre del microservicio
- registro manual de la ruta del directorio de trabajo
- registro manual del comando de inicio
- autodeteccion best effort del puerto TCP levantado por el microservicio
- ejecucion del microservicio desde la app
- detencion del microservicio desde la app
- reinicio del microservicio desde la app
- captura y visualizacion de logs en tiempo real
- visualizacion de estado del microservicio
- visualizacion de PID del proceso
- monitoreo de CPU y RAM por proceso
- monitoreo global de CPU y RAM del equipo
- grafica de CPU por microservicio
- grafica de RAM por microservicio
- persistencia local de proyectos y microservicios

### No incluye en el MVP

- autodeteccion de microservicios dentro de carpetas
- edicion avanzada de variables de entorno
- terminal interactiva completa
- soporte Kubernetes o Docker
- pruebas de carga con K6
- health checks avanzados
- dependencias automaticas entre microservicios
- monitoreo distribuido en red
- sincronizacion en la nube
- GPU por proceso como requisito obligatorio

## 5. Usuario objetivo

### Usuario principal

Desarrollador o lider tecnico que trabaja localmente con varios microservicios y necesita una forma mas comoda de operarlos y monitorearlos.

### Perfil tipico

- usa Windows como maquina principal en esta primera fase
- trabaja con Node.js, NestJS, Java u otros binarios ejecutables localmente
- ejecuta varios servicios al mismo tiempo
- necesita revisar logs y consumo de recursos rapidamente

## 6. Casos de uso principales

### Caso de uso 1: Crear proyecto

El usuario crea un proyecto nuevo desde la app y este aparece en la barra lateral izquierda.

### Caso de uso 2: Registrar microservicio

Dentro de un proyecto, el usuario agrega un microservicio indicando nombre, ruta y comando de inicio. Cuando el proceso arranca, la app intenta detectar automaticamente en que puerto quedo escuchando.

### Caso de uso 3: Ejecutar microservicio

El usuario presiona el boton de correr y la app inicia el proceso usando el comando configurado dentro de la ruta indicada.

### Caso de uso 4: Ver logs

El usuario selecciona un microservicio y ve en el panel derecho su salida estandar y de error en tiempo real.

### Caso de uso 5: Detener o reiniciar microservicio

El usuario puede detener o reiniciar un microservicio desde su tarjeta en la lista principal.

### Caso de uso 6: Monitorear consumo

El usuario ve cuanto CPU y RAM consume cada microservicio, ademas del resumen general del equipo.

## 7. Historias de usuario

### Proyectos

- Como usuario, quiero crear un proyecto para agrupar microservicios relacionados.
- Como usuario, quiero ver mis proyectos en una barra lateral para acceder rapido a ellos.
- Como usuario, quiero editar el nombre de un proyecto para mantener mi organizacion.
- Como usuario, quiero eliminar un proyecto para limpiar configuraciones que ya no uso.

### Microservicios

- Como usuario, quiero agregar un microservicio a un proyecto para administrarlo desde la app.
- Como usuario, quiero configurar el comando exacto con el que arranca el microservicio para adaptarlo a cualquier stack.
- Como usuario, quiero definir el directorio de trabajo del microservicio para que el proceso se ejecute en la ubicacion correcta.
- Como usuario, quiero que la app detecte automaticamente el puerto real del microservicio para no configurarlo a mano.

### Ejecucion

- Como usuario, quiero iniciar un microservicio con un clic para no abrir terminales manualmente.
- Como usuario, quiero detener un microservicio con un clic para liberar recursos o reiniciar el entorno.
- Como usuario, quiero reiniciar un microservicio para aplicar cambios rapidamente.

### Logs

- Como usuario, quiero ver los logs del microservicio en tiempo real para detectar errores o confirmar que arranco correctamente.
- Como usuario, quiero que los logs aparezcan en un panel lateral tipo terminal para tener una experiencia clara y familiar.
- Como usuario, quiero limpiar la vista de logs para enfocarme en la ejecucion actual.

### Metricas

- Como usuario, quiero ver el uso de CPU y RAM de cada microservicio para identificar cual esta consumiendo mas recursos.
- Como usuario, quiero ver el uso global del equipo para saber si mi maquina esta saturada.
- Como usuario, quiero ver graficas de CPU y RAM para observar el comportamiento de consumo a lo largo del tiempo.

## 8. Requisitos funcionales

### RF-01 Gestion de proyectos

La app debe permitir crear, editar, listar y eliminar proyectos.

### RF-02 Sidebar de proyectos

La app debe mostrar los proyectos en una barra lateral izquierda y resaltar el proyecto activo.

### RF-03 Gestion de microservicios

La app debe permitir crear, editar, listar y eliminar microservicios dentro de un proyecto.

### RF-04 Configuracion de microservicio

Cada microservicio debe almacenar:

- nombre
- ruta del directorio de trabajo
- comando de inicio

Ademas, la app debe exponer el puerto detectado en runtime cuando el proceso abra un listener TCP local.

### RF-05 Inicio de proceso

La app debe poder iniciar el microservicio ejecutando el comando configurado dentro de su directorio de trabajo.

### RF-06 Detencion de proceso

La app debe poder detener el proceso iniciado por ella misma.

### RF-07 Reinicio de proceso

La app debe permitir reiniciar un microservicio deteniendolo y volviendolo a iniciar.

### RF-08 Estado del microservicio

La app debe mostrar el estado de cada microservicio con al menos estos valores:

- detenido
- iniciando
- corriendo
- error

### RF-09 Logs en tiempo real

La app debe capturar stdout y stderr del proceso y mostrarlos en tiempo real en un panel lateral derecho.

### RF-10 Datos del proceso

La app debe mostrar el PID del proceso cuando este corriendo.

### RF-11 Metricas por proceso

La app debe mostrar consumo de CPU y RAM por microservicio en ejecucion.

### RF-12 Metricas globales del sistema

La app debe mostrar CPU y RAM globales del equipo.

### RF-13 Graficas

La app debe mostrar una grafica superior de CPU y otra de RAM actualizadas periodicamente.

### RF-14 Persistencia local

La app debe guardar localmente proyectos y microservicios para que sigan disponibles al reabrir la aplicacion.

## 9. Requisitos no funcionales

### RNF-01 Plataforma inicial

La primera version debe funcionar en Windows.

### RNF-02 Operacion offline

La app debe funcionar completamente sin internet.

### RNF-03 Rendimiento UI

La interfaz no debe congelarse al recibir logs o al refrescar metricas.

### RNF-04 Aislamiento de fallos

Si un microservicio falla al arrancar, la app debe seguir funcionando normalmente.

### RNF-05 Persistencia confiable

Los datos locales deben recuperarse correctamente entre sesiones.

### RNF-06 Frecuencia de actualizacion

Las metricas deben refrescarse aproximadamente cada 1 a 2 segundos.

## 10. Diseno funcional de la interfaz

### Panel izquierdo

Sidebar de proyectos:

- boton "Nuevo proyecto"
- lista vertical de proyectos
- resaltado del proyecto activo

### Panel central

Detalle del proyecto:

- nombre del proyecto
- boton "Agregar microservicio"
- graficas superiores
- listado de microservicios uno debajo del otro

### Panel derecho

Consola/logs:

- nombre del microservicio seleccionado
- salida de logs en tiempo real
- busqueda simple
- limpiar logs
- autoscroll

## 11. Estructura visual de cada microservicio

Cada microservicio en la lista central debe mostrar como minimo:

- nombre
- estado
- puerto
- PID
- CPU
- RAM
- boton correr
- boton detener
- boton reiniciar
- boton logs
- boton editar

## 12. Modelo de datos inicial

### Proyecto

```ts
export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
```

### Microservicio

```ts
export type Microservice = {
  id: string;
  projectId: string;
  name: string;
  workingDirectory: string;
  startCommand: string;
  detectedPort?: number;
  status: "stopped" | "starting" | "running" | "error";
  pid?: number;
  createdAt: string;
  updatedAt: string;
};
```

### Log

```ts
export type LogEntry = {
  microserviceId: string;
  stream: "stdout" | "stderr";
  message: string;
  timestamp: string;
};
```

### Metrica

```ts
export type ServiceMetricSnapshot = {
  microserviceId: string;
  cpuPercent: number;
  memoryBytes: number;
  timestamp: string;
};
```

## 13. Arquitectura recomendada

### Aplicacion de escritorio

- Electron

### Frontend

- React
- TypeScript
- Tailwind CSS
- shadcn/ui

### Estado local

- Zustand

### Persistencia local

- SQLite o better-sqlite3

### Ejecucion de procesos

- child_process de Node.js

### Recoleccion de metricas

- systeminformation

### Graficas

- Recharts o Apache ECharts

### Consola visual

- panel propio simple al inicio
- xterm.js opcional en una iteracion posterior

## 14. Componentes o modulos internos

### 14.1 Projects Module

Responsable del CRUD de proyectos.

### 14.2 Microservices Module

Responsable del CRUD de microservicios dentro del proyecto.

### 14.3 Process Runtime Module

Responsable de iniciar, detener y reiniciar procesos, asi como de mantener PID y estado.

### 14.4 Logs Module

Responsable de capturar y enviar stdout y stderr al frontend.

### 14.5 Metrics Module

Responsable de consultar CPU y RAM globales, y CPU o RAM por PID.

### 14.6 Storage Module

Responsable de persistir configuracion local.

### 14.7 Dashboard Module

Responsable de mostrar metricas, tarjetas y graficas.

## 15. Criterios de aceptacion

### CA-01 Crear proyecto

**Dado** que el usuario esta en la pantalla principal  
**Cuando** crea un proyecto con un nombre valido  
**Entonces** el proyecto debe aparecer en la barra lateral izquierda y quedar disponible tras reiniciar la app.

### CA-02 Agregar microservicio

**Dado** que el usuario tiene un proyecto abierto  
**Cuando** registra un microservicio con nombre, ruta y comando validos  
**Entonces** el microservicio debe aparecer en la lista del proyecto.

### CA-03 Ejecutar microservicio

**Dado** que el microservicio esta configurado correctamente  
**Cuando** el usuario pulsa "Correr"  
**Entonces** la app debe iniciar el proceso, reflejar estado "iniciando" y luego "corriendo" si el arranque es exitoso.

### CA-04 Detener microservicio

**Dado** que un microservicio esta corriendo  
**Cuando** el usuario pulsa "Detener"  
**Entonces** la app debe finalizar el proceso y actualizar el estado a "detenido".

### CA-05 Ver logs

**Dado** que un microservicio esta emitiendo salida  
**Cuando** el usuario lo selecciona  
**Entonces** el panel derecho debe mostrar sus logs en tiempo real.

### CA-06 Ver metricas

**Dado** que un microservicio esta corriendo  
**Cuando** la app recolecta metricas  
**Entonces** el usuario debe ver CPU, RAM y PID del proceso en su tarjeta.

### CA-07 Graficas

**Dado** que hay uno o mas microservicios en ejecucion  
**Cuando** la app actualiza los datos  
**Entonces** las graficas superiores deben reflejar el consumo reciente de CPU y RAM.

### CA-08 Persistencia

**Dado** que el usuario ya creo proyectos y microservicios  
**Cuando** cierra y vuelve a abrir la app  
**Entonces** la informacion debe mantenerse.

## 16. Supuestos del MVP

1. El usuario conoce el comando correcto para iniciar cada microservicio.
2. El usuario proporcionara una ruta local valida.
3. La app intentara detectar automaticamente el puerto cuando el proceso exponga un listener TCP local.
4. Los microservicios a administrar seran procesos lanzables mediante comando del sistema.
5. La primera entrega prioriza Windows.

## 17. Riesgos tecnicos y decisiones clave

### 17.1 GPU por microservicio

Medir GPU por proceso puede no ser confiable en todos los entornos y librerias. En el MVP no debe bloquear la salida.

**Decision:** CPU y RAM por proceso son obligatorios. GPU global puede ser opcional. GPU por proceso se pospone.

### 17.2 Deteccion real del puerto

No todos los stacks exponen el puerto de forma uniforme.

**Decision:** en el MVP la app intenta detectar automaticamente el puerto real inspeccionando listeners TCP locales del proceso supervisado. Si no puede resolverlo, la UI mostrara `N/A`.

### 17.3 Comandos heterogeneos

Cada microservicio puede arrancar con npm, pnpm, yarn, java, dotnet u otro comando.

**Decision:** el usuario define el comando exacto y la app solo lo ejecuta.

### 17.4 Procesos huerfanos

Un cierre inesperado puede dejar procesos vivos.

**Decision:** la app debe intentar cerrar solo los procesos que ella inicio y marcar cualquier inconsistencia visualmente.

## 18. Metricas de exito del MVP

Se considerara exitoso el MVP si el usuario puede:

- crear proyectos sin errores
- agregar microservicios y persistirlos localmente
- iniciar y detener servicios al menos con comandos estandar
- visualizar logs de forma estable
- ver metricas basicas de CPU y RAM por proceso
- manejar varios microservicios desde una sola pantalla sin depender de multiples terminales

### Indicadores sugeridos

- tiempo de arranque desde clic hasta ejecucion visible
- estabilidad de captura de logs
- consistencia de metricas por proceso
- cantidad de microservicios concurrentes gestionables sin degradar la UI

## 19. Roadmap tecnico sugerido

### Fase 1 - Base de aplicacion

- estructura Electron mas React mas TypeScript
- layout de 3 paneles
- estado local base
- persistencia local

### Fase 2 - Gestion de datos

- CRUD de proyectos
- CRUD de microservicios

### Fase 3 - Runtime

- ejecutar procesos
- detener procesos
- reiniciar procesos
- manejar estados

### Fase 4 - Logs

- capturar stdout
- capturar stderr
- renderizar logs en panel derecho

### Fase 5 - Metricas

- CPU global
- RAM global
- CPU por PID
- RAM por PID

### Fase 6 - Dashboard

- tarjetas por microservicio
- graficas de CPU
- graficas de RAM

### Fase 7 - Pulido

- validaciones de formularios
- mensajes de error claros
- filtros de logs
- experiencia de usuario refinada

## 20. Backlog futuro fuera del MVP

- autodeteccion de microservicios por carpeta
- perfiles de ejecucion por proyecto
- dependencias entre servicios
- variables de entorno editables
- health checks automaticos
- K6 integrado
- snapshots o exportacion de logs
- Docker y containers
- soporte Linux o macOS
- GPU por proceso
- agrupacion de logs por sesion
- alertas de consumo alto

## 21. Resumen final del alcance

Este MVP consiste en una app de escritorio local que permite:

- crear proyectos
- agregar microservicios manualmente
- ejecutar, detener y reiniciar microservicios
- ver logs en tiempo real
- monitorear CPU y RAM por servicio
- ver consumo general del sistema
- visualizar graficas superiores de consumo

Con esta primera version se construye la base operativa del producto sin sobrecargar el desarrollo con funciones avanzadas prematuras.
