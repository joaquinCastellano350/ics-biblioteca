# SCRUM-28 — Recibir avisos de vencimiento

Implementación de [HU-09](https://joaquincastellano350.atlassian.net/browse/SCRUM-28),
siguiendo el vocabulario de `CONTEXT.md`, el contexto de circulación y el modelo
de datos §§4–8 y 10. Se reutilizan los módulos de correo conservados en el stash
de SCRUM-25, sin incorporar su conciliación ni consumir el stash.

## Comportamiento

El préstamo directo llama a `scheduleLoanNotifications` dentro de su transacción:

| Tipo | Momento programado | Clave estable |
| --- | --- | --- |
| LOAN_DAY_10 | Inicio + 240 horas | `loan:{id}:day10` |
| LOAN_DUE_IN_3_DAYS | Vencimiento − 72 horas | `loan:{id}:due3` |
| LOAN_EXPIRED | Vencimiento | `loan:{id}:expired` |

Los tres registros se confirman junto con el préstamo. Un fallo revierte todo;
repetir la concesión o programar otra vez conserva las mismas filas, incluso si
ya se enviaron. El destinatario, título e instantes se guardan en el outbox. Los
correos identifican el libro y su vencimiento en UTC y enlazan a `/prestamos`.
El envío posterior no depende de la sesión del estudiante ni autoriza lectura.

El emisor usa el reloj de PostgreSQL y reclama solo avisos cuyo `scheduled_at`
y `next_attempt_at` ya llegaron. Si un ciclo llega tarde, procesa también los
recordatorios atrasados: cerrar un préstamo no cancela sus avisos. El texto
advierte sobre las demoras y conserva la fecha original de vencimiento. No se
guardan claves de PDF, URLs firmadas o sesiones en los mensajes.

## Entrega, fallos e idempotencia

`NotificationRepository` reclama una fila con `FOR UPDATE SKIP LOCKED`, token UUID
y concesión de 60 segundos. Confirma la reclamación antes de llamar a Resend por
HTTPS, con timeout de 15 segundos. Un proceso interrumpido deja la fila recuperable
cuando vence la concesión. Confirmar, cancelar o reprogramar exige el token vigente
y una concesión no vencida. Se comprueba el titular del origen antes de enviar;
los avisos de turno conservan además su validación de reserva y plazo.

Los fallos de red, cuota, cuenta y servicio conservan `PENDING`, incrementan los
intentos y aplican espera creciente de 30 segundos hasta una hora. Un payload
inválido o error permanente queda en `FAILED` con un código controlado; nunca se
guarda el cuerpo del error del proveedor. `SENT` significa aceptado por el
proveedor, no confirma por sí solo recepción en la bandeja del destinatario.

La clave única evita duplicados en la base. Se envía la misma `dedup_key` como
`Idempotency-Key`, con el mismo contenido en cada reintento.
[Resend conserva estas claves durante 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys).
`first_attempt_at` registra la primera reclamación de forma durable. Después de
23 horas se conserva el aviso en `FAILED / DELIVERY_WINDOW_EXPIRED` para revisión,
sin volver a llamar al proveedor: no se promete idempotencia externa ilimitada.
El margen de una hora cubre la llamada y la recuperación. El tiempo transcurrido
antes del primer intento no consume esa ventana.

Tras corregir un fallo permanente puede reprogramarse la misma fila como PENDING,
manteniendo clave, payload y `first_attempt_at`, si sigue dentro de la ventana.
Fuera de ella hay que comprobar el resultado en Resend antes de resolver el
aviso; no se debe reiniciar la ventana o crear otra fila para forzar un envío.
La migración nueva marca los avisos que ya tenían intentos con una fecha pasada
para evitar reenvíos automáticos cuyo primer instante se desconoce. Los avisos
SENT conservan su estado y los nunca intentados siguen procesándose normalmente.

## Ejecución y activación

El comando termina después de procesar hasta 20 avisos y desconecta la base:

```sh
npm run db:generate --workspace backend
npm run notifications:deliver --workspace backend
```

Necesita `DATABASE_URL`, `RESEND_API_KEY`, `MAIL_FROM` (remitente verificado) y
`PUBLIC_WEB_ORIGIN` (origen de la web, sin ruta, credenciales ni parámetros).
`.env.example` documenta los nombres sin valores reales.

El workflow `.github/workflows/notifications.yml` prepara la ejecución externa
del ADR: una vez por hora, al minuto 17, y manualmente desde Actions. Se activa
cuando esté en la rama predeterminada, con estas condiciones:

1. Aplicar las migraciones versionadas en la rama correcta de Neon. La nueva
   migración agrega `first_attempt_at`; ningún arranque aplica migraciones.
2. Configurar los secretos `NOTIFICATIONS_DATABASE_URL`, `RESEND_API_KEY`,
   `MAIL_FROM` y `PUBLIC_WEB_ORIGIN` del repositorio. La conexión del emisor usa
   el mismo destino que la API y permanece fuera del frontend.
3. Configurar la variable del repositorio `NOTIFICATIONS_ENABLED=true` después
   de verificar el remitente y el destino. Sin ella el job permanece desactivado.
4. Ejecutar manualmente con un buzón de prueba autorizado y comprobar recepción.

El workflow usa dependencias bloqueadas, acciones fijadas a SHA, permisos de
lectura y exclusión entre ejecuciones. La base coordina también otros emisores.
No depende de que Express permanezca despierto. Actions puede demorar u omitir
ciclos, según la [documentación de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule);
el siguiente conserva el trabajo pendiente. Si quedan más de 20 avisos,
las siguientes ejecuciones continúan desde las filas pendientes.

Esta entrega prepara la activación; no configura secretos, aplica migraciones
a Neon, publica el workflow ni envía correos reales.

## Dependencias e integración

| Historia | Integración |
| --- | --- |
| SCRUM-20 | Concesión directa y programación atómica implementadas. |
| SCRUM-25 | Se reutilizan contrato, adaptador y emisor del stash. La conciliación queda separada. Al integrar esa historia debe conservarse este emisor extendido y evitar reemplazarlo por la versión que solo reclama turnos. |
| SCRUM-26 | Al crear un préstamo por aceptación debe llamar a `scheduleLoanNotifications(tx, loan)` antes del mismo COMMIT. El endpoint aún pertenece a esa historia; el emisor ya admite avisos de cualquier préstamo válido. |
| SCRUM-27 | El cierre de un préstamo debe conservar el aviso LOAN_EXPIRED existente. El emisor lo entrega aunque `closed_at` ya esté informado. |

Los avisos se programan desde la concesión, como pide §8; no se crean en cada
ciclo ni se requiere esperar al procesamiento de vencimientos. La ejecución es
externa según ADR-001; no se incorpora el temporizador interno del stash de
SCRUM-25. Esta diferencia debe conservarse al integrar ambas historias.

## Verificación

`backend/test/loan-notifications.test.ts` usa Prisma y PostgreSQL embebido en
memoria con las migraciones reales. Comprueba fechas 240/408/480 horas, exclusión
de avisos futuros, espera de reintento, recuperación tras caída y tokens antiguos,
ciclo tardío con préstamo cerrado, destinatario, contenido, respuesta perdida,
ventana de idempotencia, FAILED y recuperación de la misma fila. El proveedor es
simulado y no necesita credenciales. `loan-repository.test.ts` mantiene la prueba
de reversión conjunta del préstamo y sus tres avisos.

Las llamadas simultáneas en PGlite comparten una conexión; no demuestran
contención multiconexión en PostgreSQL externo. La recepción real y la ejecución
programada se verifican al activar los servicios.

Verificación del 28/10/2026: suite completa del backend, 192 pruebas aprobadas.
Después de añadir el escenario de compatibilidad con turnos, los 14 casos de la
suite de avisos pasaron. Compilaciones de backend y frontend, validación Prisma
y `git diff --check` correctos. Angular conserva sus avisos previos de presupuesto
del bundle y estilos del catálogo. Docker no estaba en ejecución; no se probó
contención multiconexión ni entrega real mediante Resend.

## Configuración local de Resend verificada

Se conectó la cuenta mediante el complemento oficial, sin automatizar el navegador.
En la primera prueba la cuenta no tenía dominio propio, por lo que se configuró el modo de
pruebas: `MAIL_FROM="Biblioteca Digital Universitaria <onboarding@resend.dev>"` y
`PUBLIC_WEB_ORIGIN=http://localhost:4200`. La clave `Biblioteca - pruebas locales`
tiene permiso `sending_access` y se guarda como `RESEND_API_KEY` en `.env.local`,
excluido de Git. La clave de administración no se usa en la aplicación.

La verificación real utilizó una base PGlite en memoria, las migraciones
versionadas, una sesión válida y `POST /api/loans`, que respondió 201 y confirmó
los tres avisos. Se aceleraron únicamente las fechas de los datos sintéticos,
conservando las 480 horas del préstamo. El emisor real envió los tres tipos al
buzón de prueba indicado por el titular. Resend confirmó `delivered` para los tres.
Repetir el primer mensaje con la misma clave devolvió el mismo ID de correo.

La evidencia queda en `output/resend-setup-result.json`, excluida de Git; contiene
los IDs y estados de entrega, sin credenciales. Esta prueba verifica entrega real
y deduplicación del proveedor dentro de su ventana, además de la prueba simulada
registrada arriba. No verifica contención multiconexión ni el workflow desplegado.

Sin dominio verificado, Resend restringe el remitente de prueba al correo de la
cuenta y a sus direcciones de prueba; no habilita el envío general a estudiantes.
Ver la [guía de configuración de Resend](https://resend.com/setup.md). Para activar
el procesamiento desplegado sigue pendiente configurar los secretos
y la variable de habilitación del workflow. Esta configuración local no aplica
migraciones ni cambia datos en la rama compartida de Neon.

El titular registró después `uniread.tech` y cargó los registros DNS. El
31/10/2026 Resend confirmó `mail.uniread.tech` como `verified`, incluidos DKIM,
MX y TXT de SPF y CNAME. DMARC también se comprobó en DNS público. Se actualizó
el remitente local a `avisos@mail.uniread.tech`; ver el
[registro de configuración DNS](resend-uniread-dns.md).

Se repitió el recorrido real con ese remitente y la base aislada en memoria:
`POST /api/loans` respondió 201, los tres avisos quedaron SENT y Resend confirmó
`delivered` para los tres correos. Repetir el primero con la misma clave devolvió
el mismo ID, sin duplicar el correo. La evidencia actualizada está en
`output/resend-setup-result.json`; la prueba anterior con `onboarding@resend.dev`
se conservó en `output/resend-setup-test-sender-result.json`. Ambos están excluidos
de Git. El workflow y la base compartida siguen pendientes de su activación.
