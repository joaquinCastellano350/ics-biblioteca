# Guía de revisión: registro HU-02 y login HU-03

> Revisión histórica de los commits indicados abajo. Sus hallazgos se corrigieron en la integración posterior incorporada a `develop`. Consultar [la integración actual y su verificación](integracion-hu02-hu03.md); este documento conserva la evidencia original y no describe el estado actual del código.

Fecha: 23 de octubre de 2026. Revisión para Joaquín; no se publicaron comentarios ni cambios en GitHub.

## 1. Alcance y corrección de la conclusión anterior

- Registro: PR #4, `feature/hu-02-registro`, commit `7aafae6dd17f96de1569d44f709c7ac01ab5da60`.
- Base real del PR: `develop`, commit `fbc7d8b3b87c62fca924ecedf7d20a0de9094a9a`.
- Login: `HU-3-Inicio-Sesion`, commit `ff2b0310b3d991ff5f6e696b942d711ba1e3562f`.
- Diff del PR: `git diff origin/develop...origin/review-pr-4`: **37 archivos, 3805 inserciones y 8 eliminaciones**.
- Se revisan los commits de ambas historias. Los documentos locales sin commit sirven como contrato de referencia; no se atribuyen al contenido versionado del PR.
- No se modificaron fuentes de implementación ni se resolvió/confirmó un merge. Las pruebas adicionales viven en una copia ignorada bajo `node_modules/.cache/pr4-review-7aafae6/`.

La comprobación anterior demostró que **las credenciales y los registros de sesión son interoperables**. No demostró una integración terminada. Registro y login todavía implementan políticas compartidas por separado, presentan diferencias funcionales y tienen conflictos de composición. La afirmación general de que “son compatibles” fue demasiado amplia.

La carpeta no determina la compatibilidad: dos módulos pueden convivir si sus responsabilidades son distintas. En este caso ambos implementan partes del mismo dominio y no comparten su implementación. No alcanza con mover archivos o cambiar imports.

## 2. Recorrido sugerido para revisar personalmente

| Paso | Abrí primero | Seguí hacia | Qué tenés que comprobar |
| --- | --- | --- | --- |
| 1. Flujo visible | RegisterPage y Register | RegistrationService Angular | Qué se envía, cuándo se bloquea el formulario y qué ocurre con el DTO del 201. |
| 2. Estado autenticado | AuthService del login | App, modal y rutas | Que la nueva cuenta reemplace el estado anterior, tenga vencimiento y no la borre una respuesta vieja. |
| 3. Entrada HTTP | registration.controller | accounts.controller y app.ts | Cookie, CSRF, parser, cache y errores. No depender del orden de routers. |
| 4. Reglas y seguridad | registration.validation / security / service | credentials.ts / sessions.ts / AccountsService | Separar funciones idénticas de políticas divergentes. |
| 5. Persistencia | registration.repository | PrismaAccountsRepository | Una sola transacción para usuario, revocación previa y nueva sesión. |
| 6. Datos comunes | schema y migración de cuentas | seed, universidades y catálogo | No duplicar tablas ni perder datos iniciales/scripts. |
| 7. Composición final | app.ts y server.ts de ambos lados | App Angular y pruebas | Conservar las capacidades de las dos ramas y el catálogo que viene de develop. |
| 8. Evidencia | pruebas independientes | pruebas conjuntas de esta guía | No tomar dos suites verdes por separado como prueba de integración. |

Flujo de registro actual: formulario → servicio HTTP Angular → router de registro → validación/hash/token → transacción usuario+sesión → cookie+DTO → navegación. **El último paso omite confirmar el DTO en AuthService.**

Flujo de login actual: modal → AuthService → router de cuentas → validación/verificación → transacción revocación+sesión → cookie+DTO → AuthService actualiza usuario, generación y temporizador.

## 3. Dónde está cada responsabilidad

En login, `credentials.ts` **no contiene tokens**: contiene normalización de correo, validación de contraseña y Argon2id. Los tokens están en `sessions.ts`.

