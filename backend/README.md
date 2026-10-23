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

El esquema Prisma integra los modelos de universidades, usuarios y sesiones del
equipo con las cinco tablas del catálogo: libros, autores, materias y sus dos
relaciones. La migración de SCRUM-13 define sus PK, FK e índices, además del
CHECK de cupos totales no negativos. No contiene carga inicial ni crea entidades
de circulación. Las migraciones no se aplican al iniciar Express.

El 22/10/2026 se aplicó la migración del catálogo a la rama `production` de Neon,
conservando la migración de cuentas que ya estaba aplicada. Ver el
[registro de aplicación y verificación](../docs/migracion-catalogo-neon.md).

Las migraciones posteriores se versionarán en `prisma/migrations/`, siguiendo [la propuesta de datos](../docs/modelo-de-datos.md). Usarán la conexión directa y deberán revisarse antes de aplicarse a la rama correspondiente.

Desde la raíz, `npm exec --workspace backend -- prisma migrate status` consulta
el estado y `npm exec --workspace backend -- prisma migrate deploy` aplica las
migraciones pendientes al destino de `DATABASE_URL_UNPOOLED`. Este último cambia
la base configurada; comprobar la rama de Neon antes de ejecutarlo. Mantener el
historial completo de las migraciones del equipo en cada checkout.

Administrar nuevas dependencias desde la raíz siguiendo el [README del repositorio](../README.md).

## Módulo de libros

`src/book/book.ts` define la entidad completa y su proyección pública;
`book-repository-interface.ts` define el contrato; `book-repository.ts` usa el
cliente Prisma compartido; `book-controller.ts` prepara la respuesta pública y
`book-routes.ts` expone `GET /api/books`. Esta lectura no recibe escrituras ni
criterios de búsqueda que validar. Los requisitos de carga y circulación se
implementarán en sus operaciones correspondientes.

Las pruebas conservan las comprobaciones de readiness del scaffolding y agregan
el endpoint y el recorrido Prisma/adaptador pg/PostgreSQL embebido. Las tablas y
los datos de esas pruebas viven exclusivamente en memoria. No validan el acceso
a la instancia real de Neon ni escriben en ella.

Después de compilar Angular, `server.ts` detecta `frontend/dist/biblioteca/browser`
y Express lo sirve en el mismo origen que `/api`. Las rutas públicas de Angular
se resuelven con `index.html`; una ruta API inexistente sigue devolviendo JSON
404 y no recibe el HTML de la aplicación.
