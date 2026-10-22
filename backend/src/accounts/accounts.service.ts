import { normalizeEmail, validEmail, validPassword, verifyPassword } from './credentials.js';
import { newSessionToken, SESSION_DURATION_MS, sessionIsValid, tokenHash, validSessionToken } from './sessions.js';
import type { AccountsRepository } from './accounts.repository.js';

interface LoginInput {
  email: unknown;
  password: unknown;
}

export class AccountError extends Error {
  constructor(
    public readonly code: 'VALIDATION_ERROR' | 'INVALID_CREDENTIALS' | 'AUTH_REQUIRED',
    message: string,
    public readonly fields?: Record<string, string>,
  ) { super(message); }
}

function authRequired(): AccountError {
  return new AccountError('AUTH_REQUIRED', 'Iniciá sesión para continuar.');
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
      throw new AccountError('VALIDATION_ERROR', 'Revisá los datos ingresados.', fields);
    }
    const user = await this.repository.findUser(email);
    if (!user || !await verifyPassword(user.passwordHash, password)) {
      throw new AccountError('INVALID_CREDENTIALS', 'El correo o la contraseña son incorrectos.');
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

  universities() { return this.repository.listUniversities(); }
}
