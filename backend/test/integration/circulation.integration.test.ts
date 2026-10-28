import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { CirculationRepository } from '../../src/circulation/circulation-repository.js';

// No importa dotenv ni database.ts: nunca usa por defecto la base de la API.
const connectionString = process.env['CIRCULATION_TEST_DATABASE_URL'];
test('conciliación concurrente con PostgreSQL externo aislado', { skip: !connectionString }, async (t) => {
  assert.equal(process.env['CIRCULATION_ALLOW_INTEGRATION_WRITES'], '1');
  const url = new URL(connectionString!);
  assert.equal(url.pathname, '/ics_circulation_test');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) || url.hostname.endsWith('.neon.tech'));
  const pool = new Pool({ connectionString, max: 5 });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
  try {
    const existing = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.equal(existing.rows.length, 0, 'La base de integración debe estar nueva y vacía.');
    const directory = new URL('../../prisma/migrations/', import.meta.url);
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of migrations) {
      await pool.query(await readFile(new URL(`${name}/migration.sql`, directory), 'utf8'));
    }
    const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const at = (hours: number) => new Date(now!.getTime() + hours * 3_600_000);
    const university = await db.university.create({ data: { name: 'Universidad aislada' } });
    let sequence = 0;
    const user = () => db.user.create({ data: { firstName: 'Prueba', lastName: 'Prueba',
      universityId: university.id, email: `externo-${++sequence}@example.org`, passwordHash: 'fixture' } });
    const book = () => db.book.create({ data: { title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies: 1 } });
    const repository = new CirculationRepository(db);

    await t.test('tres recargas simultáneas ofrecen el último cupo una sola vez', async () => {
      const target = await book();
      const first = await user();
      const second = await user();
      const entry = await db.queueEntry.create({ data: { userId: first.id, bookId: target.id } });
      const waiting = await db.queueEntry.create({ data: { userId: second.id, bookId: target.id } });
      const responses = await Promise.all(Array.from({ length: 3 }, () => repository.findOccupancy([target.id])));
      assert.ok(responses.every(result => result[0]?.heldReservations === 1));
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 1);
      const held = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: entry.id } });
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: held.id } }), 1);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
    });

    await t.test('lecturas con IDs invertidos respetan el orden de bloqueo', async () => {
      const books = [await book(), await book()];
      for (const target of books) {
        const person = await user();
        await db.queueEntry.create({ data: { userId: person.id, bookId: target.id } });
      }
      await Promise.all([
        repository.findOccupancy(books.map(item => item.id)),
        repository.findOccupancy(books.map(item => item.id).reverse()),
      ]);
      assert.equal(await db.reservation.count({ where: { bookId: { in: books.map(item => item.id) } } }), 2);
    });

    await t.test('rechazar al llegar el turno persiste después de vencer un préstamo', async () => {
      const target = await book();
      const person = await user();
      const loans = [];
      for (let i = 0; i < 5; i++) loans.push(await db.loan.create({ data: {
        userId: person.id, bookId: (await book()).id, startedAt: at(-1), dueAt: at(479),
      } }));
      const entry = await db.queueEntry.create({ data: { userId: person.id, bookId: target.id } });
      await repository.findOccupancy([target.id]);
      const rejected = await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
      assert.equal(rejected.state, 'REJECTED_LIMIT');
      await db.loan.update({ where: { id: loans[0]!.id }, data: { startedAt: at(-481), dueAt: at(-1) } });
      const [result] = await repository.findOccupancy([target.id]);
      assert.equal(result?.heldReservations, 0);
      assert.deepEqual((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).closedAt, rejected.closedAt);
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: entry.id } }), 1);
    });
  } finally {
    await db.$disconnect();
    await pool.end();
  }
});
