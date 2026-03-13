# PRD MVP - Gestor local de microservicios

## 1. Nombre tentativo
`MS Control Center`

## 2. Vision del producto
Construir una aplicacion de escritorio local que permita al desarrollador descubrir, visualizar, controlar y probar microservicios desde un unico panel. El MVP arranca con soporte para proyectos NestJS y deja la arquitectura preparada para sumar despues servicios en Java, Go, Node generico, Python y otros runtimes.

## 3. Problema que resuelve
Operar multiples microservicios locales hoy implica:

- revisar carpetas manualmente;
- abrir varias terminales;
- recordar puertos;
- validar que servicio esta arriba o caido;
- revisar RAM y CPU a mano;
- correr comandos distintos para start y restart;
- lanzar k6 por separado;
- analizar resultados en varias herramientas.

Ese flujo fragmenta la operacion diaria y ralentiza la validacion local de sistemas compuestos por multiples servicios.

## 4. Objetivo del MVP
Permitir que un desarrollador pueda, desde una sola app local:

- seleccionar una carpeta raiz de trabajo;
- descubrir microservicios Nest dentro de esa carpeta;
- ver cuales estan corriendo y cuales no;
- ver sus puertos y consumo de recursos;
- iniciar, detener y reiniciar servicios con un clic;
- ver logs basicos en vivo;
- ejecutar pruebas k6 desde la misma interfaz;
- visualizar resultados de rendimiento de manera grafica.

## 5. Alcance funcional del MVP

### 5.1 Descubrimiento de servicios
La app debe permitir seleccionar una carpeta raiz local y escanearla dinamicamente.

Debe detectar inicialmente:

- proyectos NestJS por `package.json`, `nest-cli.json`, estructura tipica o scripts conocidos;
- repos separados o multiples servicios dentro de una misma carpeta raiz;
- servicios definidos manualmente aunque no cumplan la convencion automatica.

La estrategia base del MVP sera hibrida:

- autodiscovery para detectar servicios Nest automaticamente;
- manifest opcional por servicio para afinar comandos, puerto esperado, tags, variables de entorno y tipo.

La metadata conceptual minima por servicio debe contemplar:

- nombre;
- path absoluto;
- tipo de runtime;
- comando start dev;
- comando start prod o local;
- comando test;
- puerto esperado;
- variables de entorno;
- tags como `auth`, `payments` o `gateway`.

### 5.2 Dashboard principal
El tablero principal debe mostrar servicios de forma dinamica y ordenada.

Cada tarjeta o fila debe mostrar al menos:

- nombre del microservicio;
- ruta local;
- framework o runtime;
- estado: `running`, `stopped`, `starting`, `error`;
- PID si esta en ejecucion;
- puerto detectado o esperado;
- uptime;
- consumo de CPU;
- consumo de RAM;
- consumo de GPU cuando sea soportado;
- ultimo log relevante o estado visual de salud.

El usuario debe poder ordenar por:

- nombre;
- estado;
- puerto;
- RAM;
- CPU;
- fecha de inicio.

El usuario debe poder filtrar por:

- corriendo o detenidos;
- tipo de servicio;
- tags;
- busqueda por texto.

### 5.3 Control operativo de servicios
Cada servicio debe soportar desde UI:

- `Run` o `Start`;
- `Stop`;
- `Restart`;
- `Open folder`;
- `Open terminal in folder`;
- `Copy port` y `Copy command`;
- `View logs`.

Reglas del MVP:

- si el servicio no esta corriendo, el boton principal sera `Run`;
- si esta corriendo, mostrar `Stop` y `Restart`;
- si falla el arranque, mostrar error estructurado;
- si el puerto esperado ya esta ocupado, mostrar advertencia clara;
- si el proceso fue iniciado por la app, la app debe poder supervisarlo y terminarlo correctamente.

### 5.4 Monitoreo de recursos
Obligatorio en MVP:

- CPU por proceso;
- RAM por proceso;
- total de CPU y RAM del sistema;
- puerto en escucha por servicio.

Alcance de GPU para MVP:

- mostrar uso global de GPU cuando este soportado;
- mostrar uso por proceso cuando el SO, driver y vendor lo permitan;
- comenzar con soporte prioritario para NVIDIA;
- mostrar etiqueta `best effort` o `not available` cuando no haya datos confiables.

`sysinfo` cubrira procesos, memoria y CPU. Para GPU se prioriza una capa basada en NVML o `nvidia-smi` cuando aplique. En Windows no se promete precision universal para memoria GPU por proceso desde el primer dia.

### 5.5 Logs y salida del servicio
Cada servicio debe tener una vista de logs en tiempo real con:

- `stdout`;
- `stderr`;
- resaltado por nivel cuando sea posible;
- busqueda en logs;
- limpieza del buffer visible;
- opcion de pausar autoscroll.

El MVP no incluye persistencia historica completa de logs. Bastara con buffer en memoria y exportacion manual.

