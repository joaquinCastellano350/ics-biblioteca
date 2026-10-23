# Integración de HU-02 con la arquitectura de HU-03

Fecha de preparación: 22 de octubre de 2026.

## 1. Estado y referencias

Este documento acompaña el futuro Pull Request de HU-02. Distingue código local, resultados históricos y propuestas pendientes de autorización.

El alcance de este trabajo es exclusivamente HU-02, reutilizando la infraestructura de autenticación de HU-03. HU-04 y HU-06 están fuera del alcance: no se implementarán ni modificarán como parte de este trabajo.

| Referencia | Estado al crear este documento |
| --- | --- |
| Rama local | `feature/hu-02-registro` |
| Commit inicial de HU-02 | `195f5f52a82059550e362db55565c72f5a2571ec` |
| Mensaje del commit | `feat(hu-02): agregar formulario y carga de facultades` |
| Trabajo preservado | 19 archivos: 12 nuevos y 7 modificados |
| Base anterior | `260f2edc74e8652a6f7845aca797ece177225f0a` |
| PR de HU-03 revisado | [PR #1](https://github.com/joaquinCastellano350/ics-biblioteca/pull/1) |
| Commit de HU-03 revisado | `ff2b0310b3d991ff5f6e696b942d711ba1e3562f` |
| Referencia remota disponible localmente | `origin/HU-3-Inicio-Sesion`, en el commit revisado |
| Integración de HU-03 en esta rama | No realizada |

El directorio de trabajo estaba limpio antes de crear este documento. Este archivo se crea sin prepararlo en el índice ni confirmarlo en un commit. Las referencias remotas no se actualizaron desde GitHub para esta tarea; no constituyen una comprobación del estado remoto actual.

**El registro real continúa deshabilitado. No están implementados localmente `POST /api/auth/register`, la creación de usuarios ni el inicio automático de sesión.**

## 2. Resumen funcional

### HU-02 — Registrar una cuenta

Actor: visitante.

Descripción documentada: «Como visitante, quiero crear una cuenta, para acceder a las funciones personales de la biblioteca».

Criterios de aceptación:

- Solicitar nombre, apellido, facultad, correo electrónico y contraseña.
- Elegir facultad de la lista cerrada de 30 instituciones documentadas.
- Aceptar correo válido de cualquier dominio, sin acreditar condición de estudiante ni confirmar correo.
- Señalar datos faltantes o inválidos y rechazar correo ya registrado.
- Iniciar sesión y mostrar la landing al completar el registro.
- No aplicar una política de complejidad de contraseña.

RF-01 establece el registro; RF-02 establece el inicio de sesión para acceder a funciones personales. La sesión automática de HU-02 requiere compartir los mecanismos de RF-02.

### Implementado localmente

- Componente standalone `Register`, con formularios reactivos y los cinco campos.
- Validación de obligatorios, correo y pertenencia a las opciones recibidas; mensajes en español.
- Contraseña sin exigencia de complejidad ni confirmación.
- Evento `registerRequested`, sin HTTP dentro del formulario.
- Entradas de carga, errores externos y `submitDisabled`, cuyo valor predeterminado es `false`.
- Página `RegisterPage`, ruta pública diferida `/registro`, bienvenida conservada en `/` y enlaces de ida y vuelta.
- Servicio Angular de facultades, carga, error, lista vacía, reintento manual y cancelación al destruir la página.
- Endpoint público `GET /api/universities`, consulta fija de `id` y `name`, cliente Prisma compartido e inyección de dependencias.
- En RegisterPage, `submitDisabled=true`: se pueden completar los campos después de la carga, pero no se emite el registro, ni por envío forzado.

### Disponible únicamente en el PR de HU-03

- Módulo backend controller → service → repository.
- `AccountsService`, `AccountsRepository` y `PrismaAccountsRepository`.
- Modelos Prisma originales `University`, `User` y `Session`, migración y seed institucional.
- Login, consulta de sesión y otra implementación del endpoint de facultades.
- Hashing Argon2id, token opaco, hash SHA-256, cookie y vencimiento absoluto de seis horas.
- `AuthService` Angular, restauración, revalidación, vencimiento y diálogo de login que conserva la página abierta.
- Servicio de la SPA desde Express en producción bajo un origen común.

El PR identifica su alcance como login de SCRUM-8; registro, logout y landing quedan separados. Nada de esta lista se atribuye todavía al código local.

### Pendiente

Integrar la infraestructura de HU-03 necesaria para HU-02; implementar registro transaccional y sesión automática; acordar landing y navegación; verificar la combinación.

## 3. Inventario local preservado

Responsabilidad funcional: HU-02. No se asigna un nombre personal ni una responsabilidad de mantenimiento que no haya sido acordada.

### Archivos creados en el commit inicial

| Ruta | Función y dependencias | Impacto o riesgo de integración |
| --- | --- | --- |
| `backend/src/modules/accounts/universities.repository.ts` | SELECT fijo mediante el cliente Prisma existente | Se propone retirarlo al adoptar el repositorio del PR |
| `backend/test/universities.test.ts` | Contrato HTTP con servicios simulados | Adaptar la inyección sin perder casos 200, vacío y 503 |
| `frontend/src/app/features/auth/register/register.ts` | Estado, validaciones, evento y bloqueo de envío; Angular Forms | Mantenerlo independiente de autenticación y HTTP |
| `frontend/src/app/features/auth/register/register.html` | Campos, accesibilidad, mensajes y botón PrimeNG | No habilitar envío por el solo hecho de integrar login |
| `frontend/src/app/features/auth/register/register.css` | Diseño adaptable y variables visuales existentes | Evitar interferencias con estilos del modal |
| `frontend/src/app/features/auth/register/register.spec.ts` | Validaciones y emisión, incluido bloqueo forzado | Conservar cobertura existente |
| `frontend/src/app/features/auth/register/register-page.ts` | Carga y reintento mediante UniversitiesService | Futuro punto de conexión con el AuthService del compañero |
| `frontend/src/app/features/auth/register/register-page.html` | Aviso de vista previa y entradas de Register | Mantener `submitDisabled=true` durante la integración inicial |
| `frontend/src/app/features/auth/register/register-page.css` | Presentación de página y reintento | Estilos encapsulados |
| `frontend/src/app/features/auth/register/register-page.spec.ts` | Carga, UUID, error, vacío, cancelación y bloqueo | Mantener HTTP simulado |
| `frontend/src/app/features/auth/register/universities.service.ts` | GET relativo y respuesta tipada | Compatible con el endpoint del PR |
| `frontend/src/app/features/auth/register/universities.service.spec.ts` | Peticiones interceptadas por HttpTestingController | Sin conexiones reales |

### Archivos existentes modificados en el commit inicial

| Ruta | Cambio local | Impacto o riesgo de integración |
| --- | --- | --- |
| `backend/src/app.ts` | Dependencia y ruta de facultades; respuesta 503 | Combinar con accountsController, sin duplicar rutas |
| `backend/src/server.ts` | Inyecta el repositorio de facultades | Sustituir por composición de AccountsService del PR |
| `backend/test/app.test.ts` | Agrega servicio simulado de facultades | Adaptar al contrato final de createApp |
| `frontend/src/app/app.routes.ts` | Ruta `/registro` con carga diferida | Conservar; el PR revisado no modifica este archivo |
| `frontend/src/app/app.ts` | Detecta ruta inicial e importa RouterLink | Combinar con restauración única y LoginDialog |
| `frontend/src/app/app.html` | Bienvenida solo en inicio y enlace Crear cuenta | Conservar bienvenida, outlet y agregar un único modal |
| `frontend/src/app/app.spec.ts` | Navegación y estado bloqueado con HTTP simulado | El PR lo elimina: preservar y adaptar, no aceptar esa eliminación |

### Reemplazos y eliminaciones

No se eliminaron archivos durante el trabajo preservado ni se reemplazaron archivos por versiones de HU-03.

Se propone eliminar `backend/src/modules/accounts/universities.repository.ts` únicamente después de migrar sus consumidores al módulo del compañero y verificar la consolidación. Las ocho líneas retiradas del commit inicial son cambios internos de archivos, no eliminaciones de archivos.

## 4. Arquitectura y contratos compartidos

### Endpoints

| Endpoint | Local actualmente | Contrato o comportamiento compartido |
| --- | --- | --- |
| `GET /api/universities` | Implementado y verificado históricamente | Público; 200 con `{ universities: [...] }`, incluso vacío; 503 si falla consulta |
| `POST /api/auth/login` | Solo en PR | 200 con AuthResponse y cookie; 400 por validación; 401 por credenciales incorrectas |
| `GET /api/auth/session` | Solo en PR | 200 con AuthResponse; 401 si sesión ausente, desconocida, vencida o revocada |
| `POST /api/auth/register` | Pendiente | 201 con AuthResponse y cookie; 400 por validación; 409 por correo ocupado |
| `POST /api/auth/logout` | Pendiente, fuera de esta integración | Contrato documentado: 204 y eliminación de cookie; 503 si no se confirma revocación |

### Estructuras

```typescript
type University = { id: string; name: string };
type UniversitiesResponse = { universities: University[] };
type RegisterRequest = {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  password: string;
};
type AuthResponse = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    university: University;
  };
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
};
```

Las fechas del contrato son RFC 3339 UTC. ErrorResponse contiene `error.code`, `error.message` en español y `error.fields` opcional para campos concretos. No se usan mensajes de texto para tomar decisiones de código ni se devuelven secretos.

### Validaciones, contraseñas y errores

- Reutilizar del PR `normalizeEmail`, `validEmail`, `validPassword`, `hashPassword` y `verifyPassword`.
- Normalización propuesta por esa implementación: trim y minúsculas; contraseña sin transformaciones silenciosas.
- Argon2id del PR: memoryCost 19456, timeCost 2 y parallelism 1.
- El PR limita contraseñas a 1024 bytes. Es un límite técnico adicional, pendiente de coordinar para HU-02; no es una política de complejidad.
- Registro debe comprobar facultad existente y mantener la unicidad de correo bajo concurrencia.
- Ampliar posteriormente AccountError para `EMAIL_ALREADY_REGISTERED` y su HTTP 409.
- El contrato distingue 500 inesperado de 503 por dependencia no disponible. El handler del PR convierte errores no reconocidos a 503; coordinar la clasificación antes de registro.

### Sesiones y cookies del PR

- Token aleatorio de 32 bytes en base64url; guardar solo su SHA-256 hexadecimal.
- Duración absoluta de seis horas, sin extensión por actividad.
- Reloj PostgreSQL y columnas con precisión de milisegundos.
- Cookie `biblioteca_session`: HttpOnly, SameSite=Lax, Path=/, Secure según producción, Max-Age de seis horas.
- Escrituras protegidas por `X-Biblioteca-Request: 1`.
- JSON de hasta 16 KiB; respuestas de cuentas con Cache-Control: no-store.
- Reutilizar la selección pública de usuario; excluir hash de contraseña y token del JSON.

### Estado Angular

Adoptar un único AuthService: sesión en memoria, restauración inicial, revalidación al recuperar foco y vencimiento. No crear un estado de autenticación paralelo en RegisterPage.

El método `accept()` del PR es privado. El registro deberá incorporarse dentro del servicio y reutilizar sus controles de respuestas fuera de orden, sin acceder a miembros privados desde la página ni ejecutar un login adicional después del registro.

## 5. Prisma original y base existente

El esquema local tiene generador y proveedor, pero aún no contiene modelos de dominio. La inspección histórica autorizada de Neon encontró `universities`, `users` y `sessions`; no se repite esa consulta para preparar esta documentación.

El PR aporta los modelos y el SQL originales. Se propone incorporarlos como fuente de diseño y mantener su historial, sin reconstruir migraciones ni crear tablas equivalentes. Los CHECK de correo, hash y duración están en SQL y no deben perderse por revisar únicamente schema.prisma.

No volver a ejecutar la migración ni el seed sobre la rama existente. La comprobación histórica encontró las 30 facultades documentadas, con coincidencia exacta y sin duplicados. La copia interna del modelo usa `faculties` y `email_normalized`, distintos de la estructura inspeccionada y del PR; coordinar su documentación sin modificar la base.

## 6. Decisiones de integración y conflictos previstos

| Diferencia | Solución propuesta | Estado |
| --- | --- | --- |
| Endpoint de facultades duplicado | Conservar controller → AccountsService → PrismaAccountsRepository del PR | No aplicada |
| Orden SQL local frente a comparación española del PR | Conservar el orden del repositorio del PR, sin cambiar contrato | No aplicada |
| app.ts y server.ts de backend modificados por ambos trabajos | Componer una sola instancia compartida de cuentas y conservar salud | No aplicada |
| Raíz Angular modificada por ambos trabajos | Conservar bienvenida y `/registro`; agregar modal y restore una vez | No aplicada |
| PR elimina app.spec.ts | Conservar pruebas locales y simular la consulta inicial de sesión | No aplicada |
| Modelo local vacío | Incorporar esquema y migraciones originales del compañero | No aplicada |
| Nombre visible facultad frente a universidad | Mantener contrato técnico y coordinar vocabulario visible | Pendiente |
| createSession abre su propia transacción | Para registro, ampliar repositorio con creación atómica de usuario y sesión | Fuera de la integración inicial |
| Landing fuera del PR | Acordar ruta y responsable; bienvenida actual no equivale a landing definitiva | Pendiente |

Los conflictos de app.ts, app.html y server.ts son previsibles por comparación de contenido; no se ejecutó merge para producir marcadores. En app.spec.ts existe oposición directa entre modificación local y eliminación en el PR.

El árbol completo del commit revisado no incluye varios archivos referenciados por sus README: contrato de autenticación, guía de SCRUM-8, ADR-0002, convenciones de UI y auth-flow.spec.ts. Solicitar sus originales o acordar corrección de referencias; no atribuirles contenido no revisado.

## 7. Plan de incorporación por grupos

Cada grupo requiere autorización antes de modificar archivos. La existencia de este plan no autoriza operaciones Git, consultas o pruebas por sí misma.

### Grupo 0 — Preparación

- HU-02 ya está preservada en su rama y commit inicial.
- Acordar versión de HU-03 y responsables de archivos compartidos.
- Confirmar estado limpio y detener servidores de desarrollo, con autorización, antes de una futura integración para evitar recargas automáticas.
- Incorporar este registro documental al historial únicamente cuando se autorice su commit.

### Grupo 1 — Modelo de datos original

Incorporar directamente los archivos nuevos:

```text
backend/prisma/migrations/20261022170000_accounts_and_sessions/migration.sql
backend/prisma/migrations/migration_lock.toml
backend/prisma/seed.ts
backend/prisma/universities.ts
```

Revisar y reemplazar el esquema vacío por la versión original compatible de `backend/prisma/schema.prisma`. No aplicar SQL ni ejecutar seed. Verificación propuesta: revisión de mapeos, generación local del cliente y compilación autorizadas, sin conexión a Neon.

### Grupo 2 — Módulo backend de cuentas

Incorporar los originales del PR, si no existe trabajo nuevo en esas rutas:

```text
backend/src/accounts/accounts.controller.ts
backend/src/accounts/accounts.service.ts
backend/src/accounts/accounts.repository.ts
backend/src/accounts/prisma-accounts.repository.ts
backend/src/accounts/credentials.ts
backend/src/accounts/sessions.ts
backend/test/auth-http.test.ts
backend/test/integration/login.test.ts
```

Verificación propuesta: imports, compilación y pruebas unitarias con repositorio simulado. La prueba de integración real no se ejecuta: crea, actualiza y elimina registros usando la conexión configurada.

### Grupo 3 — Composición Express y facultades

Combinar `backend/src/app.ts`, `backend/src/server.ts`, `backend/test/app.test.ts` y `backend/test/universities.test.ts`. Dejar una sola ruta de facultades. Retirar el repositorio local redundante solo tras adaptar consumidores y con autorización de eliminación.

Verificación propuesta: casos públicos 200, vacío y 503, rutas de salud, ausencia de detalles internos y compilación. Sin pruebas reales de base en este grupo.

### Grupo 4 — Autenticación Angular

Incorporar directamente los originales:

```text
frontend/src/app/auth/auth.types.ts
frontend/src/app/auth/auth.service.ts
frontend/src/app/auth/auth.service.spec.ts
frontend/src/app/auth/login-dialog.ts
frontend/src/app/auth/login-dialog.html
frontend/src/app/auth/login-dialog.css
```

Verificación propuesta: pruebas del servicio y compilación, con HTTP simulado. Preservar vencimiento y protección frente a respuestas antiguas.

### Grupo 5 — Raíz y navegación

Combinar `frontend/src/app/app.ts`, `frontend/src/app/app.html` y `frontend/src/app/app.spec.ts`. Conservar app.routes.ts, los cuatro archivos de Register, los cuatro de RegisterPage y UniversitiesService con sus pruebas.

La bienvenida permanece solo en `/`; el outlet queda fuera de su condición; se monta un único LoginDialog. Restore se llama una sola vez desde App. Adaptar las pruebas de App para responder a la consulta inicial de sesión con HTTP simulado, conservando navegación, facultades y bloqueo de registro.

### Grupo 6 — Documentación y complementos

Revisar por separado:

```text
CONTEXT.md
README.md
backend/README.md
frontend/README.md
backend/package.json
backend/prisma.config.ts
backend/src/env.ts
frontend/src/index.html
```

No copiarlos ciegamente: coordinar vocabulario y enlaces, revisar scripts de migración y seed sin ejecutarlos. El cambio de formato de env.ts puede omitirse; la traducción de index.html es complementaria.

### Grupo 7 — Verificación conjunta y revisión

Ejecutar pruebas unitarias y compilaciones solo con autorización. No asumir que las cifras históricas siguen siendo válidas después de integrar. Revisar navegación, restauración, login y facultades con simulaciones antes de autorizar cualquier prueba real.

El futuro PR de HU-02 puede apuntar inicialmente a HU-3-Inicio-Sesion para mostrar el trabajo propio sobre la arquitectura compartida. Si HU-03 se integra en develop, revisar su método de integración, alinear la rama de HU-02 y verificar el diff antes de cambiar la base del PR. No se publica ni se integra nada como parte de esta documentación.

## 8. Verificaciones históricas

Estos resultados corresponden al código local anterior a HU-03. No se volvieron a ejecutar para crear este archivo y no verifican una combinación futura.

| Verificación | Resultado registrado |
| --- | --- |
| Formulario inicial Register | 15 pruebas aprobadas; compilación Angular exitosa |
| Integración visual Register, RegisterPage y App | 26 pruebas aprobadas; compilación Angular exitosa |
| Última suite local de backend | 4 pruebas aprobadas, 0 fallidas |
| Última suite local de frontend | 35 pruebas aprobadas, 0 fallidas |
| Última compilación backend | Exitosa |
| Última compilación Angular de producción | Exitosa |
| Advertencia del paquete inicial Angular | 509,14 kB; excede en 9,14 kB el umbral de advertencia de 500 kB |
| Express → Neon, consulta autorizada de facultades | HTTP 200, 30 elementos, solo id y name, UUID válidos y sin duplicados |
| Comparación histórica con historias Markdown | 30 nombres coincidentes; sin faltantes, adicionales ni diferencias |
| Proxy Angular → Express → Neon | HTTP 200 y las mismas 30 facultades |
| Ruta /registro | Respuesta HTML HTTP 200; no equivale a revisión visual completa en navegador |

Comandos de la última verificación automatizada local:

```powershell
npm.cmd run test --workspace backend
npm.cmd run test --workspace frontend
npm.cmd run build --workspace backend
npm.cmd run build --workspace frontend
```

Las pruebas backend usan servicios simulados y servidores HTTP locales de prueba. Las de Angular usan HttpTestingController; no consultan Neon. Las verificaciones restringidas por el sandbox se reintentaron fuera de él con autorización. La compilación backend generó el cliente Prisma local, sin aplicar migraciones.

La integración real se verificó con los comandos de desarrollo existentes y solicitudes GET autorizadas. No se crearon cuentas ni sesiones. Se observó una advertencia del controlador PostgreSQL sobre la interpretación futura de modos SSL; no se cambió configuración.

Las pruebas del PR no se ejecutaron en esta sesión. Las declaraciones de su autor sobre resultados no se confunden con verificaciones propias. Permanecen pendientes pruebas de la combinación, registro real y una revisión visual completa.

## 9. Trabajo posterior de registro y coordinación

No forma parte de la integración inicial implementar POST /api/auth/register.

Para esa etapa se propone validar entradas y facultad, normalizar correo, calcular Argon2id fuera de la transacción y crear usuario y sesión juntos. Emitir cookie y AuthResponse después del commit; mapear duplicado de correo a 409; no llamar a login nuevamente.

AccountsRepository necesitará una operación atómica de registro. La creación interna de sesión debería reutilizarse dentro de la transacción correspondiente, sin llamar después a createSession como una operación independiente. Coordinar qué ocurre con una sesión anterior del mismo navegador.

Pruebas pendientes: registro correcto, correo normalizado duplicado y concurrencia, entradas inválidas, facultad inexistente, rollback si falla sesión, respuestas sin secretos, errores HTTP y navegación con estado autenticado. Las pruebas con escrituras requieren entorno y autorización específicos.

### Coordinación de HU-02 con HU-03

- Login conserva la página abierta; el registro debe navegar a la landing según HU-02. Son comportamientos diferentes que deben coexistir.
- La landing y su ruta definitiva requieren acuerdo con su responsable.

## 10. Registro de cambios

### 2026-10-22 — Preservación inicial de HU-02

- Estado: implementado; verificaciones funcionales históricas anteriores al commit.
- Objetivo: preservar formulario, navegación y facultades sin publicar cambios.
- Rama: feature/hu-02-registro.
- Commit: `195f5f52a82059550e362db55565c72f5a2571ec`.
- Archivos: los 12 nuevos y 7 modificados enumerados en la sección 3; ninguno eliminado.
- Decisiones: rutas explícitas al preparar el commit; mantener registro bloqueado; no incorporar HU-03 todavía.
- Verificación: revisión del diff preparado, estado, commit y permanencia de main en su base anterior. Directorio limpio al finalizar. No se repitieron pruebas ni compilaciones en la operación de commit.
- Problemas: el sandbox bloqueó escrituras en Git; reintentos autorizados. Avisos de futura conversión LF→CRLF, sin cambios de configuración.
- Dependencias: arquitectura y archivos originales del PR #1.
- Pendiente: documentación inicial e integración por grupos; sin push ni PR de HU-02.

### 2026-10-22 — Documentación técnica inicial

- Estado: documento creado, sin add ni commit.
- Historia: HU-02 e integración con HU-03.
- Objetivo: registrar alcance local, procedencia del PR, contratos, conflictos y plan.
- Archivo creado: `docs/integracion-hu02-hu03.md`.
- Archivos de código modificados o eliminados: ninguno.
- Verificación: lecturas locales y comandos Git de consulta para confirmar rama, commit, inventario y ausencia previa de este archivo. No se ejecutan pruebas ni compilaciones.
- Decisiones: separar implementado, verificado históricamente y propuesto; no incluir credenciales ni conexiones privadas.
- Dependencias: confirmación del compañero sobre responsabilidades, landing, contrato y archivos referenciados ausentes.
- Pendiente: revisión del documento, autorización de su commit y del primer grupo de integración.

### Plantilla para próximas etapas

```markdown
### AAAA-MM-DD — Etapa N: nombre

- Historia de usuario:
- Estado: propuesta / implementada / verificada.
- Objetivo:
- Referencia de origen y commit:
- Archivos creados: ruta y función.
- Archivos modificados: ruta y cambio concreto.
- Archivos eliminados: ruta, sustitución y autorización.
- Decisiones técnicas y justificación:
- Conflictos y resolución aplicada:
- Pruebas o comandos ejecutados y resultados:
- Problemas encontrados y causa confirmada o probable:
- Dependencias con otros integrantes; responsables solo cuando estén confirmados:
- Cambios pendientes:
```

Actualizar este registro en cada etapa implementada. No marcar una etapa como verificada por copiar archivos o por reutilizar resultados anteriores. Conservar las referencias de commits y diferenciar cambios propios de código incorporado del compañero.
