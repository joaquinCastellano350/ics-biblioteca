# Primera release — preparación y controles

Fecha: 26 de octubre de 2026. Versión candidata: `0.1.0`.
Base de preparación: `develop`, commit `8a3734fe2ef1975e2c24932aa028ec0fff250d73`.

Esta etapa prepara los controles y la documentación. La publicación y el merge
de `develop` a `main` se realizan después de validar datos, secretos y servicio
productivo. El tag `v0.1.0` debe identificar el commit que se publique, no este
commit de preparación.

## Alcance del sprint

- Landing, navegación y catálogo público.
- Búsqueda por título y filtros de autor y materia.
- Registro con universidades, inicio y cierre de sesión.
- Restauración y vencimiento absoluto de sesión de seis horas.
- Pantalla de Mis préstamos condicionada a la sesión, todavía en preparación.

Listado y operaciones de préstamos, colas, reservas, avisos y lectura de PDFs
permanecen fuera de esta entrega. Las referencias de apariencia y los documentos
históricos no amplían este alcance.

## Control obligatorio de GitHub

`.github/workflows/release-checks.yml` ejecuta el job **Release checks** para
todos los PR con destino `develop` o `main`, para los pushes a ambas ramas y
manualmente. No usa filtros por archivos: un cambio de documentación también
debe recibir el control requerido. Una ejecución nueva cancela la anterior del
mismo PR o rama.

El control usa Node.js 24.20.0 y npm 12.0.2 y ejecuta, en orden:

1. Instalación limpia desde el lockfile, incluidas dependencias de desarrollo.
2. Validación de `schema.prisma`.
3. Pruebas de Angular y del backend; sus pruebas de persistencia usan PGlite.
4. Integración de cuentas con un servicio PostgreSQL 17 vacío y efímero del job.
5. Compilación de producción de Angular y Express, incluido el cliente Prisma.
6. Pruebas Playwright con Chromium en escritorio, tablet y celular.

La integración externa exige el destino exclusivo `127.0.0.1:55432`, base
`ics_accounts_test`, usuario `accounts_test_admin` y autorización de escrituras
solo en ese paso. La contraseña declarada en el workflow es exclusiva del
servicio temporal. No se configuran secretos ni conexiones de Neon en CI.
Las pruebas de navegador interceptan la API; no comprueban un despliegue real.
En CI no se permite dejar pruebas Playwright con `.only`. Los fallos de
navegador conservan sus trazas durante siete días como artefactos del job.

La protección de `main` debe exigir PR y **Release checks** aprobado sobre una
rama actualizada, bloquear force pushes y borrado, y aplicar también a admins.
No se exige una aprobación humana adicional en esta configuración inicial.
El workflow versionado y la protección de la rama son configuraciones distintas:
comprobar ambas antes de integrar la release.

## Reproducir localmente

Desde una copia limpia, con las versiones de Node y npm indicadas:

```sh
npm ci --include=dev --no-audit --no-fund
npm run db:validate --workspace backend
npm test
npm run build
npm exec --workspace frontend -- playwright install chromium
```

En PowerShell, para las pruebas de navegador:

```powershell
$env:CI = 'true'
$env:PLAYWRIGHT_CHANNEL = 'chromium'
npm run test:e2e --workspace frontend
Remove-Item Env:CI
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

Si Chromium no puede iniciarse en Windows, usar `PLAYWRIGHT_CHANNEL=chrome`
con Chrome instalado. GitHub usa Chromium sobre Ubuntu y verifica ese entorno
por separado.

Playwright inicia su propio Angular en `127.0.0.1:4200`. Dejar libre ese puerto;
CI no reutiliza un servidor abierto. El arranque tiene un límite de dos minutos.
La integración externa requiere además un PostgreSQL local nuevo y vacío:
seguir [la preparación específica](integracion-hu02-hu03.md#postgresql-externo-aislado).

## Evidencia de esta preparación

Verificación en una copia aislada, sin archivos `.env` ni credenciales de Neon,
con Node.js 24.20.0 y npm 12.0.2:

| Control | Resultado local |
| --- | --- |
| Instalación limpia desde el lockfile versionado | Aprobada |
| Esquema Prisma | Válido |
| Angular | 173 pruebas aprobadas |
| Backend, incluido PostgreSQL embebido | 119 pruebas aprobadas, sin omisiones |
| Compilación de producción de ambos workspaces | Aprobada |
| Navegador con Chrome, escritorio/tablet/celular | 24 pruebas aprobadas, sin omisiones |
| PostgreSQL externo | Se verifica en CI; Docker local no está en marcha |
| Enlaces a archivos de documentación | Sin destinos locales faltantes |

La compilación conserva los presupuestos existentes: aviso por bundle inicial
de 740,39 kB frente al objetivo de 500 kB y por CSS del catálogo de 7,71 kB frente
al objetivo de 4 kB. Ambos están por debajo de los límites que hacen fallar el
build (1 MB y 8 kB); no se ampliaron esos límites.

El primer intento local con Chromium falló antes de abrir el navegador con
`spawn UNKNOWN`; se utiliza Chrome instalado para verificar la interfaz local.
Los resultados de las guías históricas no cuentan como verificación de esta release.

## Continuación antes del primer deploy

1. Separar e identificar datos y credenciales de desarrollo y producción.
2. Confirmar historial de migraciones, universidades y catálogo inicial.
3. Configurar el servicio de Render según el ADR de origen común.
4. Verificar registro, login, recarga, logout, vencimiento, catálogo y filtros
   con API y base reales de prueba; comprobar también HTTPS y rutas directas.
5. Integrar `develop` a `main` con el control aprobado, publicar el commit
   validado y registrar URL, tag y procedimiento de recuperación.

La preparación de los controles no certifica el acceso real a Neon, el storage,
las cookies HTTPS ni las 45 comprobaciones manuales del plan de integración.
