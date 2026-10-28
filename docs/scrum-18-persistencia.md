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

## Base compartida de lectura

`backend/src/circulation/` contiene únicamente lo necesario para la disponibilidad:

- `circulation.ts`: contratos de ocupación interna y disponibilidad pública.
- `circulation-repository-interface.ts`: consulta de ocupación por IDs de libros.
- `circulation-repository.ts`: conteos Prisma y rechazo por límite al llegar el turno.
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

Hasta implementar la asignación de turnos, la lectura también retiene del conteo
los cupos pendientes para entradas WAITING elegibles: el estudiante tiene menos
de cinco préstamos vigentes y no tiene prestado ni reservado ese mismo libro.
Por ejemplo, dos cupos libres y una espera elegible dejan uno solicitable.
Las reservas HELD vigentes ya se descuentan por separado. Las lecturas de Prisma
se ejecutan en una transacción `Serializable`, con bloqueos de libros por ID
ascendente y hasta tres intentos ante serialización o interbloqueo.
Se usa `findMany`, `select`, filtros de relaciones y `_count`: no se escriben a
mano los joins ni las subconsultas de ocupación. El SQL explícito se limita a
FOR UPDATE (Prisma no expone este bloqueo) y `SELECT clock_timestamp() AS now`,
que obtiene el reloj de PostgreSQL después del bloqueo; no se usa el reloj de Node o del
navegador. La elegibilidad de las esperas se resuelve con los conteos e IDs
seleccionados de sus relaciones, sin cargar datos personales.

La única escritura adicional es REJECTED_LIMIT y `closed_at` cuando el estudiante
tiene cinco préstamos y realmente llega su turno. El rechazo es terminal: bajar
después a cuatro no lo devuelve a WAITING. No se rechaza mientras no haya capacidad
ni se evalúa a los siguientes cuando esperas elegibles anteriores ya la ocupan.
No se crean reservas ni se cierran préstamos o reservas vencidos. Sus fechas
solo se consideran para el conteo. No se registran avisos. La conciliación completa
y esas operaciones quedan en SCRUM-25/27; esta corrección se limita al comentario
del PR. Ver [el alcance del arreglo](scrum-18-rechazo-limite.md).

El límite de cinco préstamos, la capacidad simultánea, la coherencia entre
transiciones de varias tablas y la prioridad de la cola requieren transacciones
en los servicios de circulación. No quedan garantizados por esta migración.
El outbox y los avisos quedan fuera del flujo de esta corrección. La migración
`20261027000000_circulation_outbox`, aplicada durante la versión ampliada, se
conserva intacta como historial, junto con su modelo Prisma. La tabla permanece
sin uso por este código; no se borran sus registros ni se altera Neon para reducir
el alcance de la rama. Su integración queda pendiente de las historias de avisos.

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
