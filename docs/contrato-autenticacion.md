# Contrato de autenticación y sesión

Versión 5 · 26 de octubre de 2026. Definición compartida por SCRUM-7 a SCRUM-11. Registro, login, logout, consulta de sesión, listado de universidades y vencimiento están integrados en `develop`. Ver [la integración de registro y login](integracion-hu02-hu03.md) y [SCRUM-11](scrum-11-vencimiento-sesion.md) para el recorrido y la cobertura actual. La fuente del esquema es el [modelo compartido en Confluence](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/6389762), versión 4. La [copia local](modelo-de-datos.md) se sincroniza con esa fuente. Las correcciones expresas del usuario prevalecen sobre copias anteriores. Los campos HTTP usan camelCase y las columnas snake_case.

## 1. Decisiones compartidas

La API Express administra las cuentas y sesiones en PostgreSQL mediante Prisma, siguiendo el modelo `users` / `sessions` previsto. `neon.ts` mantiene `auth: false`: estas historias no incorporan un proveedor de identidad adicional.

La propuesta de autenticación usa sesiones opacas en una cookie HttpOnly, con vencimiento absoluto a las seis horas. La cookie contiene un secreto aleatorio; PostgreSQL conserva su hash y la relación con el usuario. Un JWT es otro formato posible de token y también podría transportarse en una cookie HttpOnly. Preferimos el token opaco porque el modelo ya consulta sesiones para vencerlas y revocarlas; añadir un JWT no elimina esa necesidad. No se requiere refresh token ni renovación por actividad.

El despliegue acordado usa un único Render Web Service: Express servirá la API y el build estático de Angular bajo el mismo origen HTTPS. El [ADR-0002 aceptado](adr/0002-sesion-y-origen-web.md) sustituye únicamente la distribución del frontend y backend del ADR-001; se mantienen PostgreSQL y Object Storage en Neon. Express implementa el servicio de los archivos estáticos compilados y el fallback SPA; el despliegue en Render sigue pendiente.

Angular usará rutas relativas `/api/...` tanto en producción como en desarrollo. En producción, navegador y API comparten origen: no hace falta habilitar CORS ni `withCredentials` para otro dominio. En desarrollo se mantiene el proxy de Angular hacia Express. La cookie de producción usa `SameSite=Lax; Secure`; no se requiere una prueba de cookies entre sitios.

## 2. Identidad y contraseñas

| Dato | Regla compartida por registro e inicio de sesión |
| --- | --- |
| Correo | Quitar espacios exteriores y convertir a minúsculas antes de validar, buscar y guardar. Persistir un único campo `email`, con restricción UNIQUE. Registro, login y seed usan la misma normalización. No quitar puntos o sufijos `+...` ni reparar espacios interiores: un correo inválido se rechaza. |
| Nombre y apellido | Obligatorios; quitar espacios exteriores. Conservar mayúsculas, tildes y espacios interiores. |
| Universidad | `universityId` debe ser un UUID existente en la lista cerrada de SCRUM-7. La API valida la referencia; no acepta nombres arbitrarios como sustituto. |
| Contraseña | Cadena no vacía, sin requisitos de mayúsculas, números o símbolos. No recortar espacios, normalizar Unicode ni truncar. Límite técnico de 1024 bytes UTF-8, comprobado antes del hash tanto en registro como en login. No es una política de complejidad. |

Registro usa Argon2id con sal aleatoria por contraseña, memoria de 19456 KiB, dos iteraciones y paralelismo 1. Se guarda la representación codificada completa en `password_hash`, incluidos algoritmo, parámetros y sal. Login verifica esa representación con la misma biblioteca; no compara hashes creados con sales nuevas. El seed de desarrollo debe usar la misma función de hash.

Una cuenta inexistente y una contraseña incorrecta devuelven el mismo error. Los cuerpos y logs no incluyen contraseñas, hashes, cookies ni tokens.

## 3. Creación, validación y cierre de sesiones

