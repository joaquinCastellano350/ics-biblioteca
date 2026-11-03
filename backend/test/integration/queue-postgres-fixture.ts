import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { QueryResultRow } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { newSessionToken, tokenHash } from '../../src/accounts/sessions.js';

const migrations = [
  '20261022000000_catalog',
  '20261022170000_accounts_and_sessions',
  '20261026000000_circulation_availability',
  '20261027000000_circulation_outbox',
  '20261029000000_notification_delivery_window',
] as const;
const circulationTables = ['queue_entries', 'loans', 'reservations', 'notification_outbox'] as const;

/** Función pura: no construye clientes, no carga configuración ni abre conexiones. */
export function queueConnectionSettings(environment: NodeJS.ProcessEnv = process.env) {
  if (environment['SCRUM23_ALLOW_INTEGRATION_WRITES'] !== '1') {
    throw new Error('SCRUM-23 bloqueado: falta autorización explícita de escrituras de integración.');
  }
  const raw = environment['TEST_DATABASE_URL'];
  // También rechaza normalizaciones de host/ruta, fragmentos, parámetros y credenciales sin escapar.
  if (!raw || raw !== raw.trim() || !/^postgres(?:ql)?:\/\/scrum23_test_admin:[^\s/@?#]+@127\.0\.0\.1:55433\/ics_scrum23_test$/.test(raw)) {
    throw new Error('SCRUM-23 bloqueado: se requiere el destino local exclusivo de pruebas.');
  }
  let url: URL;
  let password: string;
  try { url = new URL(raw); password = decodeURIComponent(url.password); }
  catch { throw new Error('Destino o credencial temporal de prueba inválidos.'); }
  if (url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/ics_scrum23_test'
    || url.username !== 'scrum23_test_admin' || url.search || url.hash || !password || password.includes('\0')) {
    throw new Error('SCRUM-23 bloqueado: destino no autorizado.');
  }
  // No heredar opciones de conexión PG*: el adaptador recibe campos explícitos, nunca la URL.
  return { host: '127.0.0.1', port: 55433, database: 'ics_scrum23_test', user: 'scrum23_test_admin',
    password, ssl: false as const, options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=10000',
    application_name: 'scrum23-isolated-integration', connectionTimeoutMillis: 5000 };
}

/** Solo conserva los metadatos necesarios para comprobar restricciones; nunca el mensaje del proveedor. */
export class IsolatedSqlError extends Error {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
  constructor(error: unknown) {
    super('Falló una operación SQL de la base exclusiva de pruebas.');
    const details = error as { code?: string; constraint?: string } | null;
    this.code = typeof details?.code === 'string' ? details.code : undefined;
    this.constraint = typeof details?.constraint === 'string' ? details.constraint : undefined;
  }
}

/** Importar este módulo no ejecuta SQL. Solo esta función abre el entorno autorizado. */
export async function openQueuePostgresFixture() {
  const settings = queueConnectionSettings(); // Siempre antes de construir clientes.
  const observer = new Client(settings);
  let database: PrismaClient | undefined;
  let closed = false;
  let hooks: 'rollback' | 'reject-writes' | null = null;
  const query = async <T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> => {
    if (closed) throw new Error('Fixture SCRUM-23 cerrada.');
    try { return (await observer.query<T>(sql, values)).rows; }
    catch (error) { throw new IsolatedSqlError(error); }
  };
  try {
    await observer.connect();
    const [identity] = await query<{ db: string; user: string; version: number; address: string | null }>(`
      SELECT current_database() AS db, current_user AS "user",
        current_setting('server_version_num')::int AS version, inet_server_addr()::text AS address
    `);
    if (identity?.db !== settings.database || identity.user !== settings.user
      || identity.version < 170000 || identity.version >= 180000 || !identity.address) {
      throw new Error('Identidad o versión PostgreSQL no autorizada.');
    }
    const [lock] = await query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(20261029, 23) AS acquired');
    if (!lock?.acquired) throw new Error('Otra ejecución ya utiliza la base aislada.');
    const [objects] = await query<{ empty: boolean }>(`
      SELECT NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
        UNION ALL
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
        UNION ALL
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
        UNION ALL
        SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg_%'
        UNION ALL
        SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'
      ) AS empty
    `);
    if (!objects?.empty) throw new Error('La base de pruebas debe ser nueva y vacía.');

    // Lista cerrada de migraciones originales; no Prisma CLI, seeds ni transacción exterior:
    // las migraciones de circulación y outbox ya contienen BEGIN/COMMIT.
    for (const migration of migrations) {
      const sql = await readFile(new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8');
      await query(sql);
    }
    const { PrismaClient } = await import('../../src/generated/prisma/client.js');
    database = new PrismaClient({ adapter: new PrismaPg({ ...settings, max: 8 }) });
    const client = database;

    async function removeHooks() {
      if (!hooks) return;
      for (const table of circulationTables) await query(`DROP TRIGGER IF EXISTS scrum23_reject_writes ON public.${table}`);
      await query('DROP TRIGGER IF EXISTS scrum23_rollback ON public.queue_entries');
      await query('DROP FUNCTION IF EXISTS public.scrum23_fault()');
      await query('DROP TABLE IF EXISTS public.scrum23_rollback_probe');
      await query('DROP SEQUENCE IF EXISTS public.scrum23_write_attempts');
      hooks = null;
    }
    async function reset() {
      if (hooks) throw new Error('Retirar primero los fallos controlados de prueba.');
      await query(`TRUNCATE public.notification_outbox, public.loans, public.reservations,
        public.queue_entries, public.sessions, public.users, public.book_authors, public.book_subjects,
        public.books, public.authors, public.subjects, public.universities RESTART IDENTITY`);
    }
    async function createBook(totalCopies = 1) {
      const id = randomUUID();
      await query(`INSERT INTO books (id, title, title_search, pdf_object_key, total_copies)
        VALUES ($1, 'Libro ficticio SCRUM-23', 'libro ficticio scrum-23', 'fixture/no-existe.pdf', $2)`, [id, totalCopies]);
      return id;
    }
    async function addLoan(userId: string, bookId: string, ageHours = 1) {
      const id = randomUUID();
      await query(`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        SELECT $1, $2, $3, t, t + interval '480 hours'
        FROM (SELECT clock_timestamp() - $4::double precision * interval '1 hour' AS t) clock`,
      [id, userId, bookId, ageHours]);
      return id;
    }
    async function seed() {
      const university = randomUUID();
      await query("INSERT INTO universities (id, name) VALUES ($1, 'Universidad ficticia SCRUM-23')", [university]);
      const students = [];
      for (let i = 0; i < 4; i++) {
        const id = randomUUID(); const token = newSessionToken();
        await query(`INSERT INTO users (id, first_name, last_name, university_id, email, password_hash)
          VALUES ($1, 'Estudiante ficticio', $2, $3, $4, 'fixture-no-login')`,
        [id, String(i), university, `scrum23-${i}@example.invalid`]);
        await query(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
          SELECT $1, $2, $3, t, t + interval '6 hours'
          FROM (SELECT clock_timestamp()::timestamptz(3) AS t) clock`, [randomUUID(), id, tokenHash(token)]);
        students.push({ id, cookie: `biblioteca_session=${token}` });
      }
      const bookId = await createBook();
      await addLoan(students[3]!.id, bookId); // Ocupa el único cupo; no hay vencimientos pendientes.
      return { students, bookId };
    }
    async function snapshot() {
      const [row] = await query<{ data: unknown }>(`SELECT jsonb_build_object(
        'entries', (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]') FROM queue_entries q),
        'loans', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]') FROM loans l),
        'reservations', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM reservations r),
        'outbox', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id), '[]') FROM notification_outbox n)
      ) AS data`);
      return row!.data;
    }
    async function installFault(mode: 'rollback' | 'reject-writes') {
      if (hooks) throw new Error('Ya existe un fallo de prueba instalado.');
      hooks = mode; // Permite limpiar también una instalación incompleta.
      await query('CREATE SEQUENCE public.scrum23_write_attempts');
      if (mode === 'rollback') await query('CREATE TABLE public.scrum23_rollback_probe (id uuid PRIMARY KEY)');
      await query(`CREATE FUNCTION public.scrum23_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM nextval('public.scrum23_write_attempts');
          ${mode === 'rollback' ? 'INSERT INTO public.scrum23_rollback_probe (id) VALUES (NEW.id);' : ''}
          RAISE EXCEPTION 'SCRUM23_TEST_FAULT';
        END;
      $$`);
      if (mode === 'rollback') {
        await query(`CREATE TRIGGER scrum23_rollback AFTER INSERT ON public.queue_entries
          FOR EACH ROW EXECUTE FUNCTION public.scrum23_fault()`);
      } else {
        for (const table of circulationTables) await query(`CREATE TRIGGER scrum23_reject_writes
          BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.${table}
          FOR EACH STATEMENT EXECUTE FUNCTION public.scrum23_fault()`);
      }
    }
    async function writeAttempts() {
      const [row] = await query<{ called: boolean; value: string }>(
        'SELECT is_called AS called, last_value::text AS value FROM public.scrum23_write_attempts');
      return row!.called ? Number(row!.value) : 0;
    }
    return { database: client, query, reset, seed, createBook, addLoan, snapshot, installFault, removeHooks, writeAttempts,
      async close() {
        if (closed) return;
        closed = true;
        try { await client.$disconnect(); } finally { await observer.end(); }
        // No borra la base ni administra Docker. Conserva evidencia hasta autorizar la eliminación.
      },
    };
  } catch {
    await database?.$disconnect().catch(() => {});
    await observer.end().catch(() => {});
    closed = true;
    throw new Error('No se pudo preparar PostgreSQL 17 exclusivo de SCRUM-23. No reutilizar el entorno sin revisarlo.');
  }
}

export type QueuePostgresFixture = Awaited<ReturnType<typeof openQueuePostgresFixture>>;

/** Dos transacciones REALES establecen su instantánea antes de continuar.
 * Solo coordina el comienzo: no simula resultados, bloqueos, commits ni reintentos.
 */
export async function withConcurrentTransactions<T>(database: PrismaClient,
  run: (database: Pick<PrismaClient, '$transaction'>, attempts: () => number) => Promise<T>): Promise<T> {
  let release!: () => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  // El deadline puede vencer antes de que alguna conexión alcance la barrera.
  void ready.catch(() => {});
  let attempts = 0;
  // Deadline de fallo, no una espera para sincronizar operaciones.
  const deadline = setTimeout(() => reject(new Error('No se alcanzó la barrera de dos transacciones.')), 10_000);
  const concurrent = {
    async $transaction<R>(work: (tx: Prisma.TransactionClient) => Promise<R>, options: {
      isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number;
    }) {
      return database.$transaction(async tx => {
        const attempt = ++attempts;
        if (attempt <= 2) {
          await tx.$queryRaw`SELECT 1`;
          if (attempt === 2) { clearTimeout(deadline); release(); }
          await ready;
        }
        return work(tx);
      }, options);
    },
  } as Pick<PrismaClient, '$transaction'>;
  try { return await run(concurrent, () => attempts); }
  finally { clearTimeout(deadline); release(); }
}