### 5.6 Integracion con k6
La app no reimplementa k6. Lo orquesta localmente mediante la CLI.

El MVP debe permitir desde la UI:

- seleccionar script k6;
- elegir perfil: `smoke`, `load`, `stress`, `spike`;
- parametrizar VUs, duracion, rate y thresholds basicos;
- ejecutar la prueba;
- cancelar una prueba en curso;
- guardar resultado local;
- ver graficas.

Graficas minimas del MVP:

- latencia promedio;
- p95;
- p99;
- requests por segundo;
- tasa de error;
- VUs activos;
- duracion total;
- `checks` pass o fail;
- thresholds cumplidos o incumplidos.

Enfoque tecnico recomendado:

- ejecutar k6 CLI como proceso hijo;
- guardar resultado JSON;
- parsear resumen y series relevantes;
- mostrar graficas dentro de la app;
- opcionalmente permitir abrir el dashboard web de k6 en una vista embebida o navegador externo.

## 6. Requisitos no funcionales

### Rendimiento
- apertura inicial de la app en menos de 3 segundos con un workspace mediano;
- refresco de estado visible cada 1 o 2 segundos sin bloquear UI;
- escaneo inicial incremental, sin congelar la app.

### Seguridad
- ejecucion solo local;
- sin exponer APIs remotas en el MVP;
- allowlist estricta de comandos y rutas;
- no ejecutar shell arbitraria desde el frontend;
- separar permisos del shell y procesos mediante el modelo de capacidades de Tauri.

### Confiabilidad
- si la app se cierra, debe intentar limpiar procesos lanzados por ella o marcarlos claramente como huerfanos;
- reinicios controlados;
- manejo de errores por puerto ocupado, comando invalido o dependencia faltante.

### UX
- todo lo importante visible en una sola pantalla;
- feedback inmediato al iniciar y detener;
- estados visuales claros;
- dark mode desde el inicio.

## 7. Arquitectura propuesta

### 7.1 Estilo arquitectonico
Monolito modular local con puertos y adaptadores.

Modulos de dominio:

- workspace;
- service-catalog;
- service-runtime;
- process-supervisor;
- metrics;
- ports-detector;
- logs;
- k6-runner;
- results-history;
- settings.

Capas:

- Presentacion: React + TypeScript para componentes, paginas y stores.
- Aplicacion: casos de uso, orquestacion y reglas de negocio.
- Dominio: entidades y contratos, estados de servicio y resultados de prueba.
- Infraestructura: Tauri commands, spawn de procesos, filesystem watcher, SQLite, integracion k6 y adaptadores GPU o SO.

### 7.2 Componentes principales

#### A. Desktop Shell
Tauri 2 como contenedor de escritorio, con comunicacion frontend-backend por comandos y eventos. Debe empujar cambios de estado, logs y metricas en tiempo real.

#### B. Core Orchestrator
Implementado en Rust.

Responsabilidades:

- descubrir servicios;
- iniciar procesos;
- detener procesos;
- supervisar estado;
- correlacionar PID con servicio;
- emitir eventos de logs, metricas y cambios de estado.

#### C. Metrics Collector
- CPU y RAM por proceso: `sysinfo`.
- Puertos: correlacion proceso con socket en escucha.
- GPU: adaptadores por proveedor y sistema operativo.

#### D. Service Manifest Resolver
Debe resolver metadata por servicio con prioridad:

1. manifest manual del servicio;
2. convenciones del proyecto;
3. heuristicas automaticas.

#### E. k6 Runner
Debe:

- validar que k6 exista localmente;
- ejecutar pruebas;
- recoger `stdout` y `stderr`;
- persistir JSON;
- producir series para graficas.

#### F. Local Storage
SQLite para:

- workspaces;
- servicios detectados o configurados;
- historial de ejecuciones;
- historial de pruebas k6;
- preferencias del usuario.

## 8. Modelo de datos del MVP

### Workspace
- `id`
- `nombre`
- `rootPath`
- `createdAt`
- `updatedAt`

### Service
- `id`
- `workspaceId`
- `name`
- `path`
- `runtimeType`
- `frameworkType`
- `expectedPort`
- `detectedPort`
- `startCommand`
- `stopStrategy`
- `tags`
- `autoDetected`
- `lastKnownStatus`

### ProcessInstance
- `id`
- `serviceId`
- `pid`
- `status`
- `startedAt`
- `stoppedAt`
- `cpuPercent`
- `memoryBytes`
- `gpuPercent`
- `gpuMemoryBytes`

### K6Script
- `id`
- `serviceId`
- `name`
- `path`
- `defaultConfigJson`

### K6Run
- `id`
- `serviceId`
- `scriptId`
- `status`
- `startedAt`
- `finishedAt`
- `summaryJson`
- `rawResultPath`

## 9. Flujo de usuario principal

