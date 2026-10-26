# Desarrollo de SCRUM-8

22 de octubre de 2026. Registro histórico de la base de cuentas y login implementada a partir del modelo de Confluence v4 y del contrato de autenticación. Sus resultados y límites corresponden a esa fecha; para la entrega actual consultar [los controles de release](release-sprint-1.md).

## Alcance

- Migración de `universities`, `users` y `sessions`, sin tabla ni columna adicional de correo.
- Lista inicial de las treinta instituciones de SCRUM-7.
- `POST /api/auth/login`, `GET /api/auth/session` y `GET /api/universities`.
- Cookie HttpOnly con seis horas absolutas y comprobación de vencimiento/revocación en PostgreSQL.
- Servicio de autenticación Angular y diálogo de PrimeNG, sin navegar ni repetir una acción después de ingresar.
- Express sirve el build estático y el fallback SPA en producción; `/api` conserva sus errores JSON.

Registro y logout permanecen en SCRUM-7 y SCRUM-10; la protección de los recursos de circulación se integrará en SCRUM-9 cuando existan esos handlers. SCRUM-11 reutilizará la comprobación de vencimiento ya incluida. No se declaran completadas esas historias por haber implementado la base compartida.

## Entorno

La API, Prisma y los seeds usan la configuración habitual: primero `.env.local` de la raíz, luego `.env` de la raíz y finalmente `backend/.env`. Las variables ya definidas en el proceso tienen prioridad. Durante la puesta en marcha del MVP se usó la rama `production`; esa autorización histórica no define el entorno de las pruebas de release. La integración externa actual exige `TEST_DATABASE_URL` y un PostgreSQL local vacío, como describe [la guía vigente](integracion-hu02-hu03.md).

Desde la raíz:

```powershell
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
npm run dev --workspace backend
```

En otra terminal:

```powershell
npm run dev --workspace frontend
```

No se incluye un seed de cuentas: la validación de SCRUM-8 ya se realizó y la creación de cuentas corresponde al registro de SCRUM-7.

La verificación inicial se realizó en la rama temporal `dev-scrum8-login` (`br-summer-block-b496hux7`, con expiración el 29 de octubre de 2026). Esa rama no es un requisito del flujo actual.

## Verificación

Pruebas rápidas sin conexión a PostgreSQL:

```powershell
npm test
npm run build
```

Integración con PostgreSQL real en la base configurada en `.env.local`, después de migración y seed:

```powershell
npm run test:integration --workspace backend
```

La integración permite usar `production`. Crea una cuenta con UUID y correo aleatorios y elimina únicamente esa cuenta y sus sesiones al terminar. Verifica correo único, normalización, contraseña con Unicode y espacios, cookie, sesión de seis horas sin renovación, errores de credenciales sin crear sesiones, reemplazo/revocación del token anterior, vencimiento y listado de universidades.

Las pruebas Angular verifican que el login conserva el componente de la página, el filtro y la URL, que no repite solicitudes de circulación, que los errores mantienen el diálogo abierto y que cancelar descarta la contraseña. También verifican el descarte de respuestas viejas y la retirada de datos al vencer.

## Resultados de verificación

### Organización de las capas de cuentas

Se explicitaron los nombres `AccountsService`, `AccountsRepository` y `PrismaAccountsRepository`, con archivos `.service.ts`, `.repository.ts` y `.controller.ts`. El controller conserva las rutas y los middlewares de Express, prepara la respuesta pública y traduce los errores de aplicación a códigos HTTP. El service valida las credenciales y la sesión sin construir respuestas HTTP, y entrega al repository la duración compartida de seis horas. La implementación de Prisma conserva el reloj de PostgreSQL, las consultas y las transacciones.

Tras la reorganización pasaron las cinco pruebas de backend y su compilación. La prueba HTTP de login y consulta de sesión verifica el formato público, la normalización del correo, la cookie, la duración y el error de credenciales usando un repository en memoria, sin acceder a PostgreSQL.

### Separación del alcance de SCRUM-6