1. Generar 32 bytes con un generador criptográfico y codificarlos en base64url sin padding. Ese valor es el token opaco.
2. Guardar únicamente su SHA-256 hexadecimal en `sessions.token_hash`, con índice único, y un UUID independiente en `sessions.id`. SHA-256 se usa para este secreto aleatorio; las contraseñas usan Argon2id.
3. Obtener `created_at` del reloj de PostgreSQL y fijar `expires_at = created_at + interval '6 hours'`, con `revoked_at` nulo. Al registrar una cuenta, usuario y primera sesión se confirman en una misma transacción.
4. Emitir la cookie solo después del COMMIT. Cada login correcto genera una sesión nueva; no reutiliza un token recibido del navegador. El login no revoca sesiones de otros dispositivos.
5. Cada solicitud protegida calcula el hash del token recibido y comprueba en la base que existe, que `revoked_at IS NULL` y que la hora de PostgreSQL es menor que `expires_at`. En el instante exacto del vencimiento ya se rechaza. No depender de un cron, de la hora del navegador ni de una caché que acepte sesiones revocadas.
6. Logout establece `revoked_at` en la sesión identificada por esa cookie y la elimina del navegador. Una solicitud protegida posterior al cierre confirmado debe fallar. No es un cierre global de todas las sesiones de la cuenta.

Varias pestañas del mismo origen comparten la cookie. Un cierre de sesión afecta a todas las que la usan; se enteran al revalidar. No se promete sincronización instantánea entre pestañas ni deshacer una operación ya autorizada antes del cierre. Una sesión distinta de otro navegador sigue vigente.

### Cookie

| Entorno | Nombre y atributos |
| --- | --- |
| Producción HTTPS con origen común | `biblioteca_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=<expiresAt de PostgreSQL, en formato HTTP>`. Sin atributo `Domain`. |
| Desarrollo HTTP local | `biblioteca_session=<token>; Path=/; HttpOnly; SameSite=Lax; Expires=<expiresAt de PostgreSQL, en formato HTTP>`. Sin `Secure` ni `Domain`. |

Se usa el mismo nombre `biblioteca_session` en ambos entornos, con `SameSite=Lax` y `HttpOnly`; producción añade `Secure` por usar HTTPS. Las cookies quedan asociadas a sus respectivos hosts y no se comparten entre local y producción. La creación usa el vencimiento absoluto de la base, truncado al segundo por el formato HTTP, sin `Max-Age` ni comparación con el reloj de Node. No reemitir la cookie para extenderla al consultar datos. Logout conserva nombre, ruta y atributos al eliminarla con fecha expirada. El vencimiento de PostgreSQL es definitivo aunque el navegador conserve la cookie.

El token no aparece en JSON, URLs, almacenamiento web ni variables de Angular. La cookie HttpOnly reduce la exposición del secreto a JavaScript; no sustituye la prevención de XSS.

## 4. HTTP y protección de solicitudes

Rutas relativas bajo `/api`, tanto en producción con origen común como en desarrollo con proxy. JSON UTF-8 en solicitudes con cuerpo; UUID como string y fechas RFC 3339 en UTC con sufijo `Z`. Las respuestas de autenticación, incluidos errores y logout, y todas las respuestas con datos personales llevan `Cache-Control: no-store`. No guardar esos datos en cachés de la aplicación o del service worker.

Todas las operaciones que cambian estado usan POST, PATCH o DELETE, nunca un GET de API. Para este contrato las escrituras son POST y requieren el encabezado `X-Biblioteca-Request: 1`, incluso login, registro y logout. El cliente lo agrega únicamente a rutas de nuestra API, usando la base configurada; no lo adjunta a solicitudes a proveedores externos.

Ese encabezado es un marcador público, no un secreto ni una prueba de identidad. Impide que un formulario de otro sitio ejecute escrituras aprovechando las cookies que adjunta el navegador. Un script de otro origen necesita autorización CORS para enviarlo. Este es el mecanismo CSRF del MVP, junto con JSON y sin habilitar CORS para otros orígenes. No se exige una comprobación adicional estricta de `Origin`/`Referer`. Las pruebas que invocan escrituras envían el mismo encabezado.

## 5. Endpoints y representaciones

| Método y ruta | Entrada | Éxito | Errores específicos |
| --- | --- | --- | --- |
| `GET /api/universities` | Sin autenticación | 200, `UniversitiesResponse` | 503 si no se puede consultar |
| `POST /api/auth/register` | `RegisterRequest` | 201, `AuthResponse` y cookie nueva | 400 datos inválidos; 409 correo ocupado |
| `POST /api/auth/login` | `LoginRequest` | 200, `AuthResponse` y cookie nueva | 400 datos inválidos; 401 credenciales incorrectas |
| `GET /api/auth/session` | Cookie de sesión | 200, `AuthResponse` | 401 si falta, es desconocida, venció o fue revocada |
| `POST /api/auth/logout` | Cookie si existe; sin cuerpo | 204, sin cuerpo, elimina cookie | 503 si no se puede confirmar la revocación |

