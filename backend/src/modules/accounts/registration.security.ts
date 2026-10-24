import { createHash, randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import { isValidRegistrationPassword } from './registration.validation.js';

export async function hashPassword(password: string): Promise<string> {
  if (!isValidRegistrationPassword(password)) {
    throw new TypeError('La contraseña debe ser no vacía y tener hasta 1024 bytes.');
  }
  // El salt se genera en argon2; no transformar ni recortar la contraseña.
  return hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(digest: string, password: unknown): Promise<boolean> {
  if (typeof digest !== 'string' || !digest || !isValidRegistrationPassword(password)) return false;
  try {
    return await verify(digest, password);
  } catch {
    // Un digest inválido no autentica ni expone el error de la biblioteca.
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new TypeError('El token de sesión tiene un formato inválido.');
  }
  return createHash('sha256').update(token).digest('hex');
}
