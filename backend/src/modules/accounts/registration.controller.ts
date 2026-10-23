import { json, Router } from 'express';
import type { ErrorRequestHandler, Response } from 'express';
import { RegistrationError } from './registration.service.js';
import type { RegistrationErrorCode, RegistrationService } from './registration.service.js';

export type RegistrationHandlerService = Pick<RegistrationService, 'register'>;

function httpError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

const registrationStatuses: Record<RegistrationErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNIVERSITY_NOT_FOUND: 400,
  EMAIL_ALREADY_REGISTERED: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Adaptador HTTP: no conoce Prisma ni realiza validaciones de negocio. */
export function createRegistrationRouter(service: RegistrationHandlerService, production = false) {
  const router = Router();

  router.post('/', (request, response, next) => {
    if (request.get('X-Biblioteca-Request') !== '1') {
      httpError(response, 403, 'FORBIDDEN', 'La solicitud no está autorizada.');
      return;
    }
    if (!request.is('application/json')) {
      httpError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'El contenido debe enviarse como JSON.');
      return;
    }
    next();
  }, json({ limit: 16 * 1024 }), async (request, response) => {
    try {
      const { publicResponse, cookie } = await service.register(request.body);
      // HTTP representa Expires con precisión de segundos: redondear hacia abajo.
      const expiresAt = Math.floor(cookie.expiresAt.getTime() / 1000) * 1000;
      const remainingMs = expiresAt - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        throw new RegistrationError('SERVICE_UNAVAILABLE');
      }
      response.cookie('biblioteca_session', cookie.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: production,
        // No pasar maxAge: Express lo usaría para recalcular y sobrescribir Expires.
        expires: new Date(expiresAt),
      });
      response.status(201).json(publicResponse);
    } catch (error) {
      if (error instanceof RegistrationError) {
        // Reconstruir el mensaje evita propagar mensajes internos agregados por un adaptador.
        const safeError = new RegistrationError(error.code);
        response.status(registrationStatuses[error.code]).json({
          error: { code: error.code, message: safeError.message, ...(error.fields ? { fields: error.fields } : {}) },
        });
        return;
      }
      httpError(response, 500, 'INTERNAL_ERROR', 'No se pudo completar el registro.');
    }
  });

  // Captura errores del parser solo para esta ruta; nunca serializa body, stack ni cause.
  const parseErrorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    if (type === 'entity.too.large') {
      httpError(response, 413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera el límite de 16 KiB.');
    } else if (type === 'entity.parse.failed') {
      httpError(response, 400, 'VALIDATION_ERROR', 'El cuerpo debe contener JSON válido.');
    } else if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
      httpError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'La codificación del contenido no es compatible.');
    } else {
      httpError(response, 500, 'INTERNAL_ERROR', 'No se pudo completar el registro.');
    }
  };
  router.use(parseErrorHandler);
  return router;
}
