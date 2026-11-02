import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { tokenHash } from '../src/accounts/sessions.js';
import { createApp } from '../src/app.js';
import { LoanReadingRepository } from '../src/loan/loan-repository.js';
import { LoanController } from '../src/loan/loan-controller.js';
import { PDF_ACCESS_SECONDS, S3PdfAccessSigner } from '../src/loan/pdf-access.js';
import { catalogDatabase } from './catalog-database.js';

test('lectura: Prisma verifica titularidad y vigencia sin modificar circulación', async (t) => {
  const fixture = await catalogDatabase();
  t.after(() => fixture.close());
  const db = fixture.client;
  const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
  const users = await Promise.all(['titular', 'otra'].map((name) => db.user.create({ data: {
    firstName: name, lastName: 'Prueba', email: `${name}@example.org`, passwordHash: 'fixture', universityId: university.id,
  } })));
  const owner = users[0]!;
  const other = users[1]!;
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const at = (hours: number) => new Date(clock!.now.getTime() + hours * 3_600_000);
  const loans = [];
  for (const [index, start] of [-1, -480, -482, 1].entries()) {
    const book = await db.book.create({ data: { title: `Libro ${index}`, titleSearch: 'libro', pdfObjectKey: `privado/${index}.pdf`, totalCopies: 1 } });
    loans.push(await db.loan.create({ data: {
      bookId: book.id, userId: owner.id, startedAt: at(start), dueAt: at(start + 480),
      ...(index === 2 ? { closedAt: at(-1) } : {}),
    } }));
  }
  const before = await db.loan.findMany({ orderBy: { id: 'asc' } });
  const repository = new LoanReadingRepository(db);
  const active = await repository.findReading(loans[0]!.id, owner.id);
  assert.equal(active?.pdfObjectKey, 'privado/0.pdf');
  assert.equal(active?.dueAt.getTime(), loans[0]!.dueAt.getTime());
  assert.ok(active?.serverTime instanceof Date);
  assert.equal(await repository.findReading(loans[0]!.id, other.id), null);
  assert.equal(await repository.findReading(randomUUID(), owner.id), null);
  for (const loan of loans.slice(1)) assert.equal(await repository.findReading(loan.id, owner.id), null);
  assert.deepEqual(await db.loan.findMany({ orderBy: { id: 'asc' } }), before);
  assert.equal(await db.reservation.count(), 0);
  assert.equal(await db.notificationOutbox.count(), 0);
});

test('lectura: firma S3 breve, inline y sin superar due_at, con precisión de segundos', async (t) => {
  const storage = new S3Client({
    endpoint: 'https://assets.example.org', region: 'us-east-2', forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'fixture-only' },
  });
  t.after(() => storage.destroy());
  const signer = new S3PdfAccessSigner(storage, 'assets');
  const serverTime = new Date('2026-10-27T12:00:00.250Z');
  const access = await signer.sign({ pdfObjectKey: 'private/prueba.pdf', serverTime, dueAt: new Date('2026-11-01T12:00:00Z') });
  assert.ok(access);
  const url = new URL(access.url);
  assert.equal(url.pathname, '/assets/private/prueba.pdf');
  assert.equal(url.searchParams.get('X-Amz-Expires'), String(PDF_ACCESS_SECONDS));
  assert.equal(url.searchParams.get('response-content-disposition'), 'inline');
  assert.equal(url.searchParams.get('response-content-type'), 'application/pdf');
  assert.equal(url.searchParams.get('response-cache-control'), 'private, no-store');
  assert.ok(url.searchParams.get('X-Amz-Signature'));
  assert.equal(access.expiresAt, '2026-10-27T12:05:00.000Z');
  const nearExpiry = await signer.sign({ pdfObjectKey: 'private/prueba.pdf', serverTime, dueAt: new Date('2026-10-27T12:00:08.900Z') });
  assert.equal(new URL(nearExpiry!.url).searchParams.get('X-Amz-Expires'), '8');
  assert.equal(nearExpiry!.expiresAt, '2026-10-27T12:00:08.000Z');
  for (const dueAt of [serverTime, new Date('2026-10-27T11:59:59Z'), new Date('2026-10-27T12:00:00.900Z')]) {
    assert.equal(await signer.sign({ pdfObjectKey: 'privado.pdf', serverTime, dueAt }), null);
  }
});

