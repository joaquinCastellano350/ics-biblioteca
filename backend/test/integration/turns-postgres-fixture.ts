import { readFile, readdir } from 'node:fs/promises';
import { Client, type QueryResultRow } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** No dotenv, DATABASE_URL ni fallback al proyecto compartido. Validar antes de conectar. */
export function turnsConnectionSettings(environment: NodeJS.ProcessEnv = process.env) {
  const raw = environment['TEST_TURNS_DATABASE_URL'];
  if (environment['TURNS_ALLOW_INTEGRATION_WRITES'] !== '1' || !raw
    || !/^postgres(?:ql)?:\/\/turns_test_admin:[^\s/@?#]+@127\.0\.0\.1:55435\/ics_turns_test$/.test(raw)) {
    throw new Error('Turnos: se requiere habilitar la base local exclusiva de pruebas.');
  }
  let password: string;
  try { password = decodeURIComponent(new URL(raw).password); }
  catch { throw new Error('Credencial temporal de prueba inválida.'); }
  if (!password || password.includes('\0')) throw new Error('Credencial temporal de prueba inválida.');
  return { host: '127.0.0.1', port: 55435, database: 'ics_turns_test',
    user: 'turns_test_admin', password, ssl: false as const,
    options: '-c search_path=public -c statement_timeout=10000 -c lock_timeout=5000',
    application_name: 'turns-isolated-integration', connectionTimeoutMillis: 5000 };
}

export async function openTurnsPostgresFixture() {
  const settings = turnsConnectionSettings();
  const observer = new Client(settings);
  const clients: PrismaClient[] = [];
  const query = async <T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> =>
    (await observer.query<T>(sql, values)).rows;
  try {
    await observer.connect();
    const [identity] = await query<{ db: string; user: string; version: number }>(`SELECT current_database() AS db,
      current_user AS "user", current_setting('server_version_num')::int AS version`);
    if (identity?.db !== settings.database || identity.user !== settings.user
      || identity.version < 170000 || identity.version >= 180000) throw new Error('Identidad PostgreSQL no válida.');
    const [lock] = await query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(20261031, 25) AS acquired');
    if (!lock?.acquired) throw new Error('Otra suite ya está usando la base exclusiva.');
    const [objects] = await query<{ empty: boolean }>(`SELECT NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
      UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
      UNION ALL SELECT 1 FROM pg_namespace
        WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg_%'
      UNION ALL SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'
    ) AS empty`);
    if (!objects?.empty) throw new Error('Se requiere una base nueva y vacía; no se limpiará una existente.');
    const directory = new URL('../../prisma/migrations/', import.meta.url);
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const migration of migrations) await query(await readFile(new URL(`${migration}/migration.sql`, directory), 'utf8'));
    const newClient = () => {
      const client = new PrismaClient({ adapter: new PrismaPg({ ...settings, max: 6 }) });
      clients.push(client);
      return client;
    };
    return {
      database: newClient(), query, newClient,
      async reset() {
        await query(`TRUNCATE notification_outbox, loans, reservations, queue_entries, sessions, users,
          book_authors, book_subjects, books, authors, subjects, universities RESTART IDENTITY`);
      },
      async close() {
        try { await Promise.all(clients.map(client => client.$disconnect())); }
        finally { await observer.end(); }
      },
    };
  } catch {
    await Promise.all(clients.map(client => client.$disconnect().catch(() => {})));
    await observer.end().catch(() => {});
    throw new Error('No se pudo preparar la base local exclusiva de turnos. No se accede a Neon.');
  }
}

export type TurnsPostgresFixture = Awaited<ReturnType<typeof openTurnsPostgresFixture>>;
