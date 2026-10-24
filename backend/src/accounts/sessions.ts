import { createHash, randomBytes } from 'node:crypto';

export const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;

export function tokenHash(token: string): string {
  if (!validSessionToken(token)) throw new TypeError('El token de sesión tiene un formato inválido.');
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function validSessionToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface SessionDates {
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function sessionIsValid(session: SessionDates, serverTime: Date): boolean {
  return session.revokedAt === null && serverTime < session.expiresAt;
}
