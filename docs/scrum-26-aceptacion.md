# SCRUM-26 — Aceptar un cupo reservado

Fuentes verificadas el 01/11/2026: [SCRUM-26](https://joaquincastellano350.atlassian.net/browse/SCRUM-26),
épica SCRUM-19, PRD v7, ADR-001 v2, modelo de Confluence v4 y ADR de notificaciones v3.
Se conserva el estado DRAFT del modelo. La referencia visual es el HTML de `docs/referencias/`.

## Flujo y criterios de aceptación

1. **Mis préstamos:** cada reserva vigente ofrece «Aceptar préstamo». La acción no
   se deshabilita por tener cinco préstamos: el backend debe procesar el rechazo y
   liberar el cupo inmediatamente. Después se actualiza la lista y se conserva el
   motivo o la confirmación en la página. El nuevo préstamo usa la lectura de SCRUM-22.
2. **Correo:** los nuevos avisos de turno enlazan `/turno/:reservationId`. La página
   intenta aceptar automáticamente al confirmar la sesión. Si no hay sesión, abre
   el login existente y continúa después de autenticarse, sin segunda confirmación.
   Cerrar el login no crea un bucle; la reserva permanece identificada en la URL.
3. **Privacidad:** el POST exige sesión y protección de escritura. El identificador
   no es una credencial. Una reserva ajena y una inexistente devuelven el mismo
   resultado, sin revelar su titular, estado ni préstamo, y sin modificarla.
4. **Reglas:** PostgreSQL decide la hora. Se verifica de nuevo el plazo justo antes
   del consumo; `expires_at <= t` rechaza. Se cuentan los préstamos vigentes, sin
   contar las reservas ni los préstamos vencidos pendientes de cierre.
5. **Aceptación válida:** la reserva pasa a CONSUMED, la entrada a FULFILLED y se
   crea un préstamo vinculado de 480 horas desde la aceptación, con sus tres avisos.
   Todo se confirma en una sola transacción. La ocupación pasa de reserva a préstamo.
6. **Límite:** reserva y entrada pasan a REJECTED_LIMIT, con cierre, y se invoca la
   liberación/conciliación compartida de SCRUM-25 en la misma transacción. Se ofrece
   a la siguiente persona elegible o queda libre. El resultado de negocio se
   devuelve como valor para confirmar los cambios antes de informar el rechazo.
   No se agrega otro correo de rechazo al aceptar, según el modelo §8.
7. **Repeticiones:** CONSUMED devuelve el préstamo original; si ya terminó, lo
   informa sin ofrecer lectura. EXPIRED, CANCELLED y REJECTED_LIMIT conservan su
   resultado terminal, aunque después baje la cantidad de préstamos del titular.

Un fallo temporal permite reintentar. El frontend evita doble clic y descarta
respuestas de una cuenta/ruta anterior. El backend garantiza idempotencia incluso
entre pestañas; no depende del bloqueo visual del botón.

## Contrato HTTP

`POST /api/reservations/:reservationId/accept`, JSON `{}`, cookie de sesión y
`X-Biblioteca-Request: 1`. No acepta una identidad proporcionada por el cliente.
Respuestas privadas con `Cache-Control: no-store`. GET nunca concede préstamos.

| Resultado | HTTP | Respuesta |
| --- | --- | --- |
| Nuevo préstamo | 201 | `{ loan: { id, bookId, startedAt, dueAt }, created: true, active: true }` |
| Aceptación repetida | 200 | Mismo préstamo, `created: false`, `active` según reloj y cierre |
| Ajena o inexistente | 404 | `RESERVATION_NOT_FOUND` |
| Vencida | 409 | `RESERVATION_EXPIRED` |
| Cancelada | 409 | `RESERVATION_CANCELLED` |
| Rechazada por cinco préstamos | 409 | `RESERVATION_REJECTED_LIMIT` |
| UUID inválido / sin sesión / sin protección | 400 / 401 / 403 | Error controlado |

Se reutilizan `circulationTransaction` (SERIALIZABLE y reintentos limitados),
`reconcileBooks`, `releaseReservation` y `scheduleLoanNotifications`. La aceptación
bloquea estudiante y después libro en el mismo orden que la concesión directa,
para proteger el límite entre libros distintos. Las consultas de entidades usan
Prisma; SQL se limita a los bloqueos y al reloj que Prisma no expresa.

## Enlaces de correo y compatibilidad

El productor de nuevos TURN_AVAILABLE guarda `acceptancePath: /turno/{id}` en
payload. El emisor valida que corresponda a la reserva y construye el enlace con
el origen configurado, tanto en HTML como en texto. El botón de esos avisos dice
«Aceptar préstamo» y el texto aclara la continuación automática. No agrega tokens
ni modifica el transporte, las claves ni los plazos de reintento de SCRUM-28.

Los avisos históricos sin ese campo conservan su mensaje y enlace a `/prestamos`;
desde allí se puede aceptar con el nuevo botón. Esto evita cambiar el contenido
de un envío incierto que Resend podría haber aceptado ya. Los correos antiguos
que ya se enviaron no contienen el identificador necesario para aceptación
automática y no pueden convertirse retroactivamente en enlaces de reserva.

## Límites con las otras historias

| Historia | Integración de SCRUM-26 |
| --- | --- |
| SCRUM-20 | Reutiliza el contrato del préstamo; no agrega otra solicitud directa ni su confirmación. |
| SCRUM-21 | Agrega la acción a su listado y actualiza el estado compartido después de aceptar/rechazar. |
| SCRUM-22 | Reutiliza el botón y API de lectura del préstamo concedido. |
| SCRUM-23/24 | No agrega entrada ni salida de colas, ni «Dejar pasar el turno» de la maqueta. |
| SCRUM-25 | Invoca la conciliación/liberación existentes y completa el destino del aviso. No implementa otro asignador de turnos. |
| SCRUM-27 | Reutiliza el cierre de vencidos existente; no agrega procesos periódicos ni cambia duraciones. |
| SCRUM-28 | Programa los tres avisos mediante la función compartida. No cambia entrega, recuperación ni proveedor. |

No hay nuevas tablas, migraciones, cargas iniciales, dependencias, renovaciones,
devoluciones anticipadas, administración ni pantalla de historial.

## Verificación reproducible

Desde la raíz, con Node 24.15+ de la rama 24 y npm 11+:

```sh
npm test --workspace backend
npm test --workspace frontend
npm run build
npm run test:e2e --workspace frontend
```

`reservation.test.ts` usa PostgreSQL embebido y Prisma con las migraciones reales:
consumo, repetición tras vencimiento, privacidad, rechazo con/sin sucesor elegible,
cierre terminal, rollback si falla outbox y límite exacto alcanzado durante la petición.
`reservation-http.test.ts` cubre sesión, protección de escritura, identidad y errores.
Los tests de mensajes comprueban enlaces nuevos e históricos.

`test:turns:integration` incluye además SCRUM-26 y sus carreras en PostgreSQL 17:
dos aceptaciones de una reserva, dos reservas distintas con cuatro préstamos y
aceptación simultánea con préstamo directo. Usa la base local exclusiva nueva y
vacía `ics_turns_test`, usuario `turns_test_admin`, host `127.0.0.1`, puerto `55435`
(o `45435` si Windows reserva el habitual), `TEST_TURNS_DATABASE_URL` y
`TURNS_ALLOW_INTEGRATION_WRITES=1`. No carga credenciales de Neon.
La misma suite ya está incluida en CI mediante el paso existente de turnos.

Las pruebas Angular cubren login y continuación, 401 durante aceptación, doble
clic, terminales, reintento explícito, navegación, cambio de cuenta y mensajes
que sobreviven al refresco de Mis préstamos. Playwright cubre las dos entradas,
la repetición y el rechazo en escritorio, tablet y móvil, con HTTP simulado.
Estas pruebas no envían correos externos ni modifican la base compartida.

Verificación local del 01/11/2026: 291 pruebas de backend, 314 de frontend,
25 de integración de turnos/aceptación en PostgreSQL 17 y 90 de Playwright
aprobadas. Ambas aplicaciones compilaron; siguen las advertencias de presupuesto
del bundle inicial y del CSS del catálogo. Tras ajustar el texto del botón del
correo se repitieron 34 pruebas de mensajes, turnos y avisos, y la compilación
del backend, con resultado satisfactorio. El contenedor local de pruebas se eliminó.
