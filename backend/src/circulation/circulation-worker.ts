import type { PrismaClient } from '../generated/prisma/client.js';
import { CirculationRepository } from './circulation-repository.js';

export class CirculationWorker {
  constructor(private readonly database: Pick<PrismaClient, '$queryRaw' | '$transaction'>) {}

  async runBatch(limit = 50): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Lote de circulación inválido.');
    // Selección de trabajo, no asignación: cada libro se relee bajo el protocolo
    // SERIALIZABLE. Un fallo no impide procesar los otros libros seleccionados.
    const books = await this.database.$queryRaw<{ id: string }[]>`
      SELECT b.id FROM books b WHERE
        EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.closed_at IS NULL AND l.due_at <= clock_timestamp())
        OR EXISTS (SELECT 1 FROM reservations r WHERE r.book_id = b.id AND r.state = 'HELD' AND r.expires_at <= clock_timestamp())
        OR (EXISTS (SELECT 1 FROM queue_entries q WHERE q.book_id = b.id AND q.state = 'WAITING')
          AND b.total_copies >
            (SELECT count(*) FROM loans l WHERE l.book_id = b.id AND l.closed_at IS NULL
              AND l.started_at <= clock_timestamp() AND l.due_at > clock_timestamp()) +
            (SELECT count(*) FROM reservations r WHERE r.book_id = b.id AND r.state = 'HELD' AND r.expires_at > clock_timestamp()))
        OR EXISTS (SELECT 1 FROM queue_entries q WHERE q.book_id = b.id AND q.state = 'REJECTED_LIMIT'
          AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.queue_entry_id = q.id)
          AND NOT EXISTS (SELECT 1 FROM notification_outbox n WHERE n.queue_entry_id = q.id AND n.kind = 'QUEUE_LIMIT_REJECTED'))
      ORDER BY b.id LIMIT ${limit}
    `;
    const failures: unknown[] = [];
    for (const book of books) {
      try { await new CirculationRepository(this.database).findOccupancy([book.id]); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error('Quedaron libros pendientes de conciliación.');
  }
}
