import { argon2id, hash, verify } from 'argon2';
import validator from 'validator';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validEmail(value: string): boolean {
  return validator.isEmail(value);
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 1024;
}

export function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error('Contraseña inválida.');
  return hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export function verifyPassword(digest: string, password: string): Promise<boolean> {
  return verify(digest, password);
}
