import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AccountsRepository, CreateSessionInput, PublicUser, SessionRecord } from './accounts.repository.js';

// Selección explícita: nunca cargar password_hash al serializar una sesión.
const publicUser = {
  id: true, firstName: true, lastName: true, email: true,
  university: { select: { id: true, name: true } },
} as const;

export class PrismaAccountsRepository implements AccountsRepository {
  constructor(private readonly database: PrismaClient) {}

  findUser(email: string) {
    return this.database.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  }

  async createSession(input: CreateSessionInput) {
    return this.database.$transaction(async (tx) => {
      // Las dos fechas se derivan del mismo instante, con la precisión de las columnas.
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp()::timestamptz(3) AS now`;
      if (!clock) throw new Error('No se pudo obtener el reloj de la base.');
      if (input.previousTokenHash) {
        await tx.session.updateMany({
          where: { tokenHash: input.previousTokenHash, revokedAt: null }, data: { revokedAt: clock.now },
        });
      }
      const session = await tx.session.create({
        data: {
          id: randomUUID(), userId: input.userId, tokenHash: input.tokenHash, createdAt: clock.now,
          expiresAt: new Date(clock.now.getTime() + input.durationMs),
        },
        select: {
          id: true, createdAt: true, expiresAt: true, revokedAt: true,
          user: { select: publicUser },
        },
      });
      return { session, serverTime: clock.now };
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
