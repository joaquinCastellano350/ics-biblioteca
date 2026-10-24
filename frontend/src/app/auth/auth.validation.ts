import type { ValidatorFn } from '@angular/forms';
import isEmail from 'validator/es/lib/isEmail.js';

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/** Misma biblioteca y política que la API; no restringe dominios internacionales. */
export const emailValidator: ValidatorFn = (control) => {
  if (typeof control.value !== 'string' || !control.value.trim()) return null;
  const email = normalizeEmail(control.value);
  return !/\s/u.test(email) && isEmail(email) ? null : { email: true };
};