Registro e inicio de sesión se pueden usar sin cookie o con una cookie antigua. Una cookie vencida no impide autenticarse de nuevo. Si hay una sesión anterior reconocida en ese navegador, el éxito revoca esa sesión y crea su reemplazo en la misma transacción; un intento fallido no modifica la sesión anterior. Las demás sesiones de la cuenta permanecen.

Logout es idempotente: sin sesión, con token desconocido, con sesión vencida o ya revocada devuelve igualmente 204 y elimina la cookie, siempre que pueda determinar ese resultado. No atraviesa un middleware que lo rechace por sesión vencida. Si falla la base, devuelve 503 y no informa un cierre confirmado ni elimina la cookie que permite reintentarlo.

`GET /auth/session` no crea, renueva ni prolonga sesiones; permite restaurar el estado del frontend tras recargar. Los errores 401 no envían una eliminación de cookie: una respuesta vieja no debe borrar una cookie creada por un login posterior.

### Cuerpos

Las siguientes son definiciones de transporte, no modelos Prisma. Todos los campos declarados son obligatorios, salvo `ErrorResponse.error.fields`. La API valida los campos esperados y selecciona explícitamente los que persiste; no pasa el cuerpo completo a Prisma.

```typescript
type University = {
  id: string;       // UUID
  name: string;
};

type UniversitiesResponse = { universities: University[] };

type RegisterRequest = {
  firstName: string;
  lastName: string;
  universityId: string; // UUID de GET /api/universities
  email: string;
  password: string;
};

type LoginRequest = { email: string; password: string };

type AuthResponse = {
  user: {
    id: string;      // UUID del estudiante autenticado
    firstName: string;
    lastName: string;
    email: string;
    university: University;
  };
  session: {
    createdAt: string; // RFC 3339 UTC
    expiresAt: string; // createdAt + 6 horas
  };
  serverTime: string;  // reloj PostgreSQL consultado para la respuesta
};

type ErrorResponse = {
  error: {
    code: string;     // valores cerrados de la tabla siguiente
    message: string;  // texto en español; no se usa como condición de código
    fields?: Partial<Record<
      'firstName' | 'lastName' | 'universityId' | 'email' | 'password',
      string
    >>;
  };
};
```

`GET /api/universities` devuelve las instituciones de la lista de SCRUM-7 cargadas como datos iniciales, con los nombres tal como aparecen en esa lista, ordenadas alfabéticamente con criterio español y desempate por `id`. La entidad es `universities`, su FK es `users.university_id` y el campo HTTP es `universityId`. No se añade `code`, porque la entidad del documento compartido solo declara `id` y `name`. La selección y el correo no acreditan condición de estudiante; no hay confirmación de correo.

### Errores

| HTTP | `error.code` | Uso |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | JSON mal formado o datos inválidos. `fields` solo para campos concretos; no repetir valores recibidos. |
| 401 | `INVALID_CREDENTIALS` | Solo login: «El correo o la contraseña son incorrectos». No abre otro diálogo ni reintenta. |
| 401 | `AUTH_REQUIRED` | Falta sesión o no está vigente: «Iniciá sesión para continuar». Mismo resultado para token desconocido, vencido o revocado. |
| 403 | `REQUEST_NOT_ALLOWED` | Falta el encabezado de protección de una escritura. No se soluciona volviendo a iniciar sesión. |
| 404 | `NOT_FOUND` | Recurso inexistente o recurso personal que no pertenece a la cuenta autenticada. |
| 409 | `EMAIL_ALREADY_REGISTERED` | Registro con correo normalizado ya ocupado. También cubre dos registros simultáneos mediante la restricción única. |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo mayor que el límite técnico de 16 KiB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Cuerpo enviado sin `application/json`, charset o codificación no compatibles. Logout no requiere content type si no recibe cuerpo. |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin stack ni detalles internos. |
| 503 | `SERVICE_UNAVAILABLE` | Base o dependencia requerida no disponible. No convertir un fallo de infraestructura en 401. |

El encabezado de protección se comprueba antes de procesar una escritura. El rate limiting y las mitigaciones específicas de diferencias de tiempo quedan como mejoras posteriores; no son requisitos para cerrar estas historias del MVP. Sí se mantienen el hash de contraseñas, el vencimiento/revocación en el servidor, las consultas por titular, HTTPS en producción y los errores sin secretos: son parte del funcionamiento básico de las cuentas.

## 6. Estado del frontend y diálogo

