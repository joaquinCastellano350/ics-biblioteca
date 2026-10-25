import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaAccountsRepository } from '../src/accounts/prisma-accounts.repository.js';

// El doble solo registra llamadas: no ejecuta SQL ni representa una base de datos.
function fixture(result: number = 1, error?: Error) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const database = {
    async $executeRaw(template: TemplateStringsArray, ...values: unknown[]) {
      calls.push({ sql: template.join('?').replace(/\s+/g, ' ').trim(), values });
      if (error) throw error;
      return result;
    },
  };
  // El repositorio recibe un cliente completo en producción; esta prueba expone
  // únicamente la operación permitida, para fallar ante dependencias adicionales.
  const repository = new PrismaAccountsRepository(database as unknown as PrismaClient);
  return { repository, calls };
}

test('revoca con una única sentencia parametrizada por hash y conserva revocaciones previas', async () => {
  const f = fixture();
  const hash = 'a'.repeat(64);
  assert.equal(await f.repository.revokeSession(hash), undefined);
  assert.deepEqual(f.calls, [{
    sql: 'UPDATE public.sessions SET revoked_at = clock_timestamp()::timestamptz(3) WHERE token_hash = ? AND revoked_at IS NULL',
    values: [hash],
  }]);
});

test('el hash permanece como parámetro aunque contenga sintaxis SQL', async () => {
  const f = fixture();
  const hash = "hash' OR 1=1 --";
  await f.repository.revokeSession(hash);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0]!.values, [hash]);
  assert.equal(f.calls[0]!.sql.includes(hash), false);
});

test('cero filas afectadas confirma una operación idempotente sin devolver datos internos', async () => {
  const f = fixture(0);
  assert.equal(await f.repository.revokeSession('b'.repeat(64)), undefined);
  assert.equal(f.calls.length, 1);
});

test('un fallo de persistencia se propaga sin reintentar ni devolver éxito', async () => {
  const error = new Error('Fallo simulado');
  const f = fixture(0, error);
  await assert.rejects(f.repository.revokeSession('c'.repeat(64)), (caught: unknown) => caught === error);
  assert.equal(f.calls.length, 1);
});
