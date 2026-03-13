# Service Manifest

## Proposito
Definir el contrato del manifest manual por servicio usado por `MS Control Center` para sobrescribir metadata autodetectada o registrar servicios que no entran en las heuristicas de discovery.

## Ubicacion
- Archivo por workspace: `.ms-control-center/services.manifest.json`
- La ruta se resuelve siempre relativa al root del workspace activo.

## Regla de prioridad
`manifest > convencion > heuristica`

Si un `path` del manifest coincide con un servicio detectado automaticamente:
- el servicio conserva el mismo `path`;
- la metadata del manifest gana sobre la metadata autodetectada;
- el `source` final del servicio queda en `manifest`.

Si un `path` del manifest no coincide con ningun servicio autodetectado:
- se crea un servicio manual nuevo dentro del catalogo del workspace.

## Esquema actual
```json
{
  "schemaVersion": 1,
  "services": [
    {
      "path": "legacy/gateway",
      "name": "Legacy Gateway",
      "runtimeType": "node",
      "frameworkType": "express",
      "expectedPort": 8088,
      "startCommand": "npm --prefix legacy/gateway run dev",
      "tags": ["gateway", "legacy"],
      "env": {
        "PORT": "8088",
        "NODE_ENV": "development"
      }
    }
  ]
}
```

## Campos
- `schemaVersion`: version actual del contrato. En este MVP es `1`.
- `services`: lista de servicios manuales u overrides.
- `path`: ruta del servicio dentro del workspace. Es la clave de merge.
- `name`: nombre visible del servicio.
- `runtimeType`: runtime del servicio, por ejemplo `node`, `python`, `java`.
- `frameworkType`: framework o clasificacion visible, por ejemplo `nestjs`, `express`, `custom`.
- `expectedPort`: puerto esperado del servicio.
- `startCommand`: comando sugerido para arrancar el servicio desde la app.
- `tags`: etiquetas visibles y filtrables.
- `env`: variables de entorno clave-valor asociadas al servicio.

## Reglas practicas
- `path` debe apuntar a una carpeta dentro del workspace activo cuando el registro se hace desde la UI.
- `runtimeType` y `frameworkType` se normalizan a lowercase.
- `tags` se normalizan a lowercase y se deduplican.
- `env` normaliza claves a uppercase y descarta pares vacios.

## Relacion con la UI
- La UI actual permite guardar entradas manuales desde el panel lateral.
- Cada guardado actualiza este archivo y dispara un rescan del catalogo.
