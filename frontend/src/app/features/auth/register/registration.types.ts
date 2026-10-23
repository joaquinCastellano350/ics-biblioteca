import type { RegistrationFieldErrors, RegistrationUniversity } from './register';

// Reutilizar el contrato del formulario evita mantener dos listas de campos.
export type { RegistrationRequest, RegistrationFieldErrors } from './register';

export interface RegistrationResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    university: RegistrationUniversity;
  };
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
}

export interface RegistrationErrorResponse {
  error: {
    code: string;
    message: string;
    fields?: RegistrationFieldErrors;
  };
}
