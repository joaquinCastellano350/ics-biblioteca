import { randomUUID } from 'node:crypto';
import { normalizeEmail } from './credentials.js';
import { dependencyUnavailable } from './account-error.js';
import { createSessionInTransaction, databaseTime } from './prisma-session.js';
import {
  REGISTRATION_SESSION_DURATION_MS, RegistrationPersistenceError,
} from './registration.service.js';
import type {
  AtomicRegistrationInput, AtomicRegistrationResult, RegistrationPublicUser, RegistrationRepository,
} from './registration.service.js';

/** Superficie mínima del cliente Prisma existente; permite simulaciones sin importarlo. */
export interface RegistrationSqlTransaction {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

export interface RegistrationDatabase {
  $transaction<T>(operation: (tx: RegistrationSqlTransaction) => Promise<T>): Promise<T>;
}

type ErrorRecord = Record<string, unknown>;

function errorRecords(error: unknown): ErrorRecord[] {
  const result: ErrorRecord[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return;
    seen.add(value);
    const record = value as ErrorRecord;
    result.push(record);
    for (const key of ['meta', 'cause', 'driverAdapterError']) visit(record[key], depth + 1);
  };
  visit(error, 0);
  return result;
}

function persistenceFailure(error: unknown): Error {
  if (error instanceof RegistrationPersistenceError) return error;
  const records = errorRecords(error);
  const uniqueViolation = records.some((record) => record['code'] === '23505'
    || record['originalCode'] === '23505');
  const emailConstraint = records.some((record) => {
    const constraint = record['constraint'];
    const index = constraint && typeof constraint === 'object'
      ? (constraint as ErrorRecord)['index'] : constraint;
    if (index === 'users_email_key') return true;
    // Prisma puede conservar solo SQLSTATE y el mensaje de PostgreSQL en P2010.
    const message = record['message'] ?? record['originalMessage'];
    return typeof message === 'string'
      && /^(?:ERROR:\s*)?duplicate key value violates unique constraint "users_email_key"(?:\s|$)/i.test(message);
  });
  if (uniqueViolation && emailConstraint) {
    return new RegistrationPersistenceError('EMAIL_ALREADY_REGISTERED');
  }

  if (dependencyUnavailable(error)) return new RegistrationPersistenceError('DEPENDENCY_UNAVAILABLE');

  // El servicio convierte este error genérico en INTERNAL_ERROR, sin mensajes del motor.
  return new Error('No se pudo completar la persistencia del registro.');
}

export class PostgresRegistrationRepository implements RegistrationRepository {
  constructor(private readonly database: RegistrationDatabase) {}

  async createUserAndSession(input: AtomicRegistrationInput): Promise<AtomicRegistrationResult> {
    try {
      if (input.sessionDurationMs !== REGISTRATION_SESSION_DURATION_MS
        || !/^[0-9a-f]{64}$/.test(input.tokenHash)
        || !input.passwordHash.startsWith('$argon2id$')) {
        throw new Error('Datos internos de registro inválidos.');
      }

      return await this.database.$transaction(async (tx) => {
        const [university] = await tx.$queryRaw<{ id: string; name: string }[]>`
          SELECT id, name FROM public.universities
          WHERE id = ${input.universityId}::uuid
          FOR KEY SHARE
        `;
        if (!university) throw new RegistrationPersistenceError('UNIVERSITY_NOT_FOUND');

        // El bloqueo mantiene válida la referencia hasta finalizar la transacción.
        const now = await databaseTime(tx);

        const [user] = await tx.$queryRaw<Omit<RegistrationPublicUser, 'university'>[]>`
          INSERT INTO public.users
            (id, first_name, last_name, university_id, email, password_hash, created_at)
          VALUES (${randomUUID()}::uuid, ${input.firstName}, ${input.lastName},
            ${university.id}::uuid, ${normalizeEmail(input.email)}, ${input.passwordHash},
            ${now}::timestamptz(3))
          RETURNING id, first_name AS "firstName", last_name AS "lastName", email
        `;
        if (!user) throw new Error('No se obtuvo el usuario creado.');

        const session = await createSessionInTransaction(tx, {
          userId: user.id, tokenHash: input.tokenHash,
          ...(input.previousTokenHash ? { previousTokenHash: input.previousTokenHash } : {}),
        }, now);

        return {
          user: {
            id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
            university: { id: university.id, name: university.name },
          },
          session: { createdAt: session.createdAt, expiresAt: session.expiresAt },
          serverTime: now,
        };
      });
    } catch (error) {
      // Rechazar el callback deja rollback/commit exclusivamente a Prisma.
      throw persistenceFailure(error);
    }
  }
}
