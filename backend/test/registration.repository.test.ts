import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresRegistrationRepository } from '../src/accounts/registration.repository.js';
import type {
  RegistrationDatabase, RegistrationSqlTransaction,
} from '../src/accounts/registration.repository.js';
import {
  REGISTRATION_SESSION_DURATION_MS, RegistrationPersistenceError, RegistrationService,
} from '../src/accounts/registration.service.js';
import type { AtomicRegistrationInput } from '../src/accounts/registration.service.js';

const input: AtomicRegistrationInput = {
  firstName: 'Ana', lastName: 'Pérez', email: ' ANA@EXAMPLE.ORG ',
  universityId: '00000000-0000-4000-8000-000000000007',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$salt$hash',
  tokenHash: 'a'.repeat(64), sessionDurationMs: REGISTRATION_SESSION_DURATION_MS,
};
const now = new Date('2026-10-22T12:00:00.123Z');
const userId = '12345678-1234-4234-8234-123456789abc';
const university = { id: input.universityId, name: 'Facultad Regional Córdoba (Córdoba)' };
const user = { id: userId, firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org' };
const session = { createdAt: now, expiresAt: new Date(now.getTime() + 21600000) };
type Query = { sql: string; values: unknown[]; template: TemplateStringsArray };

/** Solo registra llamadas y errores: no representa una base ni simula su rollback. */
function fakeDatabase(options: {
  universityMissing?: boolean;
  failAt?: number;
  error?: unknown;
  transactionError?: unknown;
  incompleteAt?: number;
  invalidSession?: boolean;
  holdCommit?: Promise<void>;
} = {}) {
  const queries: Query[] = [];
  let transactions = 0;
  let callbackRejected = false;
  let callbackCompleted = false;
  const tx: RegistrationSqlTransaction = {
    async $queryRaw<T>(template: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      const sql = template.join('?').replace(/\s+/g, ' ').trim();
      queries.push({ sql, values, template });
      if (options.failAt === queries.length) throw options.error;
      if (options.incompleteAt === queries.length) return [] as T;
      let rows: unknown;
      if (sql.includes('FROM public.universities')) rows = options.universityMissing ? [] : [university];
      else if (sql.startsWith('SELECT clock_timestamp()')) rows = [{ now }];
      else if (sql.startsWith('INSERT INTO public.users')) rows = [{ ...user, passwordHash: 'extra-no-publicar' }];
      else if (sql.includes('INSERT INTO sessions')) rows = [{
        ...session, id: 'sesion', revokedAt: null, user: { ...user, university },
        ...(options.invalidSession ? { expiresAt: now } : {}),
      }];
      else throw new Error('Consulta inesperada en la prueba.');
      return rows as T;
    },
  };
  const database: RegistrationDatabase = {
    async $transaction<T>(operation: (client: RegistrationSqlTransaction) => Promise<T>): Promise<T> {
      transactions += 1;
      if (options.transactionError) throw options.transactionError;
      let result: T;
      try { result = await operation(tx); }
      catch (error) { callbackRejected = true; throw error; }
      callbackCompleted = true;
      if (options.holdCommit) await options.holdCommit;
      return result;
    },
  };
  return {
    repository: new PostgresRegistrationRepository(database), queries,
    get transactions() { return transactions; },
    get callbackRejected() { return callbackRejected; },
    get callbackCompleted() { return callbackCompleted; },
  };
}

function persistenceCode(code: string) {
  return (error: unknown): boolean => error instanceof RegistrationPersistenceError && error.code === code;
}

test('una transacción contiene comprobación, reloj y ambas inserciones parametrizadas', async () => {
  const fake = fakeDatabase();
  const result = await fake.repository.createUserAndSession(input);
  assert.equal(fake.transactions, 1);
  assert.equal(fake.queries.length, 4);
  assert.match(fake.queries[0]!.sql, /SELECT id, name FROM public\.universities.*FOR KEY SHARE/);
  assert.deepEqual(fake.queries[0]!.values, [input.universityId]);
  assert.match(fake.queries[1]!.sql, /^SELECT clock_timestamp\(\)::timestamptz\(3\)/);
  const userInsert = fake.queries[2]!;
  const sessionInsert = fake.queries[3]!;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(String(userInsert.values[0]), uuid);
  assert.match(String(sessionInsert.values[0]), uuid);
  assert.notEqual(userInsert.values[0], sessionInsert.values[0]);
  assert.deepEqual(userInsert.values.slice(1), [
    input.firstName, input.lastName, input.universityId, 'ana@example.org', input.passwordHash, now,
  ]);
  assert.deepEqual(sessionInsert.values.slice(1), [userId, input.tokenHash, now, session.expiresAt]);
  for (const query of fake.queries) {
    assert.ok(Array.isArray(query.template.raw));
    assert.equal(query.sql.includes(input.passwordHash), false);
    assert.equal(query.sql.includes(input.tokenHash), false);
  }
  assert.deepEqual(result, { user: { ...user, university }, session, serverTime: now });
});

test('los valores con sintaxis SQL permanecen como parámetros', async () => {
  const fake = fakeDatabase();
  const firstName = "Ana'); DROP TABLE users; --";
  await fake.repository.createUserAndSession({ ...input, firstName });
  assert.equal(fake.queries[2]!.values[1], firstName);
  assert.equal(fake.queries[2]!.sql.includes(firstName), false);
});

test('universidad inexistente rechaza el callback antes de cualquier inserción', async () => {
  const fake = fakeDatabase({ universityMissing: true });
  await assert.rejects(fake.repository.createUserAndSession(input), persistenceCode('UNIVERSITY_NOT_FOUND'));
  assert.equal(fake.transactions, 1);
  assert.equal(fake.queries.length, 1);
  assert.equal(fake.callbackRejected, true);
});

test('traduce únicamente users_email_key con SQLSTATE de unicidad', async () => {
  const errors = [
    { code: '23505', constraint: 'users_email_key' },
    { code: 'P2010', meta: { code: '23505', message: 'duplicate key value violates unique constraint "users_email_key"' } },
    { code: 'P2010', meta: { driverAdapterError: { cause: {
      originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index: 'users_email_key' },
    } } } },
  ];
  for (const error of errors) {
    const fake = fakeDatabase({ failAt: 3, error });
    await assert.rejects(fake.repository.createUserAndSession(input), persistenceCode('EMAIL_ALREADY_REGISTERED'));
    assert.equal(fake.queries.length, 3);
    assert.equal(fake.callbackRejected, true);
  }
});

