# Persistencia de circulación para SCRUM-18

La migración `20261026000000_circulation_availability` incorpora `loans`,
`queue_entries` y `reservations` y sus relaciones Prisma. Sigue el
[modelo de Confluence v4](https://joaquincastellano350.atlassian.net/wiki/spaces/SCRUM/pages/6389762).
No modifica las migraciones anteriores ni carga datos.

Los préstamos duran 480 horas y las reservas 24 horas. Las FK compuestas impiden
asociar una reserva o un préstamo con un usuario o libro distintos de su origen.
Solo puede haber una espera abierta y un préstamo sin cerrar por usuario y libro,
una reserva por entrada y un préstamo por reserva. Los registros terminales se
conservan. Los estados y cierres se validan con CHECK; el orden de espera usa una
identidad bigint y los índices de consultas abiertas son parciales.

Los CHECK, los índices parciales y `GENERATED ALWAYS AS IDENTITY` se mantienen en
SQL. Prisma necesita además claves únicas compuestas para representar las
relaciones 1:1, aunque los identificadores de origen ya sean únicos por separado.

## Base compartida de circulación

`backend/src/circulation/` contiene únicamente lo necesario para la disponibilidad:

- `circulation.ts`: contratos de ocupación interna y disponibilidad pública.
- `circulation-repository-interface.ts`: consulta de ocupación por IDs de libros.
- `circulation-repository.ts`: transacción SERIALIZABLE y reintentos limitados.
- `circulation-reconciler.ts`: cierres, rechazos y ofertas persistidos con Prisma.
- `circulation-controller.ts`: calcula los cupos solicitables.

No hay archivo de rutas porque SCRUM-18 no necesita otro endpoint: el controlador
del catálogo integra esta lectura por lote en el `GET /api/books` existente.
Cada libro devuelve `availability: { availableCopies, totalCopies }` junto con
sus metadatos. El frontend los recibe en una sola llamada y muestra el conteo
y el grisado cuando es cero, conservando la legibilidad. No se usa opacidad ni
se deshabilita la tarjeta completa. Se actualiza al entrar, recargar o cambiar
filtros; no hay polling. La acción de cola se integrará en SCRUM-23.

Un préstamo vigente exige `started_at <= t < due_at` y `closed_at IS NULL`;
una reserva vigente exige `state = 'HELD'` y `expires_at > t`.
El instante `t` procede de PostgreSQL. La disponibilidad no es un contador
persistido: es total menos préstamos vigentes y reservas vigentes, después de
respetar la prioridad de la cola.

Antes de devolver la disponibilidad se cierran vencimientos pendientes y se
atiende WAITING por `order_seq`, hasta agotar capacidad o cola. Si al llegar su
turno el estudiante tiene cinco préstamos vigentes, la entrada pasa a
REJECTED_LIMIT con `closed_at`; bajar luego a cuatro no la reactiva. Para cada
persona elegible se crea una reserva HELD de 24 horas y la entrada pasa a OFFERED.
El conteo descuenta esas reservas reales; ya no resta una proyección de esperas.

Las operaciones usan Prisma dentro de SERIALIZABLE y bloquean los libros por ID
ascendente. Las únicas consultas SQL explícitas son `FOR UPDATE` (Prisma no expone
ese bloqueo) y el reloj de PostgreSQL obtenido después de adquirir los bloqueos.
Los conflictos de serialización/interbloqueos reintentan la transacción completa,
hasta tres intentos; al agotarlos se responde el error recuperable del catálogo.

La nueva migración `20261027000000_circulation_outbox` crea `notification_outbox`
según el modelo compartido. Rechazos y ofertas registran avisos PENDING en su
misma transacción, con claves únicas de deduplicación. No se envían correos ni
se implementa un worker: la entrega queda pendiente de la historia de avisos.
Ver [la conciliación y sus pruebas de regresión](scrum-18-conciliacion.md).

El límite de cinco préstamos, la capacidad simultánea, la coherencia entre
transiciones de varias tablas y la prioridad de la cola requieren transacciones
en los servicios de circulación. No quedan garantizados por esta migración.
Las futuras escrituras de préstamos/colas deben reutilizar el mismo protocolo;
sus endpoints y el envío de avisos no se incorporan en esta corrección.

SCRUM-18 muestra la disponibilidad. Solicitar un préstamo es SCRUM-20, entrar a
la cola es SCRUM-23, ofrecer turnos es SCRUM-25, aceptar reservas es SCRUM-26 y
procesar vencimientos es SCRUM-27. SCRUM-23 queda pendiente de desarrollo e
integración por su responsable; no se agrega una acción de cola simulada.
La conciliación es lógica interna reutilizable;
no requiere una entidad persistida ni un endpoint público propio.

La migración se valida junto con las anteriores en PostgreSQL aislado en memoria
(PGlite). No se aplica al iniciar la API. Para desplegarla se usa el flujo de
migraciones del README, comprobando antes la rama de destino.

## Aplicación a Neon — 26/10/2026

Se aplicó `20261026000000_circulation_availability` mediante `prisma migrate deploy`
al proyecto `odd-base-60911651`, rama `production` (`br-patient-cloud-b4v02aqf`),
base `neondb`, esquema `public`. La conexión directa se contrastó con el endpoint
de esa rama antes de escribir. Las dos migraciones anteriores coincidían con sus
archivos locales por SHA-256 y solo estaba pendiente la nueva migración.

La aplicación terminó a las 22:05:35 UTC (19:05:35 de Argentina). Se comprobó:

- Historial de Prisma actualizado, sin migraciones pendientes; checksum de la
  migración aplicada idéntico al archivo local y sin marca de rollback.
- Tres tablas con sus PK, ocho FK, ocho CHECK y dieciocho índices en total.
- `queue_entries.order_seq` como `GENERATED ALWAYS AS IDENTITY`.
- Tablas de circulación vacías; se conservan cinco libros, tres usuarios y ocho
  autores, las mismas cantidades verificadas antes de aplicar la migración.
- Un servidor HTTP temporal con el código actual y la conexión habitual de la
  API a Neon respondió 200 a `GET /api/books`: cinco libros con disponibilidad
  `1/1` cada uno. Esa comprobación solo leyó datos; no cargó préstamos ni esperas.

La rama `dev-scrum8-login` no se modificó. No se ejecutaron reset, push de esquema
ni carga inicial: Prisma conserva el historial de migraciones versionadas.
