import express from 'express';
import cookieParser from 'cookie-parser';
import { AccountError, dependencyUnavailable } from './account-error.js';
import type { AccountsService } from './accounts.service.js';
import type { RegistrationHandlerService } from './registration.service.js';
import type { PublicUser } from './accounts.repository.js';
import { publicSession } from './auth.response.js';

const SESSION_COOKIE = 'biblioteca_session';

function sendError(res: express.Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function sessionCookie(res: express.Response, token: string, expiresAt: Date, serverTime: Date, production: boolean) {
  const expiry = Math.floor(expiresAt.getTime() / 1000) * 1000;
  if (!Number.isFinite(expiry) || !Number.isFinite(serverTime.getTime()) || expiry <= serverTime.getTime()) {
    throw new AccountError('SERVICE_UNAVAILABLE');
  }
  // Mismo vencimiento absoluto de PostgreSQL; sin depender del reloj de Node.
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: production, sameSite: 'lax', path: '/', expires: new Date(expiry),
  });
}

export function accountsController(
  accounts: AccountsService | undefined,
  production: boolean,
  registration?: RegistrationHandlerService,
  listUniversities?: () => Promise<PublicUser['university'][]>,
) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(cookieParser());
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Biblioteca-Request') !== '1') {
      return sendError(res, 403, 'REQUEST_NOT_ALLOWED', 'La solicitud no está permitida.');
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Enviá los datos como JSON.');
    }
    next();
  });
  router.use(express.json({ limit: '16kb' }));
  if (registration) router.post('/auth/register', async (req, res) => {
    const result = await registration.register(req.body, req.cookies[SESSION_COOKIE]);
    sessionCookie(res, result.cookie.token, result.cookie.expiresAt, new Date(result.publicResponse.serverTime), production);
    res.status(201).json(result.publicResponse);
  });
  if (accounts) {
    router.post('/auth/login', async (req, res) => {
      const values = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
      const result = await accounts.login(
        { email: values['email'], password: values['password'] }, req.cookies[SESSION_COOKIE],
      );
      sessionCookie(res, result.token, result.session.expiresAt, result.serverTime, production);
      res.json(publicSession(result.session, result.serverTime));
    });
    router.get('/auth/session', async (req, res) => {
      const result = await accounts.requireSession(req.cookies[SESSION_COOKIE]);
      res.json(publicSession(result.session, result.serverTime));
    });
  }
  const universities = listUniversities ?? (accounts ? () => accounts.universities() : undefined);
  if (universities) router.get('/universities', async (_req, res) => {
    res.json({ universities: await universities() });
  });
  return router;
}

export const accountErrorHandler: express.ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  res.set('Cache-Control', 'no-store');
  if (error instanceof AccountError) {
    const statuses: Record<AccountError['code'], number> = {
      VALIDATION_ERROR: 400, INVALID_CREDENTIALS: 401, AUTH_REQUIRED: 401,
      EMAIL_ALREADY_REGISTERED: 409, SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500,
    };
    const safeError = new AccountError(error.code, error.fields);
    res.status(statuses[error.code]).json({
      error: { code: error.code, message: safeError.message, ...(error.fields ? { fields: error.fields } : {}) },
    });
    return;
  }
  const kind = (error as { type?: string } | null)?.type;
  if (kind === 'entity.parse.failed' || kind === 'entity.too.large') {
    sendError(res, kind === 'entity.too.large' ? 413 : 400,
      kind === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
      'No se pudieron procesar los datos enviados.');
  } else if (kind === 'charset.unsupported' || kind === 'encoding.unsupported') {
    sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'La codificación del contenido no es compatible.');
  } else {
    const unavailable = dependencyUnavailable(error);
    const code = unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
    sendError(res, unavailable ? 503 : 500, code, new AccountError(code).message);
  }
};