Un solo servicio de autenticación conserva en memoria el estado `loading`, `anonymous`, `authenticated` o `unavailable` y el `AuthResponse` actual. Login y registro actualizan ese mismo servicio antes de cerrar el diálogo o navegar. Un bloqueo compartido evita escrituras simultáneas y revalidaciones por foco durante ellas; las respuestas de restauraciones anteriores se descartan. Al arrancar la aplicación consulta `/auth/session`; no muestra datos privados hasta resolverlo. Un 503 inicial muestra error y permite reintentar; no simula un visitante ni un usuario autenticado.

Al vencer el plazo conocido, el frontend retira de la vista los datos personales y pasa a `anonymous`. Usa la diferencia entre `serverTime` y `expiresAt` para un temporizador de presentación. Cuando la ventana recupera foco, si hay una sesión autenticada y el diálogo no está abierto, la revalida en segundo plano conservando la cuenta visible durante la consulta. No inicia otra comprobación mientras haya una en curso. Un 401 retira la sesión; un fallo temporal de red o del servidor conserva la cuenta y el vencimiento ya conocido. La API siempre decide la autorización. La falta de sesión no impide usar el catálogo.

No hay consultas periódicas a `/auth/session`: se consulta al arrancar la aplicación, al recuperar foco en las condiciones anteriores y al pulsar Reintentar tras un fallo inicial. Un clic dentro de una ventana que ya tiene foco no dispara por sí mismo esta consulta. El login usa directamente su `AuthResponse`, sin un GET adicional; el temporizador local de seis horas retira los datos sin consultar ni renovar la sesión.

Cuando una solicitud protegida devuelve `AUTH_REQUIRED`, se limpian los datos personales y se solicita autenticación si el flujo la necesita. Varias respuestas simultáneas abren como máximo un diálogo. El servicio usa una generación de autenticación para ignorar respuestas privadas o 401 de solicitudes anteriores a un login/logout posterior. Un error de credenciales no entra en ese tratamiento global. Un fallo de red o 503 no provoca un diálogo de credenciales.

El diálogo compartido solicita correo y contraseña, muestra errores, evita envíos duplicados mientras espera, permite cancelar y no cambia la ruta ni pierde filtros o desplazamiento. Al completar login se cierra; al cancelar no ejecuta acciones. Debe tener nombre accesible, foco inicial, foco contenido, cierre con Escape y devolución del foco al control que lo abrió; ser usable por teclado y en celular. La contraseña se descarta al cerrar.

| Contexto | Después de autenticar |
| --- | --- |
| Acceso «Iniciar sesión» | Conservar página y estado. |
| Solicitar préstamo o entrar en cola desde catálogo | Conservar página. La persona vuelve a pulsar la acción; no guardar y repetir la solicitud. |
| Ruta de datos personales | Mostrar los datos propios después de verificar sesión y cargarlos de nuevo; no reutilizar la respuesta de otra cuenta. |
| Enlace de reserva del correo, SCRUM-26 | Conservar solo el identificador de la reserva. Tras autenticar, la página inicia la aceptación autenticada por POST sin una confirmación adicional. La API vuelve a validar destinatario, vigencia y límite. |

No implementar un interceptor que repita automáticamente solicitudes después de iniciar sesión. La continuación de SCRUM-26 es explícita de esa página, no una regla global. El GET que carga el enlace no modifica reservas. Al completar registro, el frontend muestra la landing según SCRUM-7.

## 7. Protección de datos y módulos compartidos

`requireSession` entrega al handler únicamente una identidad comprobada (`userId`, `sessionId`, `expiresAt`). El handler de préstamos, colas o lectura usa ese `userId` para filtrar las consultas. Un `userId` recibido por URL, query o cuerpo no puede sustituirlo. Los recursos de otra cuenta devuelven 404, tras autenticar, sin revelar su contenido.

Guards y estado de Angular mejoran la navegación; la API aplica la protección aun ante solicitudes directas. Un 401 se produce antes de leer datos personales o ejecutar cambios de negocio. Una respuesta privada emitida antes de logout se descarta en el cliente si cambió la generación de autenticación.

| Trabajo compartido | Primera implementación | Reutilización |
| --- | --- | --- |
| Migraciones de `universities`, `users`, `sessions` y datos de universidades | Base mínima de SCRUM-8, coordinada con SCRUM-7 | Registro incorpora cuentas reales sin otra migración de las mismas tablas. |
| Normalización de correo y hash de contraseña | Funciones únicas del módulo de cuentas | Login, registro y seed usan las mismas funciones. |
| Creación y consulta de sesiones, cookie y `requireSession` | SCRUM-8 | SCRUM-7 crea sesión; SCRUM-9 protege handlers; SCRUM-10 revoca; SCRUM-11 completa reautenticación y pruebas de vencimiento. |
| Servicio de autenticación, cliente HTTP y diálogo Angular | SCRUM-8 | Registro actualiza el mismo estado; cierre y vencimiento lo limpian. |
| Registro, universidades públicas, privacidad y logout | SCRUM-7, SCRUM-9 y SCRUM-10, a cargo de Mailén según Jira revisado | Utilizan el contrato y los módulos anteriores. |

