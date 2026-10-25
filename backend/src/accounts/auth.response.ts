import type { PublicUser, SessionRecord } from './accounts.repository.js';

export interface AuthResponse {
  user: PublicUser;
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
}

/** Una sola proyección de transporte para login, registro y consulta de sesión. */
export function publicSession(session: Pick<SessionRecord, 'user' | 'createdAt' | 'expiresAt'>, serverTime: Date): AuthResponse {
  const { user } = session;
  return {
    user: {
      id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
      university: { id: user.university.id, name: user.university.name },
    },
    session: { createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString() },
    serverTime: serverTime.toISOString(),
  };
}
