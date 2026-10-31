export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<string>;
}

/** Códigos controlados: no persistir respuestas que puedan contener secretos. */
export class EmailDeliveryError extends Error {
  constructor(public readonly code: string, public readonly permanent = false) { super(code); }
}