test('otras restricciones únicas y errores que solo mencionan correo no se clasifican como duplicado', async () => {
  const errors = [
    { code: '23505', constraint: 'users_pkey' },
    { code: '23505', constraint: 'sessions_token_hash_key' },
    { code: '23514', constraint: 'users_email_key' },
    { code: 'P2010', meta: { code: '23505', message: 'duplicate key value violates unique constraint "sessions_token_hash_key"; users_email_key' } },
    new Error('users_email_key'),
  ];
  for (const error of errors) {
    const fake = fakeDatabase({ failAt: 3, error });
    await assert.rejects(fake.repository.createUserAndSession(input), (failure: unknown) => {
      assert.ok(failure instanceof Error);
      assert.equal(failure instanceof RegistrationPersistenceError, false);
      assert.equal(failure.message, 'No se pudo completar la persistencia del registro.');
      return true;
    });
  }
});

test('fallo al insertar sesión sale del callback y no devuelve un resultado exitoso', async () => {
  const fake = fakeDatabase({ failAt: 4, error: new Error('detalle-interno-no-publicar') });
  await assert.rejects(fake.repository.createUserAndSession(input), {
    message: 'No se pudo completar la persistencia del registro.',
  });
  assert.equal(fake.queries.length, 4);
  assert.equal(fake.callbackRejected, true);
  assert.equal(fake.callbackCompleted, false);
  // Esto verifica rechazo del callback, no un rollback real de PostgreSQL.
});

