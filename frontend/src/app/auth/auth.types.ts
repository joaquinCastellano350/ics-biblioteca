export interface AuthResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    university: { id: string; name: string };
  };
  session: { createdAt: string; expiresAt: string };
  serverTime: string;
}
