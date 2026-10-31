# Biblioteca Digital Universitaria

Biblioteca universitaria con catálogo público y préstamos digitales de duración limitada para estudiantes registrados.

## Organización

Monorepo administrado con npm workspaces:

```text
ICS-Biblioteca/
├── frontend/          # Interfaz web: @ics-biblioteca/frontend
│   ├── src/
│   └── package.json
├── backend/           # API y reglas de negocio: @ics-biblioteca/backend
│   ├── src/
│   └── package.json
├── docs/              # Documentación y modelo de datos
├── CONTEXT.md         # Vocabulario del dominio
├── package.json       # Configuración de los workspaces
└── package-lock.json  # Resolución de dependencias de todo el repositorio
```

Cada aplicación mantiene sus dependencias en su propio `package.json`. La instalación se administra desde la raíz, con un único `package-lock.json`. Las aplicaciones mantienen sus compilaciones separadas; según el ADR-0002 aceptado, en producción se publicarán juntas en un único Render Web Service.

## Preparación

La release se verifica con Node.js 24.20.0 y npm 12.0.2, fijados en `.nvmrc` y `packageManager`. Los mínimos compatibles siguen siendo Node.js 24.15 dentro de la rama 24 y npm 11.

Desde la raíz del repositorio:

```sh
npm ci
npm ls --workspaces --depth=0
```

El segundo comando debe mostrar `@ics-biblioteca/frontend` y `@ics-biblioteca/backend` vinculados a sus carpetas locales.

## Agregar dependencias

Ejecutar estos comandos desde la raíz, reemplazando `nombre-del-paquete` por la dependencia elegida:

```sh
npm install nombre-del-paquete --workspace frontend
npm install nombre-del-paquete --workspace backend
```

Para una dependencia de desarrollo de una aplicación, agregar `--save-dev`. Para herramientas compartidas del repositorio, usar `npm install --save-dev nombre-del-paquete` desde la raíz, sin seleccionar un workspace.

Versionar los cambios del `package.json` correspondiente junto con el `package-lock.json` de la raíz.

## Estado de las aplicaciones

Desde la raíz:

```sh
npm run dev --workspace frontend
npm run dev --workspace backend
npm run build
npm test
npm run start --workspace backend
npm run check:services
```

Ejecutar los dos comandos `dev` en terminales separadas. Angular escucha en el puerto 4200 y reenvía `/api/**` a Express en el puerto 3000 mediante un proxy de desarrollo. `start` requiere compilar antes; `check:services` requiere que la API esté en marcha.

Ver [la documentación del frontend](frontend/README.md) y [la del backend](backend/README.md) para los detalles de desarrollo, variables y publicación.

## Neon

El proyecto vinculado es `odd-base-60911651`, de la organización `org-icy-haze-28862920`, en `aws-us-east-2`. La puesta en marcha usa la rama `production` indicada en el comando de configuración. `neon.ts` declara el bucket privado `assets`; `.neon` conserva la vinculación local y se excluye de Git.

Para preparar otro checkout, instalar la CLI oficial (`npm i -g neon@latest`), completar `neon login` y ejecutar desde la raíz:

```sh
neon link -y --org-id org-icy-haze-28862920 --project-id odd-base-60911651 --branch production --no-env-pull
neon config plan
neon deploy
```

`config plan` muestra los cambios antes de aplicarlos. `deploy` aplica `neon.ts` y descarga las variables en `.env.local` o `.env`, ambos ignorados por Git. Si los servicios ya están aprovisionados, basta con `neon env pull` para recuperar esas variables.

Las credenciales de PostgreSQL y del bucket permanecen en el backend. [`.env.example`](.env.example) documenta los nombres sin valores reales. El arranque comprueba servicios sin aplicar migraciones; las tablas de cuentas y catálogo se administran mediante las migraciones versionadas de sus historias.

Las reglas de cupos, préstamos, reservas y vencimientos pertenecen al backend. La integración con el frontend se realizará mediante un contrato de API explícito.

## Registro e inicio de sesión

SCRUM-7 y SCRUM-8 comparten `backend/src/accounts/`, sesión opaca en cookie HttpOnly y estado Angular en memoria. Registro inicia sesión inmediatamente; ambos flujos reemplazan únicamente la sesión previa del navegador dentro de la misma transacción. La [guía de integración](docs/integracion-hu02-hu03.md) describe los módulos, las correcciones y la verificación aislada.

## Catálogo público

SCRUM-13 implementa `/catalogo` con PrimeNG y `GET /api/books` con Express y
Prisma. El módulo `backend/src/book/` separa entidad, interfaz de repositorio,
acceso a datos, controlador y rutas. Se conserva la conexión compartida a Neon.
El [contrato del catálogo](docs/catalogo-api.md) detalla las tablas, la respuesta
pública y los límites con las otras historias.

La migración del catálogo está preparada en `backend/prisma/migrations/` y no
contiene libros iniciales. Revisarla antes de aplicarla a la rama de Neon
correspondiente. El arranque de la API no ejecuta migraciones ni carga datos.

## Documentación

- [Preparación y controles de la primera release](docs/release-sprint-1.md).
- [Vocabulario del dominio](CONTEXT.md).
- [Contexto de circulación: reglas y dependencias de préstamos, colas y reservas](docs/contexto-circulacion.md). Leer antes de desarrollar o revisar disponibilidad, turnos y vencimientos.
- [Avisos de vencimiento: procesamiento externo, configuración y reintentos (SCRUM-28)](docs/scrum-28-avisos.md).
- [Landing e integración de navegación](docs/landing-integracion.md).
- [Modelo de datos compartido en Confluence](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/6389762) y [copia local sincronizada](docs/modelo-de-datos.md).
- [Diagrama del modelo](docs/modelo-de-datos.mmd).
- [Contrato de autenticación y sesión](docs/contrato-autenticacion.md).
- [Desarrollo y verificación de SCRUM-8](docs/desarrollo-scrum-8.md).
- [ADR-0002: origen web común aceptado](docs/adr/0002-sesion-y-origen-web.md).
- [Registro de verificación de la puesta en marcha](docs/verificacion-inicial.md).