Se retiraron de la entrega de SCRUM-8 la landing, el encabezado, el footer y sus estilos. La raíz conserva únicamente el outlet de rutas, el modal compartido y la restauración inicial de sesión. El CSS global queda igual a la base común de PrimeNG en `main`; las dimensiones y ajustes del modal se configuran dentro de `auth/`. Se eliminó el selector `.brand` como destino alternativo del foco.

Las pruebas de flujo siguen montando `App`, con una pantalla exclusiva de pruebas provista por el router. Esa pantalla conserva el botón de apertura, la visualización de cuenta y el filtro; no se distribuye como ruta de la aplicación. Las ocho pruebas de Angular pasan, incluyendo la devolución de foco al botón tras cancelar y al host del login si el botón desaparece al autenticar. La integración que necesita SCRUM-6 se describe en el README de frontend. Hasta integrar su ruta, la raíz no muestra una landing.

La pantalla temporal de validación manual se retiró tras completar la revisión en navegador. En esa revisión se verificaron credenciales incorrectas, login válido, conservación de filtro y URL, ausencia de repetición automática de acciones, disposición a 390 × 844 píxeles y cierre con Escape. Se conservan el modal compartido y las pruebas automatizadas del flujo, sin rutas ni configuración de build exclusivas para validación manual.

### Revalidación de sesión al recuperar foco

Se reprodujo con una prueba el parpadeo reportado: recuperar foco borraba el `AuthResponse` y cambiaba el estado autenticado a `loading` mientras esperaba el GET. Se corrigió para revalidar en segundo plano, conservar la cuenta visible y evitar consultas simultáneas. Un 401 retira la cuenta; los errores temporales de red o servidor conservan el estado y el vencimiento original. Las ocho pruebas de Angular pasan, incluidas las regresiones de foco y de fallo temporal sin extensión de las seis horas.

### Revisión visual inicial con PrimeNG, anterior a la separación de SCRUM-6

La interfaz se adaptó al HTML compartido por Joaquín, según las [convenciones de UI](convenciones-ui.md). Se reemplazaron el diálogo nativo y los controles por Dialog, Button, InputText, InputPassword y Message de PrimeNG, con un tema compartido y las fuentes de la referencia distribuidas localmente.

Después de esta adaptación pasaron las seis pruebas de Angular, incluidas la conservación de página/filtro/URL, los errores de credenciales y la cancelación con limpieza de contraseña y validaciones. En navegador se revisaron el error de credenciales, el foco inicial, el ciclo con Tab, Escape con devolución del foco y el modal a 390 × 844 píxeles. Las capturas de escritorio y móvil fueron evidencia local y no forman parte de los archivos versionados.

El build de frontend con la licencia configurada compila y emite avisos de presupuesto: carga inicial de 704,89 kB (155,19 kB estimados de transferencia) frente a 500 kB de advertencia, y CSS del componente principal de 5,31 kB frente a 4 kB. No alcanza los límites de error. Se conserva Angular 22 y se usa PrimeNG 22 con la clave Community proporcionada por Joaquín. Se comprobó en navegador que desaparece el aviso de licencia y se actualizaron ambas capturas. La clave vence el 22 de octubre de 2027; no se obtuvo ni aceptó una licencia por cuenta del usuario.

### Base anterior a la revisión visual

Resultados de la verificación inicial: 6 pruebas de Angular, 4 de backend sin base y 1 de integración con PostgreSQL, todas aprobadas; compilación de ambos workspaces aprobada. Prisma no detectó diferencias entre el esquema aplicado a la rama de prueba y `schema.prisma`. En navegador se comprobaron credenciales incorrectas, login correcto, restauración al recargar, foco inicial, recorrido con Tab, Escape con devolución del foco y disposición a 390 × 844 píxeles. La captura anterior a PrimeNG fue evidencia local y no forma parte de los archivos versionados.

## Producción

Compilar desde la raíz con `npm run build`. En el servicio de Render configurar `NODE_ENV=production`, las credenciales del entorno de despliegue y arrancar con `npm run start --workspace backend`. El proceso sirve únicamente `frontend/dist/biblioteca/browser/` como directorio estático. No se ha publicado el servicio ni se han aplicado migraciones a producción.