test('errores de conexión, pool y servidor se traducen a dependencia no disponible', async () => {
  for (const error of [
    { code: 'P1001' }, { code: 'P2024' }, { code: 'ECONNREFUSED' },
    { code: 'P2010', meta: { code: '08006' } },
    { cause: { originalCode: '57P01' } },
    { meta: { driverAdapterError: { cause: { kind: 'ConnectionClosed' } } } },
  ]) {
    const fake = fakeDatabase({ transactionError: error });
    await assert.rejects(fake.repository.createUserAndSession(input), persistenceCode('DEPENDENCY_UNAVAILABLE'));
    assert.equal(fake.queries.length, 0);
  }
});

test('un fallo desconocido se convierte en error interno sin causa ni detalles originales', async () => {
  const fake = fakeDatabase({ transactionError: new Error('detalle-privado-de-prueba') });
  await assert.rejects(fake.repository.createUserAndSession(input), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error instanceof RegistrationPersistenceError, false);
    assert.equal('cause' in error, false);
    assert.equal(error.message.includes('detalle-privado'), false);
    return true;
  });
});

test('la respuesta del repositorio contiene solo datos públicos y fechas', async () => {
  const result = await fakeDatabase().repository.createUserAndSession(input);
  const json = JSON.stringify(result);
  for (const secret of [input.passwordHash, input.tokenHash, 'extra-no-publicar']) {
    assert.equal(json.includes(secret), false);
  }
  assert.deepEqual(Object.keys(result).sort(), ['serverTime', 'session', 'user']);
  assert.deepEqual(Object.keys(result.user).sort(), ['email', 'firstName', 'id', 'lastName', 'university']);
  assert.deepEqual(Object.keys(result.session).sort(), ['createdAt', 'expiresAt']);
});

test('datos internos inválidos no abren transacción', async () => {
  for (const change of [
    { sessionDurationMs: 1000 }, { tokenHash: 'token-sin-hash' }, { passwordHash: 'texto-plano' },
  ]) {
    const fake = fakeDatabase();
    await assert.rejects(fake.repository.createUserAndSession({ ...input, ...change }));
    assert.equal(fake.transactions, 0);
  }
});

test('resultados incompletos o fechas incoherentes rechazan dentro de la transacción', async () => {
  for (const incompleteAt of [2, 3, 4]) {
    const fake = fakeDatabase({ incompleteAt });
    await assert.rejects(fake.repository.createUserAndSession(input));
    assert.equal(fake.callbackRejected, true);
    assert.equal(fake.queries.length, incompleteAt);
  }
  const fake = fakeDatabase({ invalidSession: true });
  await assert.rejects(fake.repository.createUserAndSession(input));
  assert.equal(fake.callbackRejected, true);
});

test('espera a que $transaction resuelva antes de devolver éxito', async () => {
  let finish!: () => void;
  const holdCommit = new Promise<void>((resolve) => { finish = resolve; });
  const fake = fakeDatabase({ holdCommit });
  let resolved = false;
  const pending = fake.repository.createUserAndSession(input).then(() => { resolved = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fake.callbackCompleted, true);
  assert.equal(resolved, false);
  finish();
  await pending;
  assert.equal(resolved, true);
});

test('el servicio consume el repositorio simulado y conserva la clasificación de errores', async () => {
  const cases = [
    [{ universityMissing: true }, 'VALIDATION_ERROR'],
    [{ failAt: 3, error: { code: '23505', constraint: 'users_email_key' } }, 'EMAIL_ALREADY_REGISTERED'],
    [{ transactionError: { code: 'P1001' } }, 'SERVICE_UNAVAILABLE'],
    [{ failAt: 4, error: new Error('interno') }, 'INTERNAL_ERROR'],
  ] as const;
  for (const [options, code] of cases) {
    const fake = fakeDatabase(options);
    const service = new RegistrationService(fake.repository);
    await assert.rejects(service.register({
      firstName: 'Ana', lastName: 'Pérez', universityId: input.universityId,
      email: 'ana@example.org', password: 'a',
    }), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
    assert.equal(fake.transactions, 1);
  }
});
