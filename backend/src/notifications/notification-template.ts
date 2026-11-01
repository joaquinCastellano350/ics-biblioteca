import { readFileSync } from 'node:fs';

const template = readFileSync(new URL('./templates/notification.html', import.meta.url), 'utf8');

interface NotificationContent {
  subject: string;
  heading: string;
  preheader: string;
  body: string;
  bookTitle: string;
  detailLabel: string;
  detailValue: string;
  actionUrl: string;
  actionLabel: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** Sustituye una sola vez: los datos nunca se interpretan como HTML o plantilla. */
export function renderNotificationEmail(content: NotificationContent): string {
  const url = new URL(content.actionUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('El enlace del correo debe ser una URL web sin credenciales.');
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(content, key)) throw new Error('Variable desconocida en la plantilla del correo.');
    return escapeHtml(content[key as keyof NotificationContent]);
  });
}
