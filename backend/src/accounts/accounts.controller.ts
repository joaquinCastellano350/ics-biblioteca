import express from 'express';
import cookieParser from 'cookie-parser';
import { AccountError } from './accounts.service.js';
import type { AccountsService } from './accounts.service.js';
import type { SessionRecord } from './accounts.repository.js';
import { SESSION_DURATION_MS } from './sessions.js';

const SESSION_COOKIE = 'biblioteca_session';

function publicSession(session: SessionRecord, serverTime: Date) {
  return {
    user: session.user,
    session: {
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    },
    serverTime: serverTime.toISOString(),
  };
}

function sendError(
  res: express.Response, status: number, code: string, message: string, fields?: Record<string, string>,
) {
  res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}

export function accountsController(accounts: AccountsService, production: boolean) {
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
  router.post('/auth/login', async (req, res) => {
    const body: unknown = req.body;
    const values = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const result = await accounts.login(
      { email: values['email'], password: values['password'] }, req.cookies[SESSION_COOKIE],
    );
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: SESSION_DURATION_MS,
    }).json(publicSession(result.session, result.serverTime));
  });
  router.get('/auth/session', async (req, res) => {
    const result = await accounts.requireSession(req.cookies[SESSION_COOKIE]);
    res.json(publicSession(result.session, result.serverTime));
  });
  router.get('/universities', async (_req, res) => {
    res.json({ universities: await accounts.universities() });
  });
  return router;
}

export const accountErrorHandler: express.ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  res.set('Cache-Control', 'no-store');
  if (error instanceof AccountError) {
    const statusByCode: Record<AccountError['code'], number> = {
      VALIDATION_ERROR: 400, INVALID_CREDENTIALS: 401, AUTH_REQUIRED: 401,
    };
    sendError(res, statusByCode[error.code], error.code, error.message, error.fields);
    return;
  }
  const kind = (error as { type?: string } | null)?.type;
  if (kind === 'entity.parse.failed' || kind === 'entity.too.large') {
    res.status(kind === 'entity.too.large' ? 413 : 400).json({ error: {
      code: kind === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
      message: 'No se pudieron procesar los datos enviados.',
    } });
    return;
  }
  // No exponer mensajes de Prisma, conexiones ni stacks en respuestas HTTP.
  res.status(503).json({ error: {
    code: 'SERVICE_UNAVAILABLE', message: 'El servicio no está disponible. Intentá nuevamente.',
  } });
};