| Responsabilidad | Registro | Login | Resultado |
| --- | --- | --- | --- |
| Normalización de correo | registration.validation.ts:20 | credentials.ts:4 | Mismo trim y minúsculas; código duplicado. |
| Validación backend de email | registration.validation.ts:43 | credentials.ts:8 | Misma biblioteca validator y opciones por defecto. |
| Validación frontend de email | register.ts:59 | login-dialog.ts:40 y API | Registro agrega Validators.email; login delega formato a API. Hay divergencias. |
| Contraseña y límite | registration.validation.ts:24 | credentials.ts:12 | No vacía, máximo 1024 bytes UTF-8, sin recortar. Coincide. |
| Hash Argon2id | registration.security.ts:5 | credentials.ts:16 | Memoria 19456, iteraciones 2, paralelismo 1. Coincide. |
| Verificar hash | registration.security.ts:14 | credentials.ts:21 | Registro captura digest corrupto y devuelve false; login propaga error. Esa función de registro no participa en su alta. |
| Token aleatorio | registration.security.ts:23 | sessions.ts:9 | 32 bytes base64url. Coincide. |
| SHA-256 token | registration.security.ts:27 | sessions.ts:5 | Mismo hexadecimal; registro valida formato dentro del helper y login lo valida antes de llamarlo. |
| Duración | registration.service.ts:5 y SQL interval | sessions.ts:3 | Seis horas, pero constantes y creación duplicadas. |
| Creación sesión | registration.repository.ts:109 | prisma-accounts.repository.ts:19 | Ambas usan reloj DB y precisión de milisegundos; distintas operaciones transaccionales. |
| Cookie | registration.controller.ts:44 | accounts.controller.ts:46 | Mismo nombre y atributos de seguridad; Expires absoluto frente a Max-Age relativo. |
| Usuario público / DTO | registration.service.ts:7,85 | accounts.repository.ts:3 y controller.ts:10 | Estructuras compatibles, definiciones separadas. |
| Estado Angular | RegistrationService + RegisterPage | AuthService | Registro no actualiza el estado común. |
| Universidades | universities.repository.ts:8 | PrismaAccountsRepository:62 | Mismo DTO, orden SQL dependiente de colación frente a orden español explícito. |

