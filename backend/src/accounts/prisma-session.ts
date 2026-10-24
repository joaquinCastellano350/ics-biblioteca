import { randomUUID } from 'node:crypto';
import { SESSION_DURATION_MS } from './sessions.js';
import type { SessionRecord } from './accounts.repository.js';

/** Se recibe la transacción del llamador; nunca se abre otra transacción. */
export interface SessionTransaction {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

export async function databaseTime(tx: SessionTransaction): Promise<Date> {
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock || !Number.isFinite(clock.now.getTime())) throw new Error('No se pudo obtener el reloj de la base.');
  return clock.now;
}

export async function createSessionInTransaction(
  tx: SessionTransaction,
  input: { userId: string; tokenHash: string; previousTokenHash?: string },
  createdAt: Date,
): Promise<SessionRecord> {
  if (input.previousTokenHash) {
    await tx.$queryRaw`
      UPDATE sessions SET revoked_at = ${createdAt}::timestamptz(3)
      WHERE token_hash = ${input.previousTokenHash} AND revoked_at IS NULL
      RETURNING id
    `;
  }
  const expiresAt = new Date(createdAt.getTime() + SESSION_DURATION_MS);
  const [session] = await tx.$queryRaw<SessionRecord[]>`
    WITH created AS (
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES (${randomUUID()}::uuid, ${input.userId}::uuid, ${input.tokenHash},
        ${createdAt}::timestamptz(3), ${expiresAt}::timestamptz(3))
      RETURNING id, user_id, created_at, expires_at, revoked_at
    )
    SELECT s.id, s.created_at AS "createdAt", s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt",
      json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name,
        'email', u.email, 'university', json_build_object('id', v.id, 'name', v.name)) AS "user"
    FROM created s JOIN users u ON u.id = s.user_id JOIN universities v ON v.id = u.university_id
  `;
  if (!session || !Number.isFinite(session.createdAt.getTime())
    || session.createdAt.getTime() !== createdAt.getTime()
    || session.expiresAt.getTime() - session.createdAt.getTime() !== SESSION_DURATION_MS) {
    throw new Error('No se obtuvo una sesión válida.');
  }
  return session;
}
