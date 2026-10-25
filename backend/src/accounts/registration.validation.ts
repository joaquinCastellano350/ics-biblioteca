import validator from 'validator';
import { normalizeEmail, validEmail, validPassword } from './credentials.js';

export interface RegistrationData {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  password: string;
}

export type RegistrationFields = Partial<Record<keyof RegistrationData, string>>;

export type RegistrationValidation =
  | { valid: true; data: RegistrationData }
  | { valid: false; fields: RegistrationFields };

/** Valida datos recibidos; no comprueba existencia de facultad ni unicidad de correo. */
export function validateRegistration(input: unknown): RegistrationValidation {
  const values: Record<string, unknown> = input !== null && typeof input === 'object'
    && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const text = (field: keyof RegistrationData): string =>
    typeof values[field] === 'string' ? values[field].trim() : '';
  const firstName = text('firstName');
  const lastName = text('lastName');
  const universityId = text('universityId').toLowerCase();
  const email = normalizeEmail(text('email'));
  const password = values['password'];
  const fields: RegistrationFields = {};

  if (!firstName) fields.firstName = 'Ingresá tu nombre.';
  if (!lastName) fields.lastName = 'Ingresá tu apellido.';
  if (!validator.isUUID(universityId)) fields.universityId = 'Seleccioná una facultad válida.';
  if (!validEmail(email)) fields.email = 'Ingresá un correo electrónico válido.';
  if (!validPassword(password)) {
    fields.password = 'Ingresá una contraseña no vacía de hasta 1024 bytes.';
  }

  if (Object.keys(fields).length > 0 || !validPassword(password)) {
    return { valid: false, fields };
  }

  return { valid: true, data: { firstName, lastName, universityId, email, password } };
}
