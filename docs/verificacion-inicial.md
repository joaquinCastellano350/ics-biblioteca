# Verificación de la puesta en marcha

Registro histórico del scaffolding y su verificación inicial. Las pruebas, migraciones y límites descritos corresponden a esa etapa; consultar [los controles de release](release-sprint-1.md) para el estado actual.

Configuración acordada: Angular 22.2.3, Express 5, TypeScript estricto, ESM, Prisma ORM 7.10.1 y PostgreSQL en Neon. CLI Neon 8.10.3. Se conserva un único `package-lock.json` y los dos npm workspaces.

## Servicios aprovisionados

Proyecto `odd-base-60911651`, organización `org-icy-haze-28862920`, rama `production`, región `aws-us-east-2`.

`neon config plan` mostró únicamente `+ bucket assets`. `neon deploy` confirmó:

```text
Applied changes
  + bucket assets
Utilized services: Postgres, Object Storage
Pulled 7 Neon variables into .env.local
```

El bucket es privado. `.env.local`, `.neon` y el cliente Prisma generado están excluidos de Git. No se ejecutaron migraciones ni se crearon tablas de dominio.

## Compilación y pruebas

Comandos ejecutados desde la raíz, todos con código de salida 0 al finalizar:

```sh
npm run build
npm test
npm run db:validate --workspace backend
npm audit --json
```

Evidencia de compilación: Angular generó su salida estática en `frontend/dist/biblioteca/browser/`; Prisma generó el cliente 7.10.1 y `tsc` compiló la API en `backend/dist/`.

Pruebas: dos pruebas de Angular y una prueba HTTP de Express aprobadas. La prueba de Express verifica readiness con comprobación de base exitosa y fallida, código 503 ante fallo y ausencia de errores internos en la respuesta. Prisma validó el esquema. La auditoría final informó cero vulnerabilidades.

## Verificación de los servicios reales

Se inició la API compilada con `npm run start --workspace backend` y Angular con `npm run dev --workspace frontend -- --host 127.0.0.1`.

En PowerShell, se ejecutó el comprobador **a través del proxy de Angular**:

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:4200'
npm.cmd run check:services
```

Salida y código de salida 0:

```text
PASS Express -> Prisma -> PostgreSQL: HTTP 200 y SELECT 1.
PASS Object Storage: carga y descarga autenticadas.
PASS URL firmada: descarga HTTP 200 con contenido correcto.
PASS Bucket privado: acceso anónimo rechazado (403).
PASS Limpieza: objeto temporal eliminado.
```

`/api/ready` también verificó el acceso al bucket con `HeadBucket`. La prueba de almacenamiento usó una clave aleatoria en `_connectivity-check/`, comparó el contenido descargado y comprobó la eliminación con `HeadObject`. No imprimió credenciales ni URLs firmadas.

## Incidencias resueltas y límites

- La red aislada del sandbox impidió inicialmente descargar el motor de Prisma. La descarga y las comprobaciones de red se ejecutaron con el permiso correspondiente fuera del sandbox; el build final pasó.
- El flag `--allow-no-models` no existe en Prisma 7.10.1. Se corrigió el script a `prisma generate`; esta versión permite generar un cliente sin modelos por defecto.
- Se mantuvo el override de Vite 8.3.3 acordado para corregir los avisos del Vite incluido en Angular CLI 22.2.3. La auditoría final quedó sin vulnerabilidades.
- `pg` emitió un aviso de compatibilidad futura: en la versión 8 instalada, `sslmode=require` verifica el certificado y el nombre del servidor; esa interpretación cambiará en pg 9. La conexión real funcionó con las variables provistas por Neon. Revisar el modo TLS al actualizar a esa versión mayor.
- No se implementaron historias de autenticación, tablas del dominio ni el visor PDF. La prueba de archivos usa texto y acredita la conexión al almacenamiento y las URLs firmadas; no sustituye la validación del visor con PDFs reales pendiente en el ADR.
- El proxy `/api/**` corresponde al servidor de desarrollo. La URL pública y CORS para el despliegue en Render se configurarán con los dominios que se elijan.
