# HU-02 — Registro e integración futura con HU-03

Fecha de preparación inicial: 2026-10-22. Última revisión: 2026-10-23 (hora local).

## 1. Alcance y estado real

Este documento acompaña el futuro Pull Request de HU-02. Distingue implementación local, verificaciones históricas y propuestas pendientes.

**HU-02 se implementó originalmente sin merge con HU-03. Actualmente está en curso un merge LOCAL y sin commit de origin/develop en feature/hu-02-registro.** Se conserva el registro propio y se incorpora el catálogo SCRUM-13. No se integró la rama HU-03 ni se implementó login; los modelos de cuentas compartidos llegan porque ya están versionados en develop.

**El registro está implementado y sus siete casos de integración real fueron aprobados en PostgreSQL 17.11 aislado, sin acceder a Neon.** El formulario dejó de ser una vista previa y puede enviar solicitudes reales. La persistencia, rollback y concurrencia se verificaron en un contenedor temporal; este y sus datos tmpfs fueron eliminados después de las pruebas. Esto no equivale a probar ni autorizar escrituras sobre la base compartida.

**HU-04 y HU-06 permanecen fuera del alcance.** No se implementarán ni modificarán como parte de este trabajo. Tampoco se incorporaron login manual, logout, restauración de sesión ni protección de otras funciones.