Enlaces para comparar: [backend/src/modules/accounts/registration.security.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.security.ts#L1), [backend/src/accounts/credentials.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/credentials.ts#L1), [backend/src/accounts/sessions.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/sessions.ts#L1), [frontend/src/app/auth/auth.service.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/frontend/src/app/auth/auth.service.ts#L1).

**No hacen falta una migración nueva de autenticación ni un rehash de contraseñas para leer los datos de la otra historia.** La migración de cuentas es idéntica en ambas referencias; el esquema del PR conserva University/User/Session y añade catálogo proveniente de develop.

## 4. Conflictos de comportamiento confirmados

### 4.1 Estado Angular después del registro — P2

Fuente: [frontend/src/app/features/auth/register/register-page.ts:49](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register-page.ts#L49).

El callback descarta el DTO y navega. Al usar el AuthService de login, el estado sigue anonymous después del 201. Si ya se mostraba otra cuenta, tampoco se reemplaza con el DTO nuevo.

Reproducción: restaurar sesión con 401 → registrar mediante RegisterPage → responder 201 → exigir estado authenticated. La prueba adicional falla: obtiene anonymous.

**Cambio recomendado:** registro y login deben pasar por el mismo coordinador de autenticación. Confirmar el AuthResponse antes de navegar, cambiar la generación de autenticación, retirar datos de la cuenta anterior y programar el vencimiento nuevo. No hacer otro POST de login para compensarlo.

Hacer público únicamente el actual método privado accept() no alcanza: también hay que invalidar GET/401 anteriores. Como condición de la futura solución, coordinar login/registro en vuelo y suspender la revalidación por foco durante cualquiera de esas mutaciones. Hoy el listener solo excluye el modal de login. Una respuesta ignorada por JavaScript puede haber aplicado su Set-Cookie en el navegador; la generación por sí sola no serializa mutaciones. Estas últimas son condiciones de diseño por verificar en la integración final, no pruebas E2E ya ejecutadas.

### 4.2 Reemplazo de sesión previa — P2

Fuentes: [backend/src/modules/accounts/registration.controller.ts:36](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.controller.ts#L36), [backend/src/modules/accounts/registration.repository.ts:84](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.repository.ts#L84), [backend/src/accounts/prisma-accounts.repository.ts:23](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/prisma-accounts.repository.ts#L23).

Login recibe el token anterior y revoca esa sesión al crear la nueva. Registro no recibe ese dato y solo inserta usuario/sesión. Registrando B con cookie A, la cookie cambia, pero el token A continúa devolviendo 200.

**Cambio recomendado:** leer la cookie mediante el middleware común, validar y hashear el token por separado del cuerpo del formulario, y revocar ese token en la misma transacción de alta. Un 409, una universidad inválida o un fallo al crear sesión deben conservar la sesión anterior. No revocar por userId: eso cerraría otros dispositivos.

### 4.3 Políticas HTTP diferentes y dependientes del orden — P2

Fuentes: [backend/src/modules/accounts/registration.controller.ts:21](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.controller.ts#L21), [backend/src/accounts/accounts.controller.ts:29](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/accounts.controller.ts#L29), [backend/src/accounts/accounts.controller.ts:61](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/accounts.controller.ts#L61).

Probé los routers reales juntos, manteniendo el mismo servicio y base en memoria:

| Caso enviado a registro | Registro montado primero | Router de login montado primero |
| --- | --- | --- |
| Éxito 201 | Sin Cache-Control | no-store heredado del router login |
| Falta encabezado de protección | 403 FORBIDDEN | 403 REQUEST_NOT_ALLOWED |
| JSON con charset no admitido | 415 UNSUPPORTED_MEDIA_TYPE | 503 SERVICE_UNAVAILABLE |

La causa es que el router de login aplica su parser a todo /api antes de sus rutas. Un fallo del parser salta el router normal de registro y llega al handler general del login. Dos parsers no rompen el JSON normal por sí solos; el problema es el alcance y la traducción de errores.

Además, una universidad inexistente produce UNIVERSITY_NOT_FOUND en registro, mientras el contrato prevé VALIDATION_ERROR con fields.universityId. El frontend actual usa status/fields y por eso esto no rompe inmediatamente su pantalla, pero el contrato no es único. Fallos inesperados se clasifican como 500 en registro y como 503 en el handler de login.

**Cambio recomendado:** compartir protección de escrituras, no-store, parsing y códigos de error. Los errores charset/encoding son 415; un fallo inesperado de programación/persistencia es 500 y una dependencia realmente no disponible es 503. Conservar siempre mensajes sin secretos. No resolver la integración simplemente cambiando el orden de los routers.

### 4.4 Validación de correo: formulario, API y base difieren — P2

Fuentes: [frontend/src/app/features/auth/register/register.ts:59](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register.ts#L59), [backend/src/modules/accounts/registration.validation.ts:43](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.validation.ts#L43), [backend/src/accounts/credentials.ts:8](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/credentials.ts#L8), migración de cuentas users_email_normalized_check.

**Formulario frente a API:** ana@bücher.de e iñaki@example.org permanecen en el control email, pero Validators.email los rechaza y la API los acepta. También se reproduce con espacios exteriores NBSP que el trim del backend elimina. Las tres pruebas con DOM jsdom y el componente real fallan por {email:true}. No atribuir el mismo fallo a espacios ASCII corrientes: el input type=email los elimina nativamente.

**API frente a base:** el correo quoted `"ana test"@example.org` es aceptado por validator.isEmail en ambos módulos, pero el CHECK de la base prohíbe espacios interiores. Registro responde 500 INTERNAL_ERROR al insertarlo, en lugar de rechazarlo como dato inválido. Lo reproduje contra las migraciones reales en PGlite, sin dejar una cuenta parcial.

**Cambio recomendado:** definir una única política de correo y validarla de forma coherente. Según el contrato actual: trim/minúsculas, correo válido y rechazo de espacios interiores, sin repararlos. El backend debe devolver 400/fields.email antes de persistir. El formulario no debe bloquear por una regla más estrecha que la acordada para la API; comprobar particularmente dominios internacionales. No eliminar el CHECK de la base para ocultar el problema.

### 4.5 Universidades duplicadas y orden distinto

Fuentes: [backend/src/app.ts:45](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/app.ts#L45), [backend/src/modules/accounts/universities.repository.ts:8](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/universities.repository.ts#L8), [backend/src/accounts/accounts.controller.ts:55](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/accounts.controller.ts#L55), [backend/src/accounts/prisma-accounts.repository.ts:62](https://github.com/joaquinCastellano350/ics-biblioteca/blob/ff2b0310b3d991ff5f6e696b942d711ba1e3562f/backend/src/accounts/prisma-accounts.repository.ts#L62).

Ambas historias definen GET /api/universities. Responde el primer handler que termina la solicitud; el otro queda oculto. No hay dos respuestas automáticas, pero sí dos fuentes para la misma política.

En la base en memoria, ORDER BY name devolvió Azul, Faro, Árbol, Élite; localeCompare('es') devolvió Árbol, Azul, Élite, Faro. El resultado SQL depende de la colación configurada y no garantiza por sí mismo el contrato español.

**Cambio recomendado:** una ruta, una consulta y un criterio español explícito con desempate por id. Verificar además la lista cerrada de treinta instituciones con el seed de login.

### 4.6 Duplicación del dominio — observación de arquitectura

No es un choque de nombres del runtime: las rutas de import son distintas. Sí incumple la intención del contrato de tener funciones únicas de normalización/hash y módulos compartidos de sesión. Ya produce las divergencias anteriores y permite que futuras correcciones queden aplicadas solo a una historia.

Consolidar responsabilidad, sin obligar a que una única clase contenga todas las operaciones. Mantener servicios de registro y login separados es válido si usan las mismas primitivas, política HTTP y operación de persistencia de sesión.

## 5. Diferencias que pueden conservarse y precauciones al consolidar

- SQL parametrizado en registro y ORM en login pueden coexistir: ambos acceden a las mismas tablas con el mismo cliente Prisma. No existe otro pool creado por el registro productivo.
- El FOR KEY SHARE de universidad protege la referencia durante el alta; no es una incompatibilidad.
- El INSERT de registro omite revoked_at, cuyo valor queda correctamente nulo.
- Las cookies tienen mismo nombre, Path, HttpOnly, SameSite y Secure por entorno. Expires frente a Max-Age no impide que el navegador envíe el mismo token. Elegir una política común y mantener el vencimiento PostgreSQL como autoridad. La validación Date.now del registro ocurre después del commit: no es una garantía de rollback ni debe confundirse con el reloj DB.
- Registro necesita una operación atómica propia. **No crear usuario y luego llamar al createSession() actual de login**, porque este abre otra transacción. Un fallo podría dejar usuario sin sesión.
- La verificación defensiva de hash corrupto difiere; acordar un resultado de error consistente, distinguiendo contraseña incorrecta de datos internos inválidos.
- No borrar las sesiones/credenciales existentes ni regenerar hashes por cambiar de carpeta.

Propuesta de organización; todavía no implementada:

```text
backend/src/accounts/
  credentials.ts                  correo, password y Argon2id compartidos
  sessions.ts                     token, hash, formato y duración compartidos
  auth-http.ts                    cookie, protección, cache y errores comunes
  accounts.repository.ts          contratos/tipos compartidos
  prisma-accounts.repository.ts   consultas y operaciones de login/sesión
  registration.service.ts        reglas de alta
  registration.repository.ts     alta atómica
  universities.repository.ts     consulta única, si se mantiene separada
```

Podría elegirse modules/accounts en vez de accounts; la elección del nombre es secundaria. Recomiendo accounts porque es la ubicación del módulo ya usado por login. El helper que persiste/revoca sesión debe recibir la transacción abierta; no abrir una transacción anidada desde registro.

## 6. Los diez conflictos textuales del merge

Simulación realizada con `git merge-tree --write-tree HEAD origin/review-pr-4`. No modificó el índice ni la rama. HEAD sigue en ff2b031.

| Archivo con conflicto | Qué conservar al resolver |
| --- | --- |
| README.md | Documentación real de catálogo, registro, login y decisiones vigentes. |
| backend/README.md | Módulos y comandos finales, sin prometer endpoints ausentes. |
| backend/prisma/schema.prisma | University/User/Session comunes y modelos de catálogo. No recrear cuentas. |
| backend/src/app.ts | /api/books, universidades únicas, register, login, session, políticas HTTP y 404 antes del fallback SPA. |
| backend/src/server.ts | Mismo database y dependencias de ambos módulos; una configuración coherente del estático. |
| frontend/README.md | Flujo de registro integrado al estado de login y rutas reales. |
| frontend/src/app/app.html | Navegación, outlet y un único login-dialog. |
| frontend/src/app/app.spec.ts | Login lo eliminó y registro lo agregó/modificó: conservar escenarios útiles e integrarlos. |
| frontend/src/app/app.ts | RouterLink/RouterOutlet más LoginDialog y restauración inicial única. |
| frontend/src/index.html | Idioma, título y metadatos consistentes con ambas pantallas. |

Un merge sin marcadores no garantiza resolver los conflictos de comportamiento de la sección 4.

Otros archivos requieren revisión aunque se combinen sin conflicto:

- backend/package.json: conservar db:migrate, db:seed y los comandos necesarios de login, junto a generación Prisma y dependencias de pruebas que ya trae develop.
- backend/prisma.config.ts: conservar migrations.seed.
- backend/prisma/seed.ts y universities.ts: presentes en login y ausentes en el snapshot del PR. Esa ausencia **no es una eliminación introducida por PR #4 contra develop**. Un merge debe conservarlos.
- backend/test/integration: **no unir ciegamente por wildcard**. Login importa database con el entorno habitual y espera treinta universidades; registro exige destino PostgreSQL aislado, base vacía y carga una universidad de fixture. Diseñar fixture común o comandos separados explícitos.
- frontend/app.routes.ts: conservar /catalogo, /registro y las redirecciones. La ausencia de una landing real viene de la base actual; no atribuirla únicamente a este PR.
- Migraciones comunes de cuentas son idénticas. Catálogo, PGlite y Playwright provienen de develop; no son cambios añadidos por los 37 archivos de registro.

## 7. Inventario completo de los 37 archivos del PR

Leelos en este orden: backend productivo (1–8), frontend productivo (21–24, 25–26, 28–30, 32, 34–35, 37), pruebas y documentación. La columna final indica el punto a revisar, no que el archivo entero sea incorrecto.

| Nº | Archivo y comienzo de lectura | Qué cambia | Qué revisar |
| --- | --- | --- | --- |
| 1 | [backend/src/app.ts:45](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/app.ts#L45) | Monta universidades y registro; agrega dependencias obligatorias a createApp. | Comparar con login: conservar catálogo, login, session y registro antes del 404; una sola ruta de universidades y política HTTP. |
| 2 | [backend/src/modules/accounts/registration.controller.ts:21](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.controller.ts#L21) | Valida HTTP, parsea JSON, invoca registro, traduce errores y emite cookie. | Revisar no-store, códigos, cookie previa y parser; es donde cambia la respuesta según el orden de routers. |
| 3 | [backend/src/modules/accounts/registration.repository.ts:74](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.repository.ts#L74) | Comprueba universidad e inserta usuario y sesión con SQL parametrizado dentro de una transacción Prisma. | Conservar atomicidad y manejo de users_email_key. Agregar revocación del token previo en ESA transacción. |
| 4 | [backend/src/modules/accounts/registration.security.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.security.ts#L1) | Argon2id, verificación, generador y hash de token. | Comparar con credentials.ts y sessions.ts; consolidar primitivas y política frente a hash corrupto. |
| 5 | [backend/src/modules/accounts/registration.service.ts:100](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.service.ts#L100) | Valida, genera hash/token, llama a la operación atómica y construye DTO/cookie. | Compartir duración y tipos. UNIVERSITY_NOT_FOUND debe traducirse al contrato acordado. |
| 6 | [backend/src/modules/accounts/registration.validation.ts:20](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/registration.validation.ts#L20) | Normaliza correo y valida cinco campos, UUID y máximo de contraseña. | Compartir correo/password con login. Corregir el caso de correo quoted con espacio, antes de llegar a la base. |
| 7 | [backend/src/modules/accounts/universities.repository.ts:8](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/modules/accounts/universities.repository.ts#L8) | Consulta id y name mediante el cliente Prisma existente. | Unificar con AccountsRepository.listUniversities; SQL ORDER BY no garantiza el criterio español del contrato. |
| 8 | [backend/src/server.ts:17](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/src/server.ts#L17) | Construye repositorio/servicio de registro y los inyecta junto al catálogo. | Componer ambos servicios con el mismo database. Conservar catálogo y acordar frontendPath/frontendDirectory. |
| 9 | [backend/test/app.test.ts:16](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/app.test.ts#L16) | Agrega stubs de universidades/registro a la prueba de readiness. | Es adaptación de inyección; no verifica autenticación conjunta. |
| 10 | [backend/test/book.test.ts:12](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/book.test.ts#L12) | Agrega stubs para mantener las pruebas del catálogo. | Conservarlas para detectar pérdida de /api/books al combinar app.ts. |
| 11 | [backend/test/integration/postgres-fixture.ts:14](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/integration/postgres-fixture.ts#L14) | Fixture PostgreSQL local explícita, base vacía, migración de cuentas y fallos inducidos. | No mezclar con el test login que lee el entorno habitual. Diseñar una fixture común aislada. |
| 12 | [backend/test/integration/registration.integration.test.ts:18](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/integration/registration.integration.test.ts#L18) | Siete casos de persistencia, hash, duplicado, universidad, rollback, concurrencia y cookie. | No comprueba AuthService Angular ni convivencia de routers. Reejecución PostgreSQL externo pendiente. |
| 13 | [backend/test/registration.repository.test.ts:98](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/registration.repository.test.ts#L98) | Pruebas de llamadas SQL parametrizadas, transacción, errores y fechas. | Los dobles verifican interacción; el rollback real se verifica por separado. Extender con token previo. |
| 14 | [backend/test/registration.security.test.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/registration.security.test.ts#L1) | Argon2id, Unicode, límites y tokens. | Al consolidar, conservar esos casos y sumar verificación cruzada con login. |
| 15 | [backend/test/registration.service.test.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/registration.service.test.ts#L1) | Orquestación, errores, duración y DTO sin secretos. | Sumar cookie previa y prueba de respuesta compartida. Mantener hash fuera de la transacción. |
| 16 | [backend/test/registration.test.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/registration.test.ts#L1) | Contrato HTTP, cookie, protección de escrituras, parser y errores. | Agregar no-store, códigos unificados y montaje junto a login en ambos órdenes. |
| 17 | [backend/test/registration.validation.test.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/registration.validation.test.ts#L1) | Tipos, obligatorios, correo, UUID y límites UTF-8. | Agregar correo con dominio internacional y rechazo explícito del quoted con espacios según contrato. |
| 18 | [backend/test/static.test.ts:18](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/static.test.ts#L18) | Suma /registro y comprueba que la API no cae en HTML. | Conservar /catalogo y agregar /api/auth/login y /api/auth/session al combinar. |
| 19 | [backend/test/universities.test.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/backend/test/universities.test.ts#L1) | GET público 200, vacío y 503 con repositorio simulado. | No valida la colación real del SQL; agregar criterio español y desempate por id. |
| 20 | [docs/integracion-hu02-hu03.md:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/docs/integracion-hu02-hu03.md#L1) | Describe decisiones, historial, límites y futura integración en 518 líneas. | Distinguir lo implementado de lo pendiente. Aún dice merge sin commit aunque el PR ya contiene el merge. |
| 21 | [frontend/src/app/app.html:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/app.html#L1) | Agrega navegación Catálogo / Crear cuenta alrededor del outlet. | Conservar el modal único de login; no elegir una versión completa y perder funciones. |
| 22 | [frontend/src/app/app.routes.ts:9](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/app.routes.ts#L9) | Agrega ruta diferida /registro; mantiene /catalogo y redirecciones. | Login sigue siendo modal. La landing real sigue pendiente: hoy / redirige al catálogo. |
| 23 | [frontend/src/app/app.spec.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/app.spec.ts#L1) | Agrega pruebas de navegación y registro por App. | Combinar con restauración inicial, modal y estado de cuenta; no quedarse solo con navegación. |
| 24 | [frontend/src/app/app.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/app.ts#L1) | Importa RouterLink junto a RouterOutlet. | Conservar AuthService.restore una vez al arrancar y LoginDialog de HU-03. |
| 25 | [frontend/src/app/features/auth/register/register-page.css:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register-page.css#L1) | Layout del registro, panel lateral y adaptación móvil. | No cambia lógica auth. Revisar estilos propios del botón de reintento frente al tema PrimeNG. |
| 26 | [frontend/src/app/features/auth/register/register-page.html:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register-page.html#L1) | Compone página, formulario y reintento de universidades. | No contiene integración del estado de sesión. Revisar enlace al inicio y controles PrimeNG. |
| 27 | [frontend/src/app/features/auth/register/register-page.spec.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register-page.spec.ts#L1) | Carga, fallos, envío único, errores y navegación con HTTP simulado. | Hoy comprueba navegar tras 201; falta comprobar AuthService authenticated y descarte de respuestas viejas. |
| 28 | [frontend/src/app/features/auth/register/register-page.ts:38](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register-page.ts#L38) | Carga universidades, envía registro, muestra errores y navega al éxito. | Punto crítico: next ignora AuthResponse. Enlazar operación de registro al coordinador de autenticación. |
| 29 | [frontend/src/app/features/auth/register/register.css:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register.css#L1) | Estilos locales de campos, mensajes y botón. | Revisar coherencia con tema; no sustituye validar funcionamiento con teclado/móvil. |
| 30 | [frontend/src/app/features/auth/register/register.html:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register.html#L1) | Cinco campos accesibles, errores, select nativo y submit PrimeNG. | Select y reintento no siguen completamente la convención PrimeNG; validación email viene del TS. |
| 31 | [frontend/src/app/features/auth/register/register.spec.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register.spec.ts#L1) | Pruebas del formulario, bloqueo, opciones y eventos. | Agregar correos que la API acepta; no confundir form.valid con validación equivalente al backend. |
| 32 | [frontend/src/app/features/auth/register/register.ts:38](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/register.ts#L38) | FormGroup, validaciones, pertenencia a universidad y emisión de datos. | Validators.email difiere del backend. Mantener password exacta y normalizar correo antes de validar. |
| 33 | [frontend/src/app/features/auth/register/registration.service.spec.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/registration.service.spec.ts#L1) | Contrato POST, campos explícitos y ausencia de escrituras en Storage. | No comprueba que el DTO actualice el servicio de login. |
| 34 | [frontend/src/app/features/auth/register/registration.service.ts:10](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/registration.service.ts#L10) | Envía cinco campos a /api/auth/register con el encabezado requerido. | Transporta DTO compatible; todavía no participa en generación, vencimiento ni exclusión de operaciones auth. |
| 35 | [frontend/src/app/features/auth/register/registration.types.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/registration.types.ts#L1) | Define RegistrationResponse y reutiliza tipos del formulario. | Unificar respuesta con AuthResponse; ubicar tipos de transporte fuera del componente visual. |
| 36 | [frontend/src/app/features/auth/register/universities.service.spec.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/universities.service.spec.ts#L1) | GET, vacío y propagación de fallo. | HTTP simulado; no valida nombres del seed ni orden SQL. |
| 37 | [frontend/src/app/features/auth/register/universities.service.ts:1](https://github.com/joaquinCastellano350/ics-biblioteca/blob/7aafae6dd17f96de1569d44f709c7ac01ab5da60/frontend/src/app/features/auth/register/universities.service.ts#L1) | GET relativo /api/universities y extracción de universities. | Compatible en forma de DTO; conservar un único endpoint backend. |

No hay cambios de schema, migraciones ni package.json dentro de estos 37 archivos: ya vienen de develop o son diferencias al comparar snapshots con login.

## 8. Evidencia ejecutada y límites

En la revisión anterior, con los mismos SHAs: 85 pruebas backend y 59 frontend aprobadas, generación Prisma y compilaciones backend/Angular aprobadas. No se repitieron solo para inflar cobertura.

Ampliación de esta revisión, en copia temporal con módulos reales:

| Comprobación | Resultado |
| --- | --- |
| 100 tokens generados alternando helpers, validados/hasheados por ambos lados | Coinciden. |
| Matriz de password vacía, espacios, Unicode, 1024 y más de 1024 bytes | Reglas backend coinciden. |
| Hash de registro verificado por login y viceversa, incluidos espacios/Unicode/límite | Correcto. |
| Registrar y leer la sesión con el módulo de login | Correcto. |
| Login fallido con cookie vigente | 401; conserva sesión anterior. |
| Registro duplicado con correo normalizado | 409; no crea usuario/sesión extra y conserva sesión anterior. |
| Universidad inexistente | 400 UNIVERSITY_NOT_FOUND; no deja usuario parcial. |
| Trigger que fuerza fallo en INSERT de sesión durante registro | 500; rollback real de usuario y sesión en PGlite. |
| Mismo trigger durante login con cookie anterior | 503; rollback de revocación y sesión anterior sigue válida. |
| Registro B desde sesión A | La sesión A sigue autorizando: brecha confirmada. |
| Login reemplazando token de B | Revoca el token anterior de ese navegador; no revoca A de otro token. |
| Vencimiento y posterior login con cookie vencida | Consulta rechazada; nuevo login permitido. |
| Routers reales en ambos órdenes | Cambian no-store, error CSRF y charset 415/503. |
| Correo quoted con espacio que acepta validator | Base rechaza; respuesta 500: discrepancia confirmada. |
| Orden SQL y orden español | Diferente en la colación de la prueba. |
| RegisterPage más AuthService de login, HTTP simulado | Prueba falla: estado anonymous después de 201. |
| Formulario real con IDN/Unicode/NBSP en DOM jsdom | Tres pruebas fallan: UI rechaza correos que API acepta. |

Las pruebas adicionales fallidas son reproducciones deliberadas de defectos; no pertenecen al PR ni implican que las suites originales estén fallando.

No se usó Neon ni se ejecutaron escrituras sobre la base compartida. PGlite usa las migraciones reales y Prisma, pero no sustituye la prueba con la versión PostgreSQL del despliegue, ni valida concurrencia con todos los comportamientos de un servidor externo.

No se verificó un merge final compilado: sigue habiendo diez conflictos textuales. No se ejecutó una E2E de navegador ni se completó la landing. Las carreras de registro/login/foco deben quedar cubiertas después de implementar el coordinador común.

## 9. Orden recomendado para una integración concreta

1. Acordar carpeta única y extraer primitivas, tipos y política HTTP comunes; conservar tests.
2. Resolver app.ts/server.ts con catálogo y las cuatro rutas públicas de cuentas: universidades, registro, login y consulta de sesión.
3. Mantener el alta atómica y añadir la revocación de cookie previa dentro de esa transacción.
4. Corregir la política de email en formulario/API y su alineación con el CHECK de la base.
5. Integrar registro al AuthService como operación de autenticación completa, con generación, vencimiento y coordinación de solicitudes.
6. Conservar seed/scripts de login y separar o unificar de forma segura las fixtures de integración.
7. Ejecutar suites combinadas, pruebas de reemplazo/rollback, ambos órdenes de middleware y carreras de estado.
8. Compilar el merge final y revisar en navegador: registro → cuenta visible → recarga → login, cambio de cuenta, fallos, teclado y móvil.

Criterio de aceptación de la integración: ambos flujos deben cumplir la misma política observable, usar la misma identidad activa y compartir las mismas reglas de seguridad. Dos carpetas ordenadas o dos suites verdes por separado no demuestran eso.
