import type { NotificationOutbox } from '../generated/prisma/client.js';
import type { EmailMessage } from './notification.js';
import { renderNotificationEmail } from './notification-template.js';

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Contenido estable entre reintentos: no depende de la hora del proceso. */
export function notificationMessage(notification: NotificationOutbox, circulationUrl: string): EmailMessage | null {
  const payload = notification.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || typeof payload['bookTitle'] !== 'string' || !payload['bookTitle'].trim()) return null;
  const title = `«${payload['bookTitle']}»`;
  const footer = `Ingresá con tu cuenta para consultar tus préstamos y reservas: ${circulationUrl}`;
  let subject: string;
  let text: string;
  let heading: string;
  let detailLabel = 'Vencimiento de tu préstamo';
  let detailValue = '';
  let deadline: string | undefined;
  switch (notification.kind) {
    case 'TURN_AVAILABLE':
      if (!validInstant(payload['expiresAt'])) return null;
      subject = 'Tu turno llegó · Biblioteca Digital Universitaria';
      heading = 'Tu próxima lectura te espera';
      detailLabel = 'Plazo para aceptar tu reserva';
      detailValue = formatDeadline(payload['expiresAt']);
      deadline = payload['expiresAt'];
      text = `Reservamos un cupo de ${title} para vos durante 24 horas. El plazo vence el ${payload['expiresAt']} (UTC).`;
      break;
    case 'QUEUE_LIMIT_REJECTED':
      subject = 'Tu espera se cerró por límite de préstamos';
      heading = 'Una actualización sobre tu espera';
      detailLabel = 'Estado de tu entrada en cola';
      detailValue = 'Cerrada por límite de préstamos';
      text = `Al llegar tu turno para ${title} ya tenías cinco préstamos activos. Cerramos tu entrada en cola y ofrecimos el cupo a la siguiente persona elegible. Cuando tengas menos de cinco préstamos, podés volver a unirte al final de la cola.`;
      break;
    case 'LOAN_DAY_10':
    case 'LOAN_DUE_IN_3_DAYS':
    case 'LOAN_EXPIRED': {
      if (!validInstant(payload['dueAt'])) return null;
      const dueAt = payload['dueAt'];
      deadline = dueAt;
      detailValue = formatDeadline(dueAt);
      if (notification.kind === 'LOAN_DAY_10') {
        subject = 'Recordatorio de tu préstamo · Biblioteca Digital Universitaria';
        heading = '¿Cómo va esa lectura?';
        text = `Se cumplieron diez días desde la concesión de tu préstamo de ${title}. Su vencimiento es el ${dueAt} (UTC).`;
      } else if (notification.kind === 'LOAN_DUE_IN_3_DAYS') {
        subject = 'Aviso previo al vencimiento de tu préstamo';
        heading = 'Tu préstamo está por vencer';
        text = `Este recordatorio de ${title} fue programado para tres días antes del vencimiento: ${dueAt} (UTC).`;
      } else {
        subject = 'Tu préstamo venció · Biblioteca Digital Universitaria';
        heading = 'Tu préstamo llegó a su fin';
        text = `Tu préstamo de ${title} venció el ${dueAt} (UTC). El acceso de lectura finalizó en ese instante.`;
      }
      break;
    }
    default: return null;
  }
  const htmlBody = deadline ? text.replace(`${deadline} (UTC)`, detailValue) : text;
  const html = renderNotificationEmail({ subject, heading, preheader: subject, body: htmlBody,
    bookTitle: payload['bookTitle'], detailLabel, detailValue, actionUrl: circulationUrl });
  return { to: notification.recipientEmail, idempotencyKey: notification.dedupKey, subject, text: `${text} ${footer}`, html };
}

function formatDeadline(value: string): string {
  return `${new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC', hourCycle: 'h23',
  }).format(new Date(value))} (UTC)`;
}
