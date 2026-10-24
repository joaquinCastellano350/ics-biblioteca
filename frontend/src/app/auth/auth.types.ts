export interface University { id: string; name: string }

export interface RegistrationRequest {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  password: string;
}

export type RegistrationFieldErrors = Partial<Record<keyof RegistrationRequest, string>>;
export interface AuthErrorResponse { error: { code: string; message: string; fields?: RegistrationFieldErrors } }

export interface AuthResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    university: University;
  };
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
}