### Flujo 1 - Primer uso
1. Abrir la app.
2. Registrar carpeta raiz.
3. Ejecutar escaneo automatico.
4. Detectar servicios Nest.
5. Mostrar tablero con estados iniciales.

### Flujo 2 - Arrancar servicio
1. Hacer click en un servicio detenido.
2. Ejecutar `Run`.
3. Lanzar el comando configurado.
4. Detectar PID y puerto.
5. Empezar a mostrar logs y metricas.

### Flujo 3 - Reiniciar servicio
1. Hacer click en `Restart`.
2. Terminar el proceso controlado.
3. Reejecutar el comando.
4. Mantener historial de intento.

### Flujo 4 - Prueba k6
1. Seleccionar servicio.
2. Seleccionar script.
3. Configurar VUs y duracion.
4. Ejecutar la prueba.
5. Ver progreso.
6. Ver resultados y graficas.
7. Guardar corrida.

## 10. Pantallas del MVP

### Pantalla 1 - Dashboard de servicios
- sidebar con workspaces;
- barra superior con busqueda y filtros;
- lista o grid de servicios;
- metricas resumidas del sistema;
- acciones rapidas.

### Pantalla 2 - Detalle de servicio
- informacion general;
- logs en vivo;
- metricas en tiempo real;
- configuracion de comandos;
- historial de ejecuciones.

### Pantalla 3 - Laboratorio k6
- scripts disponibles;
- formulario de ejecucion;
- progreso de prueba;
- graficas;
- resumen y thresholds.

### Pantalla 4 - Settings
- rutas por defecto;
- shell permitida;
- frecuencia de refresh;
- tema;
- configuracion GPU;
- ruta del binario k6.

## 11. Historias clave del MVP
- Epic 1 - Descubrimiento: como desarrollador quiero seleccionar una carpeta raiz y que la app detecte mis servicios Nest para no registrar todo manualmente.
- Epic 2 - Operacion: como desarrollador quiero iniciar, detener y reiniciar mis servicios con un clic para evitar manejar muchas terminales.
- Epic 3 - Observabilidad local: como desarrollador quiero ver puerto, PID, CPU, RAM y GPU de cada servicio para entender el comportamiento local.
- Epic 4 - Pruebas de carga: como desarrollador quiero lanzar pruebas k6 desde la app y ver graficas para validar rendimiento sin salir del panel.
- Epic 5 - Persistencia: como desarrollador quiero que la app recuerde mis workspaces, servicios y pruebas anteriores.

## 12. Criterios de aceptacion del MVP
El MVP se considera listo cuando:

- el usuario puede registrar una carpeta raiz;
- la app detecta al menos servicios Nest tipicos;
- el dashboard muestra estado `running` y `stopped` correctamente;
- la app detecta o resuelve el puerto de cada servicio;
- se puede iniciar, detener y reiniciar servicios desde UI;
- se muestran CPU y RAM por servicio en tiempo real;
- se muestra GPU global y, si el entorno lo soporta, GPU por proceso;
- se visualizan logs de `stdout` y `stderr`;
- se puede ejecutar k6 desde la app;
- se muestran graficas de resultados k6;
- se guarda historial basico de corridas;
- los comandos permitidos estan restringidos y no hay ejecucion arbitraria libre.

## 13. Fuera del MVP
Para mantener el enfoque del MVP, queda fuera:

- despliegues remotos;
- SSH a servidores;
- gestion completa de Docker o Kubernetes;
- metricas distribuidas tipo Prometheus;
- tracing;
- health checks HTTP avanzados;
- edicion visual de scripts k6 complejos;
- soporte multi-runtime total para Java, Go o Python desde el dia 1;
- soporte GPU universal y perfecto en todos los vendors y SO.

## 14. Roadmap despues del MVP

### Fase 2
- soporte formal para Java, Go y Python;
- health checks HTTP y TCP;
- perfiles de arranque por workspace;
- acciones grupales para arrancar multiples servicios;
- dependencias entre servicios;
- import y export de configuracion.

### Fase 3
- integracion con Docker Compose;
- dashboards historicos;
- comparacion entre corridas k6;
- alertas locales;
- perfiles por proyecto;
- terminal embebida.

### Fase 4
- ejecucion remota;
- agentes livianos;
- observabilidad distribuida;
- plantillas por arquitectura.

## 15. Decisiones tecnicas finales
Stack recomendado:

- Tauri 2;
- Rust;
- React + TypeScript;
- Vite;
- SQLite;
- ECharts;
- k6 local;
- `sysinfo` para CPU, RAM y procesos;
- NVML o `nvidia-smi` para la capa GPU NVIDIA cuando aplique.

No se prioriza Electron porque el costo de empaquetar Chromium y Node no ofrece ventaja clara frente al modelo de permisos y control local de procesos que aporta Tauri.

No se prioriza una solucion hecha en puro Nest porque el problema central es la orquestacion de procesos locales, lectura de metricas, puertos, archivos y CLIs externas, algo que encaja mejor con un core nativo.
