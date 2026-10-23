import { generateSessionToken, hashPassword, hashSessionToken } from './registration.security.js';
import { validateRegistration } from './registration.validation.js';
import type { RegistrationFields } from './registration.validation.js';

export const REGISTRATION_SESSION_DURATION_MS = 6 * 60 * 60 * 1000;

export interface RegistrationPublicUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  university: { id: string; name: string };
}

export interface AtomicRegistrationInput {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  passwordHash: string;
  tokenHash: string;
  sessionDurationMs: number;
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

/** Contrato de errores del futuro adaptador; no transporta mensajes de PostgreSQL. */
export class RegistrationPersistenceError extends Error {
  constructor(public readonly code: RegistrationPersistenceCode) {
    super('No se pudo completar la operación de persistencia del registro.');
    this.name = 'RegistrationPersistenceError';
  }
}

export type RegistrationErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNIVERSITY_NOT_FOUND'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const errorMessages: Record<RegistrationErrorCode, string> = {
  VALIDATION_ERROR: 'Revisá los datos ingresados.',
  UNIVERSITY_NOT_FOUND: 'La facultad seleccionada no existe.',
  EMAIL_ALREADY_REGISTERED: 'El correo electrónico ya está registrado.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible. Intentá nuevamente más tarde.',
  INTERNAL_ERROR: 'No se pudo completar el registro.',
};

export class RegistrationError extends Error {
  constructor(
    public readonly code: RegistrationErrorCode,
    public readonly fields?: RegistrationFields,
  ) {
    super(errorMessages[code]);
    this.name = 'RegistrationError';
  }
}

export interface RegistrationPublicResponse {
  user: RegistrationPublicUser;
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
}

export interface RegistrationResult {
  /** Único contenido destinado al futuro cuerpo JSON HTTP. */
  publicResponse: RegistrationPublicResponse;
  /** Solo para emitir la cookie HttpOnly; nunca serializar dentro del JSON público. */
  cookie: { token: string; expiresAt: Date; maxAgeMs: number };
}

export class RegistrationService {
  constructor(private readonly repository: RegistrationRepository) {}

  async register(input: unknown): Promise<RegistrationResult> {
    const validation = validateRegistration(input);
    if (!validation.valid) throw new RegistrationError('VALIDATION_ERROR', validation.fields);

    try {
      const { firstName, lastName, universityId, email, password } = validation.data;
      const passwordDigest = await hashPassword(password);
      const token = generateSessionToken();
      const result = await this.repository.createUserAndSession({
        firstName, lastName, universityId, email,
        passwordHash: passwordDigest,
        tokenHash: hashSessionToken(token),
        sessionDurationMs: REGISTRATION_SESSION_DURATION_MS,
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
      const user = result.user;
      return {
        publicResponse: {
          user: {
            id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
            university: { id: user.university.id, name: user.university.name },
          },
          session: {
            createdAt: result.session.createdAt.toISOString(),
            expiresAt: result.session.expiresAt.toISOString(),
          },
          serverTime: result.serverTime.toISOString(),
        },
        cookie: {
          token,
          expiresAt: new Date(expiresAt),
          maxAgeMs: expiresAt - serverTime,
        },
      };
    } catch (error) {
      if (error instanceof RegistrationPersistenceError) {
        if (error.code === 'UNIVERSITY_NOT_FOUND') {
          throw new RegistrationError('UNIVERSITY_NOT_FOUND', {
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