| Referencia | Estado revisado |
| --- | --- |
| Rama local | `feature/hu-02-registro` |
| Commit inicial HU-02 | `195f5f52a82059550e362db55565c72f5a2571ec` |
| Mensaje inicial | `feat(hu-02): agregar formulario y carga de facultades` |
| Alcance del commit inicial | 19 archivos: 12 nuevos y 7 modificados |
| Último commit confirmado (HEAD durante este merge) | `66a205d219436965d1504019f044d123d4ef5fd4` |
| Mensaje del último commit | `style(hu-02): adaptar registro al diseño de Biblioteca Digital` |
| Base anterior | `260f2edc74e8652a6f7845aca797ece177225f0a` |
| PR de HU-03 analizado anteriormente | [PR #1](https://github.com/joaquinCastellano350/ics-biblioteca/pull/1) |
| Commit fijado del PR | `ff2b0310b3d991ff5f6e696b942d711ba1e3562f` |
| Rama HU-03 incorporada | No; develop ya aporta los modelos/migraciones compartidos |
| Registro posterior al commit documental | Confirmado en `4d4cdca`; rediseño confirmado en `66a205d` |
| Estado antes de la etapa 7 | 8 archivos modificados y 13 sin seguimiento |
| Estado al actualizar este documento | Merge sin commit: cambios de develop y seis conflictos conciliados; revisión pendiente del usuario |
| Base de integración | `origin/develop` en `fbc7d8b3b87c62fca924ecedf7d20a0de9094a9a` |

Se ejecutó git fetch origin con autorización antes de esta integración; origin/develop quedó en fbc7d8b. No se consultó el estado actual del PR de HU-03 ni se incorporó su rama. HEAD no avanza hasta que el usuario autorice confirmar el merge.

## 2. Requisitos y cobertura funcional

Fuente: `Documentacionproyecto/HISTORIASDEUSUARIO.MD`, documento externo al repositorio.

Actor: visitante.

Descripción: «Como visitante, quiero crear una cuenta, para acceder a las funciones personales de la biblioteca».

| Criterio documentado de HU-02 | Implementación y límite de verificación |
| --- | --- |
| Solicitar nombre, apellido, facultad, correo y contraseña | Cinco campos reactivos, cinco propiedades explícitas en el POST y validación backend |
| Elegir facultad de la lista cerrada documentada | GET público, UUID real, validación de pertenencia en Angular y existencia dentro de la transacción; las 30 facultades se verificaron históricamente por lectura |
| Aceptar correo válido de cualquier dominio, sin acreditar estudiante ni confirmar correo | Sin restricción institucional ni confirmación; correo normalizado en backend |
| Señalar datos faltantes o inválidos y rechazar correo registrado | Validaciones locales y backend, errores por campo, HTTP 400/409; duplicado y concurrencia verificados en PostgreSQL aislado |
| Iniciar sesión y mostrar la landing al completar el registro | Creación transaccional y cookie verificadas con PostgreSQL real aislado; navegación a `/` comprobada con HTTP simulado. Tras compatibilizar con develop, `/` redirige a `/catalogo`; se conserva ese comportamiento como destino posterior al registro, sin implementar otra landing |
| No aplicar complejidad de contraseña | Se acepta contraseña no vacía, sin confirmación ni composición obligatoria; límite técnico autorizado de 1024 bytes UTF-8 en backend |

RF-01 corresponde al registro. RF-02 describe el acceso a la cuenta para funciones personales: aquí solo se prepara la sesión automática posterior al registro, sin implementar el inicio de sesión manual.

La contraseña permanece transitoriamente en memoria del formulario y de la solicitud para procesarla y conservar los valores ante un error. No se persiste en texto plano, Storage, cookies JavaScript ni logs. En producción el transporte deberá usar HTTPS.

## 3. Inventario de archivos

Responsabilidad funcional de los archivos siguientes: HU-02. No se asignan nombres personales ni mantenimiento exclusivo que no haya sido acordado.

### 3.1 Archivos creados en el commit inicial

| Ruta | Función actual |
| --- | --- |
| `backend/src/modules/accounts/universities.repository.ts` | Consulta fija de id y name con cliente Prisma existente y orden SQL alfabético |
| `backend/test/universities.test.ts` | Contrato 200, vacío y 503 con servicios simulados; actualizado para inyectar registro |
| `frontend/src/app/features/auth/register/register.ts` | Formulario reactivo, validaciones, evento y entradas de carga, errores y bloqueo |
| `frontend/src/app/features/auth/register/register.html` | Campos, mensajes, accesibilidad y estado de envío |
| `frontend/src/app/features/auth/register/register.css` | Diseño adaptable del formulario |
| `frontend/src/app/features/auth/register/register.spec.ts` | Validación y bloqueo de emisión, incluso ante envío forzado |
| `frontend/src/app/features/auth/register/register-page.ts` | Facultades, POST de registro, estados, errores y navegación |
| `frontend/src/app/features/auth/register/register-page.html` | Conexión de entradas y evento del formulario, enlace al inicio y reintento de facultades |
| `frontend/src/app/features/auth/register/register-page.css` | Presentación de la página; conserva reglas de la antigua vista previa sin uso actual |
| `frontend/src/app/features/auth/register/register-page.spec.ts` | Carga, reintento, registro y errores con HTTP interceptado |
| `frontend/src/app/features/auth/register/universities.service.ts` | GET relativo de facultades |
| `frontend/src/app/features/auth/register/universities.service.spec.ts` | Pruebas del servicio de facultades |

### 3.2 Archivos existentes modificados en el commit inicial

| Ruta | Función y cambios posteriores |
| --- | --- |
| `backend/src/app.ts` | Salud y facultades; ahora también router de registro con servicio inyectado |
| `backend/src/server.ts` | Composición productiva de dependencias; ahora conecta servicio de registro y repositorio al cliente compartido |
| `backend/test/app.test.ts` | Prueba de salud/disponibilidad con dependencias simuladas; incorpora stub de registro |
| `frontend/src/app/app.routes.ts` | Ruta pública diferida `/registro`, conservada |
| `frontend/src/app/app.ts` | Bienvenida solo en ruta inicial y navegación, conservadas |
| `frontend/src/app/app.html` | Bienvenida, outlet y enlace Crear cuenta, conservados |
| `frontend/src/app/app.spec.ts` | Navegación; expectativas actualizadas y POST simulado con retorno al inicio |

### 3.3 Quince archivos nuevos posteriores al commit documental

| Ruta | Función, dependencias e impacto |
| --- | --- |
| `backend/src/modules/accounts/registration.validation.ts` | Validación de tipos, campos, correo, UUID y límite UTF-8; usa validator, sin Express ni base |
| `backend/src/modules/accounts/registration.security.ts` | Argon2id y criptografía de tokens; independiente de persistencia |
| `backend/src/modules/accounts/registration.service.ts` | Orquesta validación, hash y una operación atómica inyectada; separa JSON y cookie |
| `backend/src/modules/accounts/registration.repository.ts` | Implementa createUserAndSession con Prisma inyectado, SQL parametrizado y una transacción |
| `backend/src/modules/accounts/registration.controller.ts` | Adaptador Express, parser local, controles HTTP y cookie |
| `backend/test/registration.validation.test.ts` | Datos válidos, inválidos y límites |
| `backend/test/registration.security.test.ts` | Hash, verificación y tokens locales |
| `backend/test/registration.service.test.ts` | Orquestación con repositorio simulado |
| `backend/test/registration.repository.test.ts` | Interacciones transaccionales y SQL con cliente simulado; no verifica rollback real |
| `backend/test/registration.test.ts` | HTTP local con servicio simulado, cookies, errores y límites |
| `backend/test/integration/postgres-fixture.ts` | Destino local estricto, cliente independiente, preparación del SQL original en base vacía y fallo inducido; no usa conexiones de desarrollo |
| `backend/test/integration/registration.integration.test.ts` | Siete casos reales de persistencia, seguridad, errores, rollback, concurrencia y cookie; ejecución manual separada de la suite unitaria |
| `frontend/src/app/features/auth/register/registration.types.ts` | Respuesta pública y errores; reutiliza tipos del formulario |
| `frontend/src/app/features/auth/register/registration.service.ts` | POST relativo con cinco campos explícitos y encabezado requerido |
| `frontend/src/app/features/auth/register/registration.service.spec.ts` | HTTP interceptado, contrato, errores y ausencia de escritura en Storage/cookies |

### 3.4 Archivos modificados desde el último commit

Los ocho archivos de código/pruebas modificados son:

- `backend/src/app.ts`
- `backend/src/server.ts`
- `backend/test/app.test.ts`
- `backend/test/universities.test.ts`
- `frontend/src/app/features/auth/register/register-page.ts`
- `frontend/src/app/features/auth/register/register-page.html`
- `frontend/src/app/features/auth/register/register-page.spec.ts`
- `frontend/src/app/app.spec.ts`

La etapa 7 modifica además únicamente `docs/integracion-hu02-hu03.md`. No se eliminaron ni reemplazaron archivos por versiones de HU-03. No se modificaron modelos Prisma, migraciones, dependencias ni configuración.

## 4. Flujo implementado y decisiones técnicas

1. Register valida obligatorios, correo y facultad recibida. Emite registerRequested; no realiza HTTP.
2. RegisterPage conserva la carga de facultades, errores, vacío y reintento. Impide registrar mientras faltan facultades o hay un envío pendiente.
3. RegistrationService Angular envía exactamente los cinco campos mediante ruta relativa y encabezado propio. El navegador gestiona la cookie HttpOnly bajo el mismo origen; JavaScript no guarda el token.
4. Express exige el encabezado y application/json, limita el cuerpo a 16 KiB y delega al servicio existente.
5. El servicio valida y normaliza; calcula Argon2id fuera de la transacción y genera token de 32 bytes. Invoca createUserAndSession una sola vez.
6. El repositorio ejecuta database.$transaction. Comprueba universidad con FOR KEY SHARE, obtiene clock_timestamp con precisión de milisegundos e inserta usuario y sesión con UUID explícitos y el mismo instante de referencia.
7. La sesión guarda solo SHA-256 del token y vence exactamente seis horas después de created_at. Cualquier rechazo dentro del callback se entrega a Prisma para resolver la transacción.
8. El resultado del repositorio contiene solo usuario público y fechas. El servicio excluye propiedades adicionales, genera fechas ISO UTC y separa publicResponse de los datos privados para la cookie.
9. El controlador espera el resultado del servicio, emite la cookie y responde 201. No imprime cuerpo, contraseña, hash ni token.
10. Angular conserva el formulario en un fallo, muestra errores y permite reintento manual. Solo tras éxito navega a `/`. Las suscripciones se cancelan al destruir la página; no hay reintento automático del POST.

La prevención de duplicados es local a esa instancia de página. No implica idempotencia entre pestañas, clientes o reintentos después de perder una respuesta: la garantía de unicidad corresponde a PostgreSQL.

## 5. Contratos HTTP

### GET /api/universities

Endpoint público conservado, sin duplicarlo ni sustituirlo por el del PR. HTTP 200 con `{ universities: [{ id, name }] }`, incluso vacío. HTTP 503 con código SERVICE_UNAVAILABLE si falla la consulta. Orden por name ASC e id ASC.

### POST /api/auth/register

Requiere `Content-Type: application/json` y `X-Biblioteca-Request: 1`. Límite de cuerpo: 16384 bytes. Acepta JSON con charset UTF-8; no acepta formularios URL-encoded ni multipart.

Solicitud:

```typescript
type RegistrationRequest = {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  password: string;
};
```

HTTP 201:

```typescript
type RegistrationResponse = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    university: { id: string; name: string };
  };
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
};
```

Error: `{ error: { code, message, fields? } }`. fields contiene mensajes por nombre de campo cuando corresponde. No incluye stack, causa, SQL ni datos de conexión.

| HTTP | Código o causa | Presentación Angular |
| --- | --- | --- |
| 400 | VALIDATION_ERROR o UNIVERSITY_NOT_FOUND; incluye JSON mal formado | Mensaje general y campos conocidos con mensajes de texto |
| 403 | FORBIDDEN: encabezado ausente/incorrecto | Mensaje general |
| 409 | EMAIL_ALREADY_REGISTERED | Correo ocupado, también junto al campo |
| 413 | PAYLOAD_TOO_LARGE | Mensaje general |
| 415 | UNSUPPORTED_MEDIA_TYPE: contenido/codificación incompatible | Mensaje general |
| 500 | INTERNAL_ERROR | Mensaje general sin detalles internos |
| 503 | SERVICE_UNAVAILABLE | Mensaje general con posibilidad de reintento manual |
| Sin respuesta HTTP | Error de conexión, status 0 en Angular | Mensaje de conexión |

Los errores no emiten cookie. Las validaciones del backend se reutilizan, no se duplican en el controlador.

### Contraseña, cookie y sesión

- Nombre/apellido: se recortan espacios exteriores. UUID: se valida y normaliza a minúsculas.
- Correo: trim y minúsculas, cualquier dominio válido. No se consulta previamente para garantizar unicidad.
- Contraseña: no vacía, máximo 1024 bytes UTF-8; se conserva exactamente, incluidos espacios. El límite se valida en backend y sus errores se muestran en Angular.
- Argon2id: memoryCost 19456 KiB, timeCost 2, parallelism 1, salt generado por la biblioteca.
- Token: 32 bytes criptográficos, base64url. En sessions solo se almacena SHA-256 hexadecimal de 64 caracteres.
- Cookie: biblioteca_session, HttpOnly, SameSite=Lax, Path=/, Secure cuando NODE_ENV es production. Tras la corrección de la etapa 8 se utiliza Expires absoluto, redondeado hacia abajo a segundos, sin Max-Age para que Express no recalcule el vencimiento. Se comprueba el tiempo restante al responder; si venció o la fecha no es válida, HTTP 503 sin cookie. La duración PostgreSQL permanece en seis horas.
- No hay token, contraseña ni hashes en el JSON público. No se crean cookies desde JavaScript.
- No se mantiene un AuthService global ni se restaura sesión al recargar en esta etapa.
- El controlador local no agrega Cache-Control: no-store; la propuesta anterior lo describía como comportamiento del PR. No se debe atribuir esa cabecera al código actual.

## 6. Prisma, esquema existente y relación con HU-03

Antes del merge, schema.prisma no contenía modelos de dominio. Ahora se conserva íntegramente el esquema de develop, con University, User, Session y los modelos de catálogo. El repositorio de registro mantiene SQL parametrizado mediante el mismo cliente Prisma que utiliza BookRepository; no se duplican modelos, pools ni migraciones.

La validación aislada histórica leyó el SQL del objeto Git fijado de HU-03. Ahora develop ya aporta el mismo archivo versionado y la fixture lo lee directamente, sin depender de objetos Git históricos:

`backend/prisma/migrations/20261022170000_accounts_and_sessions/migration.sql`

Sus columnas y restricciones concuerdan con las usadas por el repositorio: users(university_id, email, password_hash, created_at), sessions(user_id, token_hash, created_at, expires_at), UUID, precisión TIMESTAMPTZ(3), FK y duración de seis horas. El índice único de correo se llama users_email_key. La migración usa token_hash CHAR(64) y revoked_at opcional.

Esto es comparación estática contra una referencia histórica, no una nueva inspección de Neon. Traducir correo duplicado requiere SQLSTATE 23505 y esa restricción; otras violaciones únicas no se confunden con correo ocupado. Fallos conocidos de conexión se traducen a dependencia no disponible; los restantes quedan como internos.

La documentación interna `docs/modelo-de-datos.md` todavía menciona faculty_id/email_normalized. Difiere del contrato universityId y de las columnas university_id/email de la migración revisada. Se registra la inconsistencia sin modificar ese documento ni la estructura existente.

### Qué permanece únicamente en HU-03

AccountsService, PrismaAccountsRepository, login manual, consulta/restauración de sesión, AuthService y diálogo Angular del PR no se incorporaron en esta integración. Los modelos University/User/Session y la migración original ya forman parte de develop y se preservaron junto al catálogo. Se mantiene una sola ruta de facultades local; no se copió la implementación del PR ni su seed.

### Coordinación futura con HU-03 (distinta del merge local de develop)

1. Acordar el commit base, responsabilidades de cuentas, contrato de cookie y destino definitivo. Ningún integrante tiene mantenimiento exclusivo asignado por este documento.
2. Comparar funciones de seguridad y errores antes de consolidar RegistrationService con AccountsService. Conservar una sola operación transaccional, sin crear sesión mediante otra escritura posterior.
3. Conservar los modelos y migraciones originales ya recibidos de develop; no reconstruir historial ni ejecutar migraciones/seed sobre la base compartida.
4. Consolidar una sola ruta GET /api/universities y conservar la envoltura pública, UUID y casos vacío/503. Hoy sigue vigente el repositorio local; no está autorizada su eliminación.
5. Cualquier integración posterior de login debe conservar la composición Express conciliada, /catalogo, /registro y sus pruebas. No restaurar la antigua bienvenida de Angular ni eliminar la cobertura de App.
6. Si se adopta el estado Angular compartido, reutilizar una única lógica de autenticación; no efectuar un login adicional tras el registro.
7. Verificar con simulaciones y una base aislada antes de una integración real autorizada. No hay merge, rama base nueva ni publicación autorizados por este documento.

El antiguo plan de incorporar primero todos los grupos de HU-03 queda sin ejecutar y sustituido por esta coordinación futura.

## 7. Revisión funcional y límites pendientes

| Punto revisado | Resultado |
| --- | --- |
| Cinco campos y UUID recibido | Formulario → evento → POST explícito → validación → persistencia parametrizada |
| Contraseña y secretos | Hash antes de persistencia, token separado del JSON y sin logs/Storage en el flujo inspeccionado |
| Transacción | Una llamada con comprobación e inserciones dentro del callback; persistencia, rollback y concurrencia comprobados también en PostgreSQL real aislado |
| Errores HTTP | Mapeos 400/403/409/413/415/500/503 implementados y cubiertos |
| Solicitudes duplicadas | Guardas en formulario y página, bloqueo durante envío y después del éxito |
| Navegación | Solo en next de una respuesta exitosa; retorno a / verificado con respuesta simulada |
| Funcionalidades ajenas | No se añadieron login, logout, recuperación/restauración ni protección de otras funciones |

Observaciones históricas, resolución aplicada y límites vigentes:

1. **Desfase de cookie corregido en la etapa 8:** el controlador usa el vencimiento absoluto del servicio, sin Max-Age, y rechaza fechas vencidas o inválidas. Se agregaron seis pruebas locales; el vencimiento de la cookie también se contrastó con la sesión persistida en PostgreSQL real.
2. **Persistencia real verificada en entorno aislado:** hubo HTTP 201, un usuario y una sesión vinculados, Argon2id verificable y solo SHA-256 del token almacenado. Se comprobó 409 real por duplicado. Los permisos, conectividad y diferencias operativas del usuario de Neon no se verificaron y no quedan autorizados por estos resultados.
3. **Atomicidad y concurrencia verificadas en base aislada:** un trigger de prueba provocó un fallo real en la creación de sesión después de insertarse el usuario; otra conexión comprobó ausencia de ambas filas. Dos registros simultáneos con el mismo correo normalizado produjeron un 201 y un 409, una cuenta y una sesión. La comprobación del trigger utilizó una secuencia para demostrar que se alcanzó esa inserción; los objetos de fallo se retiraron durante el caso.
4. **Sesión automática no verificada en navegador real:** falta comprobar cookie recibida/almacenada y vínculo con la sesión persistida en un entorno aislado. No hay endpoint local para recuperar sesión ni una vista global autenticada; eso fue excluido expresamente.
5. **Destino posterior conciliado:** / redirige a /catalogo, preservando el inicio de develop. RegisterPage sigue navegando a / después del éxito; no requirió cambios. Esto no incorpora una landing adicional ni estado global de autenticación.
6. **Respuesta perdida o cancelación:** destruir la página cancela la suscripción, pero no garantiza deshacer una transacción ya confirmada en el servidor. Un reintento podría devolver 409; no se implementó idempotencia.
7. **Navegación fallida:** RegisterPage inicia Router.navigate y marca registered; no gestiona explícitamente un rechazo o cancelación de esa navegación. La ruta actual se comprobó con pruebas; el escenario de fallo de navegación no está cubierto.
8. **Riesgos de integración:** no sustituir funciones por nombres similares sin comparar parámetros, respuestas, clasificación de errores y comportamiento transaccional. La coincidencia histórica de la base no habilita modificarla.
9. **Advertencias históricas y actuales:** el rediseño retiró las reglas CSS de vista previa. El presupuesto inicial anteriormente superado quedó en 493,06 kB tras la conciliación, sin advertencia de presupuesto en esta compilación. El aviso PrimeUI pertenece a una ejecución anterior. Se conservan comentarios históricos que no afectan esta compatibilidad.

Los siete escenarios preparados quedaron validados contra PostgreSQL real aislado. Siguen pendientes la revisión en navegador real y la landing definitiva; no se declara validación sobre Neon ni integración con HU-03.

## 8. Verificaciones históricas y comandos

La etapa 7 original fue de lectura y documentación. Posteriormente se corrigió la cookie, se ejecutaron siete casos PostgreSQL aislados y se eliminó el contenedor. En este cierre solo se repitieron las suites generales y compilaciones; no se repitió la integración real.

| Etapa verificada previamente | Resultado |
| --- | --- |
| Formulario inicial | 15 pruebas, compilación Angular exitosa |
| Integración visual inicial | 26 pruebas, compilación Angular exitosa |
| Facultades antes del registro | Backend 4 y frontend 35; compilaciones exitosas |
| Validación y seguridad backend | 21 pruebas |
| Servicio backend, acumulado | 37 pruebas |
| Repositorio con cliente simulado, acumulado | 50 pruebas |
| Endpoint y suite backend completa | 73 aprobadas, 0 fallidas |
| Compilación TypeScript backend posterior al endpoint | Exitosa |
| Conexión Angular, primera verificación | 51 aprobadas, 2 fallidas: expectativas antiguas de App |
| Corrección autorizada solo de App | 53 frontend aprobadas, 0 fallidas |
| Compilación Angular de producción posterior a la conexión | Exitosa; 509,15 kB iniciales, excedente de 9,15 kB sobre 500 kB |
| GET facultades real, verificación anterior autorizada | HTTP 200, 30 UUID/nombres, sin duplicados; proxy Angular también verificado |
| Etapa 8: suite backend y compilaciones | 79 backend y 53 frontend aprobadas; compilaciones exitosas |
| Integración PostgreSQL 17.11 aislada | 7 aprobadas, 0 fallidas, 0 canceladas y 0 omitidas |
| Cierre: suite backend existente | 79 aprobadas, 0 fallidas; no incluye la carpeta de integración |
| Cierre: suite frontend existente | 53 aprobadas, 0 fallidas, en cinco archivos |
| Cierre: build backend | Exitoso; prisma generate 7.10.1 y tsc, sin migraciones ni conexión a Neon |
| Cierre: build Angular producción | Exitoso; 509,15 kB iniciales, advertencia de excedente de 9,15 kB |

Comandos históricos relevantes (las verificaciones actuales mediante npm se detallan después):

```powershell
# Desde la raíz, backend; pruebas con simulaciones y criptografía local
node --import tsx --test backend/test/registration.validation.test.ts backend/test/registration.security.test.ts
node --import tsx --test backend/test/registration.validation.test.ts backend/test/registration.security.test.ts backend/test/registration.service.test.ts
node --import tsx --test backend/test/registration.validation.test.ts backend/test/registration.security.test.ts backend/test/registration.service.test.ts backend/test/registration.repository.test.ts
node --import tsx --test backend/test/*.test.ts
node node_modules/typescript/bin/tsc -p backend/tsconfig.json

# Desde frontend
npm.cmd test
npm.cmd run build -- --configuration production
```

Los fallos iniciales por uv_os_get_passwd o acceso a directorios correspondieron al sandbox y se reintentaron fuera de él con autorización. Las suites generales no consultan Neon: HTTP backend local con servicios simulados, repositorio con cliente simulado y Angular con HttpTestingController. La suite real, separada y manual, usó exclusivamente el contenedor temporal autorizado.

Los resultados reales de facultades son históricos, solo GET; la prueba de inserción de cuentas se realizó por separado en PostgreSQL temporal. Las pruebas de HU-03 no se ejecutaron ni se atribuyen a esta rama. Una observación histórica del controlador PostgreSQL sobre modos SSL no motivó cambios de configuración.


### Validación real de PostgreSQL y eliminación del entorno

La integración se ejecutó una sola vez tras revalidar ID, etiqueta, imagen, puerto y tmpfs del contenedor. Se eliminaron del entorno del proceso las variables DATABASE_URL y DATABASE_URL_UNPOOLED; TEST_DATABASE_URL apuntó exclusivamente a 127.0.0.1:55432, base ics_hu02_test y usuario hu02_test_admin, con credenciales solo en memoria y la habilitación explícita HU02_ALLOW_INTEGRATION_WRITES=1.

| Caso real | Resultado |
| --- | --- |
| Registro y persistencia | HTTP 201; un usuario y una sesión vinculados, UUID y normalización correctos |
| Hash y secretos | Argon2id verificable, contraseña original no persistida en texto plano y SHA-256 del token; JSON sin secretos |
| Correo duplicado normalizado | HTTP 409, sin agregar cuenta ni sesión |
| Universidad inexistente | HTTP 400, sin persistencia parcial |
| Fallo al insertar sesión | HTTP 500 sin cookie, fallo inducido real y rollback del usuario; recuperación posterior exitosa |
| Registros concurrentes | Un HTTP 201 y un HTTP 409; una cuenta y una sesión |
| Cookie y duración | HttpOnly, Secure, SameSite=Lax, Path=/; Expires no posterior a la sesión; seis horas exactas entre created_at y expires_at |

Entorno: PostgreSQL 17.11, imagen oficial postgres:17 sobre Docker Linux 28.3.2, fijada al identificador sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe. Contenedor ics-hu02-pg-test, etiqueta purpose=hu02-integration, ID de27d614679558fdc461355c76e839bb04d8ca0f8c0b76a77c538b5337f0364c. Datos en /var/lib/postgresql/data mediante tmpfs, sin montajes persistentes ni carpetas del proyecto. Esquema original leído en memoria del objeto Git fijado; se preparó una facultad ficticia, sin copiar datos de Neon.

Los casos fueron secuenciales salvo las solicitudes concurrentes dentro de su caso. Se aplicó una protección temporal en memoria para cancelar los pendientes ante un fallo; no hubo fallos ni repeticiones. No se detectaron problemas de SQL, Prisma o transacciones.

La comprobación previa de PowerShell tuvo inicialmente un falso positivo al tratar Binds nulo como un montaje; se detuvo antes de ejecutar SQL. Esa comprobación temporal fue corregida con autorización, sin modificar archivos. No fue una prueba de integración fallida.

Después de finalizar, se verificó el contenedor y se ejecutó exclusivamente `docker stop ics-hu02-pg-test`. AutoRemove lo eliminó; su ausencia se comprobó por nombre e ID y los datos tmpfs desaparecieron. La imagen postgres:17 se conservó. El contenedor mongodb mantuvo ID, imagen, inicio, puerto y contador de reinicios. No hubo conexiones a Neon, migraciones de desarrollo ni incorporación de HU-03.

### Comprobación general de cierre

Se ejecutaron los scripts existentes, con npm.cmd en PowerShell:

```powershell
# Desde backend
npm.cmd test
npm.cmd run build

# Desde frontend
npm.cmd test
npm.cmd run build -- --configuration production
```

El script backend `tsx --test test/*.test.ts` no incluye `test/integration/registration.integration.test.ts`. Los siete casos reales no se volvieron a ejecutar; el contenedor ya no existe. El build backend genera el cliente Prisma y compila localmente; no aplica migraciones.

Resultados actuales: 79 pruebas backend y 53 frontend aprobadas, cero fallidas; ambas compilaciones exitosas. Los primeros intentos de pruebas/Angular bloqueados por el sandbox se reintentaron fuera de él con autorización. Persiste la advertencia de presupuesto Angular: 509,15 kB frente a 500 kB. Los avisos Git LF/CRLF no cambiaron configuración ni prepararon archivos en staging.

Esta actualización conserva contratos y decisiones de integración. Solo se editó este documento; los scripts generaron los artefactos locales esperados de compilación. No se modificó código fuente, pruebas, dependencias ni configuración.

## 9. Registro de cambios por etapa

El registro conserva las etapas iniciales del 2026-10-22 y el cierre actualizado el 2026-10-23, sin atribuir nuevos commits a archivos no confirmados.

### Preservación y documentación inicial

- Historia/objetivo: HU-02, conservar formulario, ruta y facultades.
- Archivos: 12 nuevos y 7 modificados de las secciones 3.1/3.2; luego este documento.
- Commits: 195f5f52a82059550e362db55565c72f5a2571ec y 3a6fab578f53ffa261ff62f8364385da1929a1c8.
- Decisiones: rama propia, sin publicación; alcance corregido a HU-02.
- Verificación: diff, estado y referencias; pruebas históricas 15/26 y luego 4 backend/35 frontend.
- Problemas: restricciones del sandbox y avisos LF/CRLF; sin alterar configuración.
- Dependencias/pendiente: coordinación futura con compañero y registro real entonces pendiente.
- Eliminaciones: ninguna.

### Etapa 1 — Análisis y estrategia propia

- Historia/objetivo: completar HU-02 sin incorporar HU-03.
- Archivos creados/modificados/eliminados: ninguno en la etapa de análisis.
- Decisiones: destino temporal /; sesión automática de seis horas, sin restauración; seguridad compatible; sin escritura en Neon.
- Verificación: lectura del código/documentación; no valida persistencia.
- Dependencias: tablas existentes y contratos de HU-03; no se exige merge para desarrollar.
- Pendiente de esa etapa: módulos de validación, servicio, repositorio y adaptadores.

### Etapa 2 — Validación y seguridad

- Creados: backend/src/modules/accounts/registration.validation.ts y registration.security.ts; backend/test/registration.validation.test.ts y registration.security.test.ts.
- Modificados/eliminados: ninguno.
- Decisiones: normalización de correo, contraseña hasta 1024 bytes, Argon2id, token aleatorio y SHA-256.
- Pruebas: 21 aprobadas; sin servicios externos.
- Problemas/dependencias: límites y parámetros probados localmente; no depende de Prisma.
- Pendiente de esa etapa: orquestación y persistencia.

### Etapa 3 — Servicio de registro

- Creados: backend/src/modules/accounts/registration.service.ts y backend/test/registration.service.test.ts.
- Modificados/eliminados: ninguno.
- Decisiones: interfaz createUserAndSession, una operación atómica, errores tipados y resultado separado para JSON/cookie.
- Pruebas: 37 acumuladas aprobadas, repositorio simulado.
- Problemas/dependencias: fechas y errores dependen del contrato del repositorio; sin garantía de PostgreSQL por mocks.
- Pendiente de esa etapa: adaptador real y HTTP.

### Etapa 4 — Repositorio transaccional

- Creados: backend/src/modules/accounts/registration.repository.ts y backend/test/registration.repository.test.ts.
- Modificados/eliminados: ninguno.
- Decisiones: cliente inyectado, SQL seguro, universidad dentro de transacción, UUID explícitos, reloj común y traducción específica de users_email_key.
- Pruebas: 13 nuevas; 50 acumuladas aprobadas.
- Problemas/dependencias: sandbox impidió iniciar tsx; reintento autorizado. Requiere estructura compatible en PostgreSQL.
- Pendiente: rollback, concurrencia y errores del motor reales en base aislada.

### Etapa 5 — Endpoint HTTP

- Creados: backend/src/modules/accounts/registration.controller.ts y backend/test/registration.test.ts.
- Modificados: backend/src/app.ts, backend/src/server.ts, backend/test/app.test.ts y backend/test/universities.test.ts.
- Eliminados: ninguno.
- Decisiones: POST público con encabezado propio, JSON de 16 KiB, cookie HttpOnly y adaptación de errores; composición sin iniciar servidor en pruebas.
- Pruebas: 19 nuevas; 73 backend aprobadas. Compilación TypeScript exitosa.
- Problemas/dependencias: reintento de pruebas por sandbox; cookie y esquema compartidos con futura integración.
- Pendiente: conexión Angular y verificación real aislada.

### Etapa 6 — Conexión Angular

- Creados: frontend/src/app/features/auth/register/registration.service.ts, registration.service.spec.ts y registration.types.ts.
- Modificados: frontend/src/app/features/auth/register/register-page.ts, register-page.html y register-page.spec.ts.
- Eliminados: ninguno. No se modificaron Register ni backend en esta etapa.
- Decisiones: ruta relativa, cinco propiedades explícitas, sin Storage, bloqueo de duplicados, errores por campo y cancelación; navegar solo tras éxito.
- Pruebas: primera ejecución 51 aprobadas/2 fallidas por expectativas anteriores de App; las 46 de los otros cuatro archivos pasaron. Compilación de producción exitosa.
- Problemas: presupuesto inicial 509,15 kB; aviso de licencia PrimeUI observado durante esa ejecución.
- Dependencias/pendiente: endpoint propio, proxy conservado y autorización para actualizar App.

### Corrección puntual de pruebas de App

- Modificado únicamente: frontend/src/app/app.spec.ts.
- Creados/eliminados: ninguno.
- Decisiones: sustituir expectativas de vista previa/bloqueo permanente por presentación actual y envío válido; conservar navegación, invalidez y HTTP simulado.
- Pruebas: npm.cmd test desde frontend, 53 aprobadas y 0 fallidas.
- Problemas: primer intento limitado por sandbox; reintento exitoso, sin problemas nuevos.
- Dependencias/pendiente: ninguna modificación de producción; falta persistencia real aislada.

### Etapa 7 — Revisión funcional y documentación

- Modificado únicamente: docs/integracion-hu02-hu03.md.
- Creados/eliminados: ninguno.
- Objetivo: registrar estado real, trazabilidad de implementación y límites de verificación.
- Verificación: lectura del flujo, requisitos, pruebas y migración histórica disponible en Git; consultas Git de solo lectura.
- Decisiones: retirar como vigente el plan previo de incorporar HU-03; preservar referencias históricas y separar las validaciones simuladas de las reales.
- Problemas: desfase potencial de cookie respecto de expires_at, landing temporal, persistencia/atomicidad/concurrencia sin probar. No se corrigió código.
- Dependencias: coordinación futura de contratos con el compañero; ninguna escritura ni integración autorizada por esta etapa.
- Pendiente: revisión del documento y decisiones del usuario sobre observaciones y pruebas en entorno aislado.
- No se repitieron suites ni compilaciones en esta etapa.


### Etapa 8 — Corrección de vencimiento y verificación general

- Modificados con autorización: backend/src/modules/accounts/registration.controller.ts y backend/test/registration.test.ts.
- Creados/eliminados: ninguno.
- Decisión: Expires absoluto redondeado hacia abajo; sin Max-Age; 503 sin cookie para vencimiento/fecha inválida.
- Pruebas: seis nuevas, 79 backend y 53 frontend aprobadas; compilaciones exitosas.
- Problemas: restricciones de sandbox reintentadas; advertencia Angular de 9,15 kB.
- Pendiente de esa etapa: comprobar persistencia y transacciones en entorno aislado, resuelto posteriormente.

### Preparación, integración aislada y limpieza

- Creados: backend/test/integration/postgres-fixture.ts y backend/test/integration/registration.integration.test.ts. No se modificó producción para estas pruebas.
- Objetivo: verificar los siete escenarios reales sin afectar la base compartida.
- Decisiones: destino local estricto sin fallback, conexión independiente, base vacía, bloqueo exclusivo, credenciales en memoria; consulta del SQL original sin merge.
- Pruebas: siete aprobadas y cero fallidas; resultados individuales en la sección 8.
- Problemas: Docker Desktop inicialmente detenido; se inició con autorización. Falso positivo de Binds corregido antes de SQL. La ejecución real no detectó errores SQL/Prisma/transaccionales.
- Recursos: contenedor efímero PostgreSQL 17.11 creado, probado y eliminado con autorización; datos tmpfs destruidos, imagen conservada y mongodb intacto.
- Dependencias: ninguna integración de HU-03; conserva referencia histórica del SQL.
- Pendiente: navegador real, landing definitiva y futura coordinación de arquitectura, sin ampliar alcance a HU-04/HU-06.

### 2026-10-23 — Cierre documental y verificación general posterior

- Modificado únicamente: docs/integracion-hu02-hu03.md.
- Creados/eliminados en el proyecto: ninguno.
- Objetivo: registrar la integración aprobada y su limpieza, preservando decisiones y contratos.
- Verificaciones: npm.cmd test y npm.cmd run build en backend; npm.cmd test y build de producción en frontend.
- Resultado: 79 backend y 53 frontend aprobadas, ambas compilaciones exitosas; integración real no repetida.
- Revisión: git status, git diff --check, git diff --stat y listado de archivos sin seguimiento, sin staging ni commits.
- Problemas: advertencia Angular y avisos LF/CRLF; no se corrigió código.
- Pendiente: revisión del usuario y autorización para preparar el commit local.


### 2026-10-23 — Merge local controlado de develop, sin commit

- Inicio autorizado: feature/hu-02-registro, HEAD 66a205d219436965d1504019f044d123d4ef5fd4 y árbol limpio.
- Comando: git merge --no-commit --no-ff origin/develop, fijado en fbc7d8b3b87c62fca924ecedf7d20a0de9094a9a.
- Conflictos identificados antes de resolver: backend/src/app.ts, backend/src/server.ts, frontend/src/app/app.ts, app.html y app.routes.ts (contenido), y frontend/src/app/app.spec.ts (modificado/eliminado).
- Resoluciones:
  - backend/src/app.ts: conserva books/frontendDirectory y agrega las dependencias HU-02; monta catálogo, universidades y registro antes del 404 API y del fallback SPA.
  - backend/src/server.ts: compone BookRepository y PostgresRegistrationRepository con el mismo cliente compartido y mantiene el servicio estático.
  - frontend/src/app/app.routes.ts: conserva /catalogo y redirecciones; añade /registro antes del comodín.
  - frontend/src/app/app.ts y app.html: mantiene raíz simple con RouterOutlet y navegación pública Catálogo/Crear cuenta, sin la bienvenida de scaffolding ni lógica de login.
  - frontend/src/app/app.spec.ts: conserva la suite, adapta el destino /catalogo, simula GET de libros y facultades, y comprueba navegación, POST simulado, éxito y comodín. No se eliminan casos para ocultar regresiones.
- Archivos adicionales conciliados:
  - backend/test/book.test.ts: inyecta facultades vacías y registro simulado, sin operaciones de base.
  - backend/test/static.test.ts: inyecta dependencias HU-02; comprueba HTML en /registro, facultades y error de validación de POST simulado, además de catálogo y 404 API.
  - backend/test/integration/postgres-fixture.ts: cambia git show por readFile de la migración versionada ya presente en develop. No se ejecuta la fixture.
  - docs/integracion-hu02-hu03.md: actualiza estado y decisiones y conserva resultados históricos.
- Preservado sin modificación manual: schema.prisma, migraciones, configuración, módulos y contrato público del catálogo, estilos globales y lockfile provenientes de develop.
- Preservado desde HU-02: formulario, sus cuatro archivos del rediseño, servicio HTTP, validaciones, hashing, cookie y lógica de registro. No se integró la rama de login HU-03.
- Verificaciones ejecutadas:
  - Backend: selección explícita de nueve archivos test, 84 pruebas aprobadas y 0 fallidas; HTTP local, criptografía y repositorios simulados.
  - Frontend: npm.cmd test, 59 pruebas aprobadas y 0 fallidas en seis archivos, con HTTP interceptado.
  - Backend: npm.cmd run build, cliente Prisma generado localmente y compilación exitosa; sin migraciones ni SQL.
  - Frontend: npm.cmd run build -- --configuration production, exitosa; paquete inicial 493,06 kB, por debajo de 500 kB.
  - git diff --check y revisión de conflictos y estado del índice.
- No ejecutado por la restricción de SQL: backend/test/book-repository.test.ts, cuyo helper PGlite aplica migraciones/SQL en memoria. Tampoco integración PostgreSQL, E2E, Prisma db push ni comandos SQL.
- El script npm.cmd test de backend incluye ese caso PGlite, por eso no se utilizó para esta verificación; se seleccionaron explícitamente los archivos seguros. Las dependencias declaradas de develop no se instalaron ni actualizaron.
- Problemas: accesos del sandbox al iniciar tsx o compilar Angular; reintentos autorizados fuera de él. Sin errores de pruebas ni compilación en las ejecuciones finales.
- Estado: integración local sin commit ni push; los resultados históricos de siete casos PostgreSQL son anteriores a este merge y no verifican la fixture recién ajustada.
- Pendiente antes de confirmar/publicar: revisión del usuario del diff y del destino /catalogo, decidir autorización para pruebas PGlite/integración aislada y, si se necesitan E2E, resolver la dependencia Playwright no instalada. No se requiere instalarla para las suites unitarias ni compilaciones ejecutadas.
- HU-04 y HU-06 siguen fuera del alcance; no hubo conexión a Neon ni cambios de .env.

### Plantilla para próximas etapas

```markdown
### AAAA-MM-DD — Etapa N: nombre

- Historia y objetivo:
- Estado: propuesta / implementada / verificada; alcance de la verificación:
- Archivos creados, modificados y eliminados, con ruta y motivo:
- Referencias de commits:
- Decisiones técnicas:
- Pruebas/comandos y resultados:
- Problemas y solución aplicada o propuesta:
- Dependencias con otros integrantes:
- Cambios pendientes y autorizaciones necesarias:
```

Actualizar este registro con autorización en cada etapa. No atribuir al código local cambios que solo existan en un PR, ni convertir una prueba simulada en evidencia de persistencia real.
