import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import type { QueryResultRow } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { universities } from '../../prisma/universities.js';

const accountsMigration = new URL('../../prisma/migrations/20261022170000_accounts_and_sessions/migration.sql', import.meta.url);

/** Sin fallback, dotenv, Prisma CLI ni acceso a la configuración de desarrollo. */
function connectionSettings() {
  if (process.env['ACCOUNTS_ALLOW_INTEGRATION_WRITES'] !== '1') {
    throw new Error('Integración bloqueada: falta habilitar explícitamente escrituras de prueba.');
  }
  const raw = process.env['TEST_DATABASE_URL'];
  if (!raw || raw !== raw.trim()) throw new Error('Se requiere TEST_DATABASE_URL explícita.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Destino de integración inválido.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || url.port !== '55432'
    || url.pathname !== '/ics_accounts_test' || url.username !== 'accounts_test_admin'
    || !url.password || url.search !== '' || url.hash !== ''
    || raw.includes('?') || raw.includes('#')) {
    throw new Error('Integración bloqueada: solo se permite el destino PostgreSQL local exclusivo de cuentas.');
  }
  let password: string;
  try { password = decodeURIComponent(url.password); } catch { throw new Error('Credencial de prueba inválida.'); }
  // Configuración explícita: tampoco se heredan host, opciones o SSL de variables PG*.
  return {
    host: '127.0.0.1', port: 55432, database: 'ics_accounts_test', user: 'accounts_test_admin', password,
    ssl: false as const, options: '-c search_path=public',
    application_name: 'accounts-isolated-integration', connectionTimeoutMillis: 5000,
  };
}

/** Importar este archivo no conecta, no ejecuta SQL ni prepara el esquema. */
export async function openPostgresFixture() {
  const settings = connectionSettings(); // Validar ANTES de construir/conectar clientes.
  const observer = new Client(settings);
  try {
    await observer.connect();
    const identity = await observer.query<{ database: string; user: string; address: string | null }>(
      'SELECT current_database() AS database, current_user AS "user", inet_server_addr()::text AS address',
    );
    const row = identity.rows[0];
    if (row?.database !== settings.database || row.user !== settings.user || !row.address) {
      throw new Error('Identidad PostgreSQL de prueba no válida.');
    }
    // Impide dos suites simultáneas sobre esta base. El cierre libera el bloqueo.
    const lock = await observer.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(20261022, 2) AS acquired',
    );
    if (!lock.rows[0]?.acquired) throw new Error('La base aislada ya está siendo usada.');
    // No adoptar, limpiar ni sobrescribir una base que ya contiene objetos.
    const existing = await observer.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    `);
    if (existing.rows[0]?.count !== '0') throw new Error('Se requiere una base de prueba nueva y vacía.');
  } catch {
    await observer.end().catch(() => {});
    throw new Error('No se pudo validar la base local de integración; no se preparó el esquema.');
  }

  try {
    // SQL original ya versionado en develop. Solo se ejecuta si se autoriza esta
    // suite aislada; no depende de objetos históricos Git ni invoca Prisma CLI.
    const schema = await readFile(accountsMigration, 'utf8');
    await observer.query('BEGIN');
    await observer.query(schema);
    await observer.query(`INSERT INTO public.universities (id, name)
      SELECT id::uuid, name FROM jsonb_to_recordset($1::jsonb) AS u(id text, name text)`, [JSON.stringify(universities)]);
    await observer.query('COMMIT');

    const { PrismaClient } = await import('../../src/generated/prisma/client.js');
    const database = new PrismaClient({ adapter: new PrismaPg({ ...settings, max: 5 }) });
    let closed = false;
    let faultInstalled = false;

    const query = async <T extends QueryResultRow>(sql: string, values: unknown[] = []) => {
      if (closed) throw new Error('Fixture cerrada.');
      try { return (await observer.query<T>(sql, values)).rows; }
      catch { throw new Error('Falló una comprobación SQL de la base aislada.'); }
    };

    return {
      database,
      query,
      async reset() {
        if (faultInstalled) throw new Error('No limpiar mientras está instalado el fallo de prueba.');
        await query('DELETE FROM public.sessions');
        await query('DELETE FROM public.users');
      },
      async installSessionFailure() {
        await query('CREATE SEQUENCE public.hu02_session_attempts');
        await query(`CREATE FUNCTION public.hu02_fail_session() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.user_id) THEN
              -- Las secuencias no revierten: permite demostrar que se alcanzó la
              -- inserción de sesión después de insertar el usuario en la transacción.
              PERFORM nextval('public.hu02_session_attempts');
              RAISE EXCEPTION 'HU02_FORCED_SESSION_FAILURE';
            END IF;
            RETURN NEW;
          END;
        $$`);
        await query(`CREATE TRIGGER hu02_fail_session BEFORE INSERT ON public.sessions
          FOR EACH ROW EXECUTE FUNCTION public.hu02_fail_session()`);
        faultInstalled = true;
      },
      async removeSessionFailure() {
        await query('DROP TRIGGER IF EXISTS hu02_fail_session ON public.sessions');
        await query('DROP FUNCTION IF EXISTS public.hu02_fail_session()');
        await query('DROP SEQUENCE IF EXISTS public.hu02_session_attempts');
        faultInstalled = false;
      },
      async close() {
        if (closed) return;
        closed = true;
        try { await database.$disconnect(); } finally { await observer.end(); }
        // Se conservan las filas para inspección: no se borran bases ni contenedores.
        // Una nueva ejecución exige otro contenedor/base vacía.
      },
    };
  } catch {
    await observer.query('ROLLBACK').catch(() => {});
    await observer.end().catch(() => {});
    throw new Error('Falló la preparación aislada. No reutilizar esta base sin revisarla.');
  }
}

export type PostgresFixture = Awaited<ReturnType<typeof openPostgresFixture>>;
