import { EmailDeliveryError, type EmailMessage, type EmailSender } from './notification.js';

export class ResendEmailSender implements EmailSender {
  constructor(private readonly apiKey: string, private readonly from: string,
    private readonly request: typeof fetch = fetch) {}

  async send(message: EmailMessage): Promise<string> {
    let response: Response;
    try {
      response = await this.request('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      });
    } catch { throw new EmailDeliveryError('RESEND_NETWORK_ERROR'); }
    if (!response.ok) {
      // Cuota/ritmo, conflicto en curso y problemas de cuenta conservan reintentos.
      const permanent = [400, 413, 422].includes(response.status);
      throw new EmailDeliveryError(`RESEND_HTTP_${response.status}`, permanent);
    }
    let result: unknown;
    try { result = await response.json(); } catch { throw new EmailDeliveryError('RESEND_INVALID_RESPONSE'); }
    if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
      throw new EmailDeliveryError('RESEND_INVALID_RESPONSE');
    }
    return result.id;
  }
}
