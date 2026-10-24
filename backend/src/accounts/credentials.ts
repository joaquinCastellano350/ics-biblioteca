import { argon2id, hash, verify } from 'argon2';
import validator from 'validator';

export const MAX_PASSWORD_BYTES = 1024;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validEmail(value: string): boolean {
  return !/\s/u.test(value) && validator.isEmail(value);
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES;
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new TypeError('La contraseña debe ser no vacía y tener hasta 1024 bytes.');
  return hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(digest: string, password: unknown): Promise<boolean> {
  if (!validPassword(password)) return false;
  // Un hash corrupto es un fallo interno, no una contraseña incorrecta.
  return verify(digest, password);
}
