import { hashPassword } from './credentials.js';
import { newSessionToken, tokenHash, validSessionToken, SESSION_DURATION_MS } from './sessions.js';
import { AccountError } from './account-error.js';
import { publicSession } from './auth.response.js';
import type { AuthResponse } from './auth.response.js';
import type { PublicUser } from './accounts.repository.js';
import { validateRegistration } from './registration.validation.js';
import type { RegistrationFields } from './registration.validation.js';

export { SESSION_DURATION_MS as REGISTRATION_SESSION_DURATION_MS } from './sessions.js';
const REGISTRATION_SESSION_DURATION_MS = SESSION_DURATION_MS;

export type RegistrationPublicUser = PublicUser;

export interface AtomicRegistrationInput {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  passwordHash: string;
  tokenHash: string;
  sessionDurationMs: number;
  previousTokenHash?: string;
}

export interface AtomicRegistrationResult {
  user: RegistrationPublicUser;
  session: { createdAt: Date; expiresAt: Date };
  serverTime: Date;
}

export interface RegistrationRepository {
  /**
   * Comprueba facultad y crea usuario y sesión en UNA transacción.
   * Usa el reloj de la base; confirma antes de resolver y revierte ante fallo.
   * Traduce la restricción única de correo y demás fallos a RegistrationPersistenceError.
   */
  createUserAndSession(input: AtomicRegistrationInput): Promise<AtomicRegistrationResult>;
}

export type RegistrationPersistenceCode =
  | 'UNIVERSITY_NOT_FOUND'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'DEPENDENCY_UNAVAILABLE';

/** Contrato de errores del adaptador; no transporta mensajes de PostgreSQL. */
export class RegistrationPersistenceError extends Error {
  constructor(public readonly code: RegistrationPersistenceCode) {
    super('No se pudo completar la operación de persistencia del registro.');
    this.name = 'RegistrationPersistenceError';
  }
}

export type RegistrationErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class RegistrationError extends AccountError {
  constructor(
    code: RegistrationErrorCode,
    fields?: RegistrationFields,
  ) {
    super(code, fields);
    this.name = 'RegistrationError';
  }
}

export type RegistrationPublicResponse = AuthResponse;
export type RegistrationHandlerService = Pick<RegistrationService, 'register'>;

export interface RegistrationResult {
  /** Único contenido destinado al cuerpo JSON HTTP. */
  publicResponse: RegistrationPublicResponse;
  /** Solo para emitir la cookie HttpOnly; nunca serializar dentro del JSON público. */
  cookie: { token: string; expiresAt: Date; maxAgeMs: number };
}

export class RegistrationService {
  constructor(private readonly repository: RegistrationRepository) {}

  async register(input: unknown, previousToken?: unknown): Promise<RegistrationResult> {
    const validation = validateRegistration(input);
    if (!validation.valid) throw new RegistrationError('VALIDATION_ERROR', validation.fields);

    try {
      const { firstName, lastName, universityId, email, password } = validation.data;
      const passwordDigest = await hashPassword(password);
      const token = newSessionToken();
      const result = await this.repository.createUserAndSession({
        firstName, lastName, universityId, email,
        passwordHash: passwordDigest,
        tokenHash: tokenHash(token),
        sessionDurationMs: REGISTRATION_SESSION_DURATION_MS,
        ...(validSessionToken(previousToken) ? { previousTokenHash: tokenHash(previousToken) } : {}),
      });

      const createdAt = result.session.createdAt.getTime();
      const expiresAt = result.session.expiresAt.getTime();
      const serverTime = result.serverTime.getTime();
      if (![createdAt, expiresAt, serverTime].every(Number.isFinite)
        || expiresAt - createdAt !== REGISTRATION_SESSION_DURATION_MS
        || serverTime < createdAt || serverTime >= expiresAt) {
        throw new Error('El repositorio devolvió fechas de sesión incoherentes.');
      }

      // Lista explícita: ni siquiera propiedades adicionales del adaptador llegan al JSON.
      return {
        publicResponse: publicSession({ user: result.user, ...result.session }, result.serverTime),
        cookie: {
          token,
          expiresAt: new Date(expiresAt),
          maxAgeMs: expiresAt - serverTime,
        },
      };
    } catch (error) {
      if (error instanceof RegistrationPersistenceError) {
        if (error.code === 'UNIVERSITY_NOT_FOUND') {
          throw new RegistrationError('VALIDATION_ERROR', {
            universityId: 'Seleccioná una facultad existente.',
          });
        }
        if (error.code === 'EMAIL_ALREADY_REGISTERED') {
          throw new RegistrationError('EMAIL_ALREADY_REGISTERED', {
            email: 'El correo electrónico ya está registrado.',
          });
        }
        if (error.code === 'DEPENDENCY_UNAVAILABLE') throw new RegistrationError('SERVICE_UNAVAILABLE');
      }
      // No adjuntar cause, mensajes internos ni valores recibidos al error público.
      throw new RegistrationError('INTERNAL_ERROR');
    }
  }
}
