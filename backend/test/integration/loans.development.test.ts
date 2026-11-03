import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { LoanRepository } from '../../src/circulation/loan-repository.js';

// Prueba opt-in contra development. No usa dotenv ni configura otra rama.
// Conserva sus registros como datos de desarrollo, según lo acordado.
test('development: concurrencia real de concesiones', {
  skip: process.env['LOANS_ALLOW_DEVELOPMENT_WRITES'] !== '1',
}, async t => {
  const url = process.env['LOANS_DEVELOPMENT_DATABASE_URL'];
  assert.ok(url, 'Se requiere la conexión explícita de development.');
  assert.equal(new URL(url).hostname.replace('-pooler', ''), 'ep-red-night-b4dnrwkv.c-6.us-east-2.aws.neon.tech',
    'Solo se prueba contra la rama development del proyecto.');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 8 }) });
  const repository = new LoanRepository(db);
  try {
    const run = randomUUID();
    const university = await db.university.findFirstOrThrow({ select: { id: true } });
    const source = await db.book.findFirstOrThrow({
      where: { authors: { some: {} }, subjects: { some: {} } },
      select: { pdfObjectKey: true, authors: { select: { authorId: true } }, subjects: { select: { subjectId: true } } },
    });
    // Cada ejecución agrega sus datos. No depende de que otros usuarios sigan
    // teniendo cuatro préstamos ni elimina el trabajo de ejecuciones previas.
    const user = (role: string) => db.user.create({ data: { firstName: 'Prueba SCRUM-20', lastName: role,
      universityId: university.id, email: `scrum20-${role}-${run}@example.invalid`, passwordHash: 'fixture-no-login' } });
    const [first, second, four] = await Promise.all(['primero', 'segundo', 'limite'].map(user));
    assert.ok(first && second && four);
    const book = (role: string, totalCopies = 1) => db.book.create({ data: {
      title: `Prueba SCRUM-20 ${role} ${run}`, titleSearch: `prueba scrum20 ${role} ${run}`,
      pdfObjectKey: source.pdfObjectKey, totalCopies,
      authors: { create: source.authors.map(a => ({ authorId: a.authorId })) },
      subjects: { create: source.subjects.map(s => ({ subjectId: s.subjectId })) },
    } });
    const last = await book('ultimo-cupo');
    await t.test('dos estudiantes por el último cupo: uno concede y otro recibe falta de cupo', async () => {
      const results = await Promise.all([first, second].map(u => repository.requestLoan(u.id, last.id)));
      assert.equal(results.filter(r => 'loan' in r && r.created).length, 1);
      assert.equal(results.filter(r => 'code' in r && r.code === 'NO_AVAILABLE_COPIES').length, 1);
      assert.equal(await db.loan.count({ where: { bookId: last.id } }), 1);
    });
    for (let i = 0; i < 4; i++) {
      assert.ok('loan' in await repository.requestLoan(four.id, (await book(`previo-${i}`)).id));
    }
    const available = await book('solicitud-a');
    const extra = await book('solicitud-b', 2);
    await t.test('cuatro préstamos y dos libros simultáneos: termina con cinco', async () => {
      const results = await Promise.all([available.id, extra.id].map(id => repository.requestLoan(four.id, id)));
      assert.equal(results.filter(r => 'loan' in r && r.created).length, 1);
      assert.equal(results.filter(r => 'code' in r && r.code === 'LOAN_LIMIT_REACHED').length, 1);
      assert.equal(await db.loan.count({ where: { userId: four.id } }), 5);
    });
    await t.test('dos confirmaciones del mismo estudiante: mismo préstamo y tres avisos', async () => {
      const results = await Promise.all([repository.requestLoan(first.id, extra.id), repository.requestLoan(first.id, extra.id)]);
      assert.ok('loan' in results[0]! && 'loan' in results[1]!);
      assert.equal(results[0].loan.id, results[1].loan.id);
      assert.equal(results.filter(r => 'loan' in r && r.created).length, 1);
      assert.equal(await db.notificationOutbox.count({ where: { loanId: results[0].loan.id } }), 3);
    });
  } finally { await db.$disconnect(); }
});
