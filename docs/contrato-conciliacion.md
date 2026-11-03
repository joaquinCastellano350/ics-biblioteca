# Contrato compartido de conciliación — SCRUM-25/27

Este módulo permite desarrollar vencimientos y turnos sobre una base común.
Usa el vocabulario de [CONTEXT.md](../CONTEXT.md) y las reglas del
[modelo de datos](modelo-de-datos.md), §§4–8 y 10.

## Operaciones y tipos públicos

En `backend/src/circulation/reconcile-books.ts`:

```ts
interface ReconciliationResult {
  readonly now: Date;
  readonly occupancy: readonly BookOccupancy[];
}

type ReservationReleaseReason = 'CANCELLED' | 'REJECTED_LIMIT';

reconcileBooks(tx: Prisma.TransactionClient, bookIds: readonly string[]): Promise<ReconciliationResult>;
releaseReservation(tx: Prisma.TransactionClient, reservationId: string, reason: ReservationReleaseReason): Promise<ReconciliationResult>;
```

`BookOccupancy` se define en `circulation.ts`. `now` es el instante de PostgreSQL
obtenido después del bloqueo. `occupancy` refleja los préstamos vigentes y las
reservas vigentes después de la conciliación. `eligibleWaiters` vale cero: los
cupos asignados ya están representados por reservas persistidas. No se devuelve
información personal de quienes esperan. Las filas se ordenan por ID de libro;
los IDs repetidos se eliminan y los inexistentes no producen una fila.

## Uso para SCRUM-27

```ts
import { circulationTransaction } from './circulation-transaction.js';
import { reconcileBooks } from './reconcile-books.js';

const result = await circulationTransaction(database, tx =>
  reconcileBooks(tx, [bookId])
);
```

La llamada cierra los préstamos vencidos del libro, finaliza reservas vencidas
junto con sus entradas, recorre WAITING por `order_seq` y asigna los cupos libres.
Al llegar su turno, quien tiene cinco préstamos vigentes queda REJECTED_LIMIT
con cierre y aviso. La siguiente persona elegible recibe reserva HELD por 24
horas, entrada OFFERED y aviso TURN_AVAILABLE. Si no hay elegibles, queda capacidad
libre. El préstamo deja de estar vigente al llegar `due_at`, aunque el proceso
todavía no haya registrado su cierre.

SCRUM-27 debe invocar esta operación para los libros detectados con vencimientos.
El cierre y la oferta se confirman juntos. Las comprobaciones de acceso al PDF
y las consultas de préstamos activos deben evaluar la vigencia por fecha y
titularidad; no deben depender de que el proceso periódico haya corrido.

## Uso para SCRUM-24/26

Después de validar identidad, titularidad y motivo dentro de la operación
autenticada, invocar `releaseReservation` en la misma transacción. Cierra reserva
y entrada, y concilia el libro para reasignar inmediatamente. Si ya venció usa
EXPIRED; una reserva terminal conserva su resultado. El rechazo por límite al
aceptar no crea un segundo correo de rechazo. El llamador de SCRUM-26 debe
confirmar estos cambios y luego informar el rechazo; lanzar un error dentro del
callback revertiría también la reasignación.

## Reglas del llamador

- Usar `circulationTransaction` de `circulation-transaction.ts`: SERIALIZABLE, hasta tres intentos completos y SERVICE_UNAVAILABLE al agotar conflictos recuperables. Otros errores se propagan.
- Las funciones reciben la transacción, sin abrir una transacción anidada. Si el llamador ya tiene una operación de circulación, ambas deben compartir el mismo callback y su política de reintento.
- El módulo bloquea libros por UUID ascendente. Si la operación necesita más de un libro, pasar todos los IDs juntos antes de adquirir otros bloqueos por libro en distinto orden.
- No efectuar llamadas externas dentro del callback, porque puede repetirse. Los avisos se guardan en el outbox junto con sus causas; el emisor existente entrega después del commit.
- Informar éxito únicamente cuando resuelva `circulationTransaction`. Si falla una escritura, se revierte toda la operación.
- Repetir la conciliación conserva reservas, fechas y avisos existentes. La recuperación de rechazos históricos no reabre entradas ni reinicia eventos enviados.

Este commit base publica el módulo y su contrato; las conexiones de catálogo,
préstamo directo, cola, consulta personal y procesamiento periódico se integran
en los cambios de sus historias. No agrega migraciones ni activa workflows.
Las migraciones de circulación y outbox existentes son sus prerrequisitos.

## Pruebas del contrato

`npm test --workspace backend` incluye `reconcile-books.test.ts` y
`circulation-transaction.test.ts`, con PostgreSQL embebido y sin correo real.
La matriz usa directamente las operaciones públicas, sin depender de los
repositorios o del proceso periódico pendientes de integración.

Para contención con PostgreSQL 17, preparar una base local **nueva y vacía**:
`ics_turns_test`, usuario `turns_test_admin`, en `127.0.0.1:55435`. Definir
`TEST_TURNS_DATABASE_URL` con ese destino y `TURNS_ALLOW_INTEGRATION_WRITES=1`.
El fixture rechaza otros destinos y no carga credenciales de Neon. Ejecutar
desde la raíz, después de generar Prisma:

```powershell
npm run db:generate --workspace backend
npm exec --workspace backend -- tsx --test test/integration/reconciliation.integration.test.ts
```

Se comprueban FIFO, cupos múltiples, 24 horas, cierre y oferta atómicos, rechazo
solo al llegar el turno, sucesores inelegibles, liberación e idempotencia,
recuperación histórica y rollback ante fallo de outbox. PostgreSQL externo agrega
dos conciliadores simultáneos y dos liberaciones simultáneas de la misma reserva.