test('lectura: no firma sin un préstamo autorizado', async () => {
  const controller = new LoanController({ findReading: async () => null }, {
    sign: async () => { assert.fail('No se debe firmar un préstamo sin autorización'); },
  });
  assert.equal(await controller.read(randomUUID(), randomUUID()), null);
});

test('lectura HTTP: sesión, autorización, protección y errores sin datos privados', async (t) => {
  const userId = randomUUID();
  const loanId = randomUUID();
  const serverTime = new Date('2026-10-27T12:00:00Z');
  let revoked = false;
  const accounts = new AccountsService({
    findUser: async () => null,
    createSession: async () => { throw new Error('No se usa'); },
    revokeSession: async () => {},
    listUniversities: async () => [],
    findSession: async (hash) => hash !== tokenHash('a'.repeat(43)) ? null : {
      serverTime, session: {
        id: randomUUID(), createdAt: serverTime, expiresAt: new Date('2026-10-27T18:00:00Z'), revokedAt: revoked ? serverTime : null,
        user: { id: userId, firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: randomUUID(), name: 'Universidad' } },
      },
    },
  });
  let fail = false;
  let lookups = 0;
  let requests = 0;
  const server = createApp({
    checkDatabase: async () => {}, checkStorage: async () => {}, accounts,
    loans: { requestLoan: async (user, bookId) => {
      requests++;
      assert.equal(user, userId);
      return { created: true, loan: { id: loanId, bookId, startedAt: serverTime, dueAt: new Date('2026-11-16T12:00:00Z') } };
    } },
    loanReading: { findReading: async (id, user) => {
      lookups++;
      assert.equal(user, userId);
      if (fail) throw new Error('postgresql://credencial-no-exponer');
      return id === loanId ? { pdfObjectKey: 'clave-privada.pdf', dueAt: new Date('2026-10-28T12:00:00Z'), serverTime } : null;
    } },
    pdfAccess: { sign: async () => ({ url: 'https://assets.example.org/archivo.pdf?firma=breve', expiresAt: '2026-10-27T12:05:00Z' }) },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/loans`;
  const headers = { Cookie: `biblioteca_session=${'a'.repeat(43)}`, 'X-Biblioteca-Request': '1' };
  const read = (id: string = loanId, auth = headers) => fetch(`${endpoint}/${id}/read-access`, { method: 'POST', headers: auth });
  // Ambos routers comparten /api/loans. El de lectura no debe interceptar
  // concesiones ni sustituir el repositorio de SCRUM-20.
  const grant = await fetch(endpoint, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: randomUUID() }),
  });
  assert.equal(grant.status, 201);
  assert.equal(requests, 1);
  assert.equal(lookups, 0);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await read(loanId, { ...headers, Cookie: '' })).status, 401);
  assert.equal((await read(loanId, { ...headers, 'X-Biblioteca-Request': '' })).status, 403);
  assert.equal((await read('invalido')).status, 400);
  assert.equal(lookups, 0);
  const success = await read();
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await success.json(), { url: 'https://assets.example.org/archivo.pdf?firma=breve', expiresAt: '2026-10-27T12:05:00Z' });
  assert.equal((await read(randomUUID())).status, 404);
  fail = true;
  const failure = await read();
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes('credencial'), false);
  assert.equal((await fetch(`${endpoint}/${loanId}/read-access`, { headers })).status, 405);
  revoked = true;
  assert.equal((await read()).status, 401);
  assert.equal(requests, 1);
});
