import type { SessionDates } from './sessions.js';

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  university: { id: string; name: string };
}

export interface SessionRecord extends SessionDates {
  id: string;
  user: PublicUser;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  durationMs: number;
  previousTokenHash?: string;
}

export interface AccountsRepository {
  findUser(email: string): Promise<{ id: string; passwordHash: string } | null>;
  createSession(input: CreateSessionInput): Promise<{ session: SessionRecord; serverTime: Date }>;
  findSession(hash: string): Promise<{ session: SessionRecord; serverTime: Date } | null>;
  listUniversities(): Promise<{ id: string; name: string }[]>;
}