La separación por historia no permite publicar endpoints personales sin protección mientras se espera SCRUM-9. La vigencia absoluta ya se aplica al crear y comprobar sesiones en SCRUM-8; SCRUM-11 no requiere cambiar el formato de sesión.

## 8. Casos que deberán verificar las implementaciones

Estos son criterios de pruebas futuras; la definición de este contrato no significa que ya se hayan ejecutado.

| Caso | Resultado esperado |
| --- | --- |
| Login correcto / incorrecto / cuenta inexistente | Cookie y DTO en el éxito; mismo error genérico para ambos fallos, sin crear sesión. |
| Correo con mayúsculas o espacios exteriores | Login encuentra la misma cuenta; registro rechaza duplicado. |
| Contraseña con espacios, tildes o Unicode | Se verifica exactamente, sin transformaciones ni truncado. |
| Dos registros simultáneos del mismo correo | Un 201 y un 409; una cuenta, sin usuario parcial si falla su sesión. |
| Recarga y dos pestañas | Sesión se restaura desde la API; cookie compartida y sin ampliar seis horas. |
| Instantes anterior, igual y posterior a `expires_at` | Solo el anterior autoriza; probar con reloj controlable sin esperar seis horas reales. |
| Logout repetido, sesión antigua y otro dispositivo | 204 idempotente; token cerrado rechazado; la otra sesión independiente sigue vigente. |
| Falla de base durante sesión o logout | 503; no autorización permisiva ni falso cierre exitoso. |
| Solicitud directa con token ausente, inventado, vencido o revocado | 401 sin datos personales ni efecto de negocio. |
| UUID de otra cuenta | 404; ni lectura ni modificación de ese recurso. |
| Préstamo o cola que abre login | Página, filtros y desplazamiento conservados; cero acciones hasta volver a pulsar. |
| Reserva desde correo | El GET no cambia estado; tras login la página envía la aceptación una vez, con idempotencia en la API de circulación. |
| Varios 401 o respuesta vieja tras nuevo login | Un solo diálogo; la respuesta vieja no borra el nuevo estado ni su cookie. |
| Formulario HTML o escritura sin encabezado personalizado | Escritura rechazada, incluidos login, registro y logout. |
| Script desde otro origen | CORS no autoriza sus solicitudes con credenciales ni el encabezado personalizado. |
| Cookie en el origen HTTPS de entrega | Login, recarga y logout funcionan con la cookie HttpOnly y SameSite=Lax, sin depender de cookies entre sitios. |
| Navegación móvil y teclado | Diálogo usable, foco correcto y cancelación sin efectos. |

## 9. Fuentes y alcance de la decisión

Reglas de producto: [SCRUM-7](https://joaquincastellano350.atlassian.net/browse/SCRUM-7), [SCRUM-8](https://joaquincastellano350.atlassian.net/browse/SCRUM-8), [SCRUM-9](https://joaquincastellano350.atlassian.net/browse/SCRUM-9), [SCRUM-10](https://joaquincastellano350.atlassian.net/browse/SCRUM-10), [SCRUM-11](https://joaquincastellano350.atlassian.net/browse/SCRUM-11) y la continuación específica de [SCRUM-26](https://joaquincastellano350.atlassian.net/browse/SCRUM-26), revisadas en esta conversación. Arquitectura de base: [ADR-001 en Confluence](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/5177345).

Las rutas HTTP, DTO, parámetros criptográficos y protección de solicitudes son decisiones técnicas de este contrato. No se atribuyen a las historias originales. El modelo compartido en Confluence fue corregido en su versión 4 para unificar `universities`, `university_id` y el índice UNIQUE sobre `email`, conservando un único campo de correo. El contrato se versiona en el repositorio. ADR-0002 fue aceptado por el usuario el 22 de octubre de 2026 y reemplaza únicamente la distribución web/API de ADR-001.

Referencias técnicas consultadas el 22 de octubre de 2026: [OWASP: contraseñas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP: sesiones](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP: CSRF y encabezados personalizados](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [Angular: seguridad](https://angular.dev/best-practices/security) y [Express: archivos estáticos](https://expressjs.com/en/starter/static-files/).
