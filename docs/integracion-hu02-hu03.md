# Integración de registro y login

Actualizado el 23 de octubre de 2026. Registro (SCRUM-7 / HU-02) y login (SCRUM-8 / HU-03) están integrados en la rama de login a partir de `origin/develop` en `988f913`. Esta corrección se prepara sin commit; no aplica migraciones ni realiza escrituras en Neon. El documento anterior describía la preparación histórica de la rama de registro y queda conservado en Git.

## Recorrido del backend

1. `src/server.ts` conecta registro, login y catálogo al mismo cliente Prisma. `src/app.ts` monta una sola vez el controlador de cuentas y mantiene las rutas API antes del fallback de Angular.
2. `src/accounts/accounts.controller.ts` reúne `/api/auth/register`, `/api/auth/login`, `/api/auth/session` y `/api/universities`. Cookie, `Cache-Control: no-store`, marcador `X-Biblioteca-Request: 1`, parser JSON y traducción de errores son comunes. No existe otra implementación productiva en `src/modules/accounts/`.
3. `registration.service.ts` valida el alta y calcula el hash; `accounts.service.ts` verifica las credenciales. `credentials.ts` comparte normalización de correo, validación y Argon2id; `sessions.ts` comparte token opaco, hash SHA-256 y duración absoluta de seis horas. La contraseña se conserva exactamente, con límite de 1024 bytes UTF-8. Los correos con espacios internos se rechazan antes de llegar al CHECK de la base.
4. `registration.repository.ts` crea usuario y sesión en una transacción. `prisma-accounts.repository.ts` abre la transacción del login. Ambos llaman a `prisma-session.ts` dentro de esa transacción para obtener la hora de PostgreSQL, revocar la cookie previa reconocida y crear la nueva sesión. Un fallo revierte también la revocación y, en registro, el usuario. Las sesiones de otros dispositivos se conservan.
5. `auth.response.ts` proyecta explícitamente el mismo DTO público para los dos éxitos y la consulta de sesión. No incluye contraseñas, hashes ni tokens. `account-error.ts` define códigos y mensajes públicos; errores de conectividad se distinguen de fallos internos.
6. El controlador emite `biblioteca_session` después de completar la transacción: HttpOnly, SameSite=Lax, Path=/, Secure en producción y Expires derivado del vencimiento absoluto de PostgreSQL. No renueva la cookie al consultar sesión. No usa el reloj local de Node para decidir si la transacción tuvo éxito.
7. El listado único de universidades usa las treinta instituciones con UUID estables y orden español, con desempate por ID. No introduce otras tablas ni una nueva migración.

## Recorrido del frontend

1. `auth/auth.types.ts` define los tipos compartidos. `registration.types.ts` solo los reexporta para los consumidores existentes.
2. `auth/auth.validation.ts` usa la misma biblioteca y regla de correo que el backend. Registro y login conservan dominios internacionales; `inputmode="email"` mantiene el teclado apropiado sin transformar el correo. La normalización se aplica antes del POST, nunca a la contraseña.
3. `auth/auth.service.ts` envía ambas escrituras y acepta el DTO antes de notificar el éxito a la pantalla. El servicio de transporte independiente de registro se eliminó. El token queda exclusivamente en la cookie HttpOnly.
4. El bloqueo `authenticating` impide login y registro simultáneos en la misma aplicación y suspende la revalidación por foco. La generación de autenticación descarta GET antiguos, incluidos un 401 o la identidad anterior. El vencimiento de la sesión anterior no descarta el éxito de una autenticación pendiente. Cancelar o fallar libera el bloqueo; el fallo inicial permite reintentar la sesión.
5. `features/auth/register/register-page.ts` llama a ese servicio y navega al terminar. `App` mantiene un único diálogo de login y la restauración de sesión; la conexión de esos accesos y la identidad con la cabecera de SCRUM-6 queda para una PR de seguimiento. El servicio de login conserva la ruta y el catálogo abierto. Tras integrar SCRUM-6, la raíz muestra la landing; el registro exitoso vuelve a esa página.

## Verificación local

Desde la raíz:

```sh
npm test
npm run build
npm run test:e2e --workspace frontend
```

Resultado de esta corrección: 100 pruebas de backend y 95 de Angular aprobadas; 12 pruebas de Playwright aprobadas en los tres tamaños; build de ambos workspaces correcto. El índice del merge queda sin conflictos y HEAD no cambia: no se creó ningún commit.

La suite habitual del backend ejecuta `accounts-flow.test.ts` con PostgreSQL embebido PGlite, Prisma y el adaptador `pg`. Comparte los doce escenarios de `accounts-scenarios.ts` con la integración PostgreSQL externa: alta → consulta de sesión → login, DTO/cookies, reemplazo de sesión, otros dispositivos, errores, duplicados concurrentes, facultad inexistente, rollback provocado, vencimiento/revocación, correo internacional, contraseña exacta y protección HTTP común. Las pruebas unitarias restantes cubren validación, persistencia y transporte.

Angular verifica restauraciones fuera de orden, exclusión de escrituras, fallos sin perder la sesión anterior, recuperación y navegación. Playwright usa el navegador real en escritorio, tablet y móvil con respuestas HTTP simuladas; verifica registro, login, recarga, cookie HttpOnly, accesibilidad de controles y ausencia de desbordamiento horizontal. Estas pruebas de navegador no sustituyen una prueba de despliegue completo contra PostgreSQL externo.

## PostgreSQL externo aislado

`npm run test:integration --workspace backend` selecciona únicamente `test/integration/accounts.integration.test.ts`. No importa dotenv ni usa `DATABASE_URL` o `DATABASE_URL_UNPOOLED`. La fixture exige autorización explícita, host y puerto locales, usuario/base exclusivos y una base nueva sin objetos antes de ejecutar SQL. Carga la migración de cuentas y las treinta universidades versionadas; las limpiezas se limitan a ese destino.

Preparar un PostgreSQL local de prueba vacío en `127.0.0.1:55432`, base `ics_accounts_test`, usuario `accounts_test_admin` y una contraseña exclusiva de prueba. En PowerShell, dentro de esa terminal:

```powershell
$env:ACCOUNTS_ALLOW_INTEGRATION_WRITES = '1'
$env:TEST_DATABASE_URL = 'postgresql://accounts_test_admin:clave-local-de-prueba@127.0.0.1:55432/ics_accounts_test'
npm run test:integration --workspace backend
Remove-Item Env:ACCOUNTS_ALLOW_INTEGRATION_WRITES
Remove-Item Env:TEST_DATABASE_URL
```

Después de ejecutarla, descartar esa base de prueba antes de repetir: la fixture rechaza reutilizar una base con tablas existentes. Esta ejecución externa no se completó durante la corrección porque el motor de Docker local no estaba disponible. La suite equivalente con PGlite sí se ejecuta mediante `npm test`.

## Límites

Logout y protección de futuras operaciones personales permanecen en sus historias. La landing y la navegación compartida se incorporan en SCRUM-6; sus accesos de cuenta, la identidad y el acceso a préstamos quedan para otra PR. El bloqueo del cliente coordina una sola instancia de Angular; varias pestañas comparten cookie y se actualizan al revalidar, sin promesa de sincronización instantánea. El build conserva un aviso por exceder el presupuesto inicial de 500 kB; la compilación termina correctamente. No se publicaron comentarios ni cambios en GitHub.
