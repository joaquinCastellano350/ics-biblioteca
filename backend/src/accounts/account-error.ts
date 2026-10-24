export type AccountErrorCode = 'VALIDATION_ERROR' | 'INVALID_CREDENTIALS' | 'AUTH_REQUIRED'
  | 'EMAIL_ALREADY_REGISTERED' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';

const messages: Record<AccountErrorCode, string> = {
  VALIDATION_ERROR: 'Revisá los datos ingresados.',
  INVALID_CREDENTIALS: 'El correo o la contraseña son incorrectos.',
  AUTH_REQUIRED: 'Iniciá sesión para continuar.',
  EMAIL_ALREADY_REGISTERED: 'El correo electrónico ya está registrado.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible. Intentá nuevamente más tarde.',
  INTERNAL_ERROR: 'No se pudo completar la operación.',
};

export class AccountError extends Error {
  constructor(public readonly code: AccountErrorCode, public readonly fields?: Record<string, string>) {
    super(messages[code]);
  }
}

/** Solo inspeccionar metadatos; nunca devolver mensajes originales de los proveedores. */
export function dependencyUnavailable(error: unknown): boolean {
  const codes = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1010', 'P1017', 'P2024',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P02', '57P03', '53300', '57014']);
  const kinds = new Set(['DatabaseNotReachable', 'ConnectionClosed', 'TlsConnectionError',
    'AuthenticationFailed', 'DatabaseAccessDenied', 'SocketTimeout']);
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): boolean {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return false;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const code = record['code'] ?? record['originalCode'];
    if ((typeof code === 'string' && (codes.has(code) || /^08[0-9A-Z]{3}$/.test(code)))
      || (typeof record['kind'] === 'string' && kinds.has(record['kind']))) return true;
    return ['meta', 'cause', 'driverAdapterError'].some((key) => visit(record[key], depth + 1));
  }
  return visit(error, 0);
}
