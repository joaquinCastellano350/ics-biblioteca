# Backend

Workspace `@ics-biblioteca/backend`: Express 5, TypeScript estricto y módulos ESM. Desarrollo con tsx, compilación con tsc y pruebas con el runner de Node.js. PostgreSQL en Neon se consulta mediante Prisma ORM 7 y su adaptador para node-postgres (`pg`), con un pool compartido para el proceso persistente de Express.

Requiere Node.js 24.15 o superior dentro de la rama 24 y npm 11 o superior. Instalar desde la raíz con `npm ci`.

## Variables de entorno

En la raíz, `neon deploy` o `neon env pull` escriben las conexiones y credenciales en `.env.local` (o `.env` si existe). La API y Prisma buscan, en ese orden, `.env.local`, `.env` de la raíz y `backend/.env`. Las variables ya definidas en el proceso tienen precedencia, como sucede en Render.

Ver [`.env.example`](../.env.example) para los nombres. Las credenciales se usan únicamente en el backend. Los archivos con valores reales están excluidos de Git.

- `DATABASE_URL`: conexión pooled utilizada por la API.
- `DATABASE_URL_UNPOOLED`: conexión directa utilizada por Prisma CLI para futuras migraciones.
- `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: acceso a Object Storage.
- `PORT`: puerto HTTP, 3000 por defecto.
- `STORAGE_BUCKET`: bucket privado, `assets` por defecto, como declara `neon.ts`.

## Comandos

Desde la raíz:

```sh
npm run dev --workspace backend
npm run build --workspace backend
npm run start --workspace backend
npm test --workspace backend
npm run db:validate --workspace backend
```

`build` genera el cliente Prisma y compila a `backend/dist/`. `start` ejecuta ese resultado. El cliente generado se excluye de Git y se regenera en cada build.

## Comprobaciones HTTP

- `GET /api/health`: verifica que Express está atendiendo, sin acceder a Neon.
- `GET /api/ready`: ejecuta `SELECT 1` mediante Prisma y comprueba acceso al bucket mediante `HeadBucket`. Devuelve 200 si ambos funcionan o 503 si alguno falla, sin revelar errores internos ni credenciales.

Con la API en marcha:

```sh
npm run check:services
```

La comprobación llama a `/api/ready`, carga un texto con clave aleatoria en `_connectivity-check/`, verifica su contenido, descarga mediante una URL firmada de 60 segundos y comprueba que la URL sin firma rechaza el acceso anónimo. Por último elimina el objeto temporal y comprueba su ausencia. Falla con código distinto de cero si falla cualquiera de estos pasos. `API_BASE_URL` permite cambiar la dirección de la API para esa comprobación.

Object Storage usa el SDK S3 con direccionamiento por ruta, requerido por Neon. Este módulo permitirá integrar el acceso a PDFs mediante URLs firmadas cuando se implementen las reglas de préstamos; la puesta en marcha no implementa todavía lectura ni autenticación y no expone endpoints de subida o descarga.

## Modelo de datos

El esquema Prisma declara el proveedor PostgreSQL y el generador, sin tablas de dominio. Prisma 7.10 permite generar ese cliente mediante `prisma generate` y usar consultas de conectividad sin adelantar el diseño de cuentas, sesiones o circulación. No se ejecutaron migraciones ni `db push` en esta puesta en marcha.

Las migraciones posteriores se versionarán en `prisma/migrations/`, siguiendo [la propuesta de datos](../docs/modelo-de-datos.md). Usarán la conexión directa y deberán revisarse antes de aplicarse a la rama correspondiente.

Administrar nuevas dependencias desde la raíz siguiendo el [README del repositorio](../README.md).
