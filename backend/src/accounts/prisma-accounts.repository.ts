import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountsRepository, CreateSessionInput, PublicUser, SessionRecord } from './accounts.repository.js';
import { createSessionInTransaction, databaseTime } from './prisma-session.js';

export class PrismaAccountsRepository implements AccountsRepository {
  constructor(private readonly database: PrismaClient) {}

  findUser(email: string) {
    return this.database.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  }

  async createSession(input: CreateSessionInput) {
    return this.database.$transaction(async (tx) => {
      const now = await databaseTime(tx);
      const session = await createSessionInTransaction(tx, input, now);
      return { session, serverTime: now };
    });
  }

  async findSession(hash: string) {
    // Una sola sentencia evita reusar una sesión leída antes de obtener el reloj.
    const rows = await this.database.$queryRaw<{
      id: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null;
      serverTime: Date; user: PublicUser;
    }[]>`
      SELECT s.id, s.created_at AS "createdAt", s.expires_at AS "expiresAt",
        s.revoked_at AS "revokedAt", clock_timestamp()::timestamptz(3) AS "serverTime",
        json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name,
          'email', u.email, 'university', json_build_object('id', v.id, 'name', v.name)) AS "user"
      FROM sessions s JOIN users u ON u.id = s.user_id
      JOIN universities v ON v.id = u.university_id
      WHERE s.token_hash = ${hash}
    `;
    const row = rows[0];
    if (!row) return null;
    const session: SessionRecord = row;
    return { session, serverTime: row.serverTime };
  }

  async listUniversities() {
    const rows = await this.database.university.findMany({ select: { id: true, name: true } });
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
  }
}
