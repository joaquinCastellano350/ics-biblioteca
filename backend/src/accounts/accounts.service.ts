import { normalizeEmail, validEmail, validPassword, verifyPassword } from './credentials.js';
import { newSessionToken, SESSION_DURATION_MS, sessionIsValid, tokenHash, validSessionToken } from './sessions.js';
import type { AccountsRepository } from './accounts.repository.js';
import { AccountError } from './account-error.js';
export { AccountError } from './account-error.js';

interface LoginInput {
  email: unknown;
  password: unknown;
}

function authRequired(): AccountError {
  return new AccountError('AUTH_REQUIRED');
}

export class AccountsService {
  constructor(private readonly repository: AccountsRepository) {}

  async login(input: LoginInput, previousToken: unknown) {
    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
    const password = input.password;
    const fields: Record<string, string> = {};
    if (!validEmail(email)) fields['email'] = 'Ingresá un correo válido.';
    if (!validPassword(password)) fields['password'] = 'Ingresá una contraseña de hasta 1024 bytes.';
    if (Object.keys(fields).length || !validPassword(password)) {
      throw new AccountError('VALIDATION_ERROR', fields);
    }
    const user = await this.repository.findUser(email);
    if (!user || !await verifyPassword(user.passwordHash, password)) {
      throw new AccountError('INVALID_CREDENTIALS');
    }
    const token = newSessionToken();
    const result = await this.repository.createSession({
      userId: user.id, tokenHash: tokenHash(token), durationMs: SESSION_DURATION_MS,
      ...(validSessionToken(previousToken) ? { previousTokenHash: tokenHash(previousToken) } : {}),
    });
    return { token, ...result };
  }

  async requireSession(token: unknown) {
    if (!validSessionToken(token)) throw authRequired();
    const result = await this.repository.findSession(tokenHash(token));
    if (!result || !sessionIsValid(result.session, result.serverTime)) throw authRequired();
    return result;
  }

  async logout(token: unknown): Promise<void> {
    // Sin un token válido no hay una sesión identificable que revocar.
    if (!validSessionToken(token)) return;
    try {
      await this.repository.revokeSession(tokenHash(token));
    } catch {
      // No confirmar el cierre cuando la persistencia no pudo confirmarlo.
      throw new AccountError('SERVICE_UNAVAILABLE');
    }
  }

  universities() { return this.repository.listUniversities(); }
}
