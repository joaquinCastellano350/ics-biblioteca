import { database } from '../database.js';
import { requiredEnv } from '../env.js';
import { NotificationRepository } from './notification-repository.js';
import { NotificationWorker } from './notification-worker.js';
import { ResendEmailSender } from './resend-email-sender.js';

// Entrada para el proceso periódico externo del ADR. No inicia Express ni
// modifica préstamos, colas o reservas. Cada reclamación confirma antes de HTTPS.
try {
  const worker = new NotificationWorker(new NotificationRepository(database),
    new ResendEmailSender(requiredEnv('RESEND_API_KEY'), requiredEnv('MAIL_FROM')), requiredEnv('PUBLIC_WEB_ORIGIN'));
  await worker.runBatch();
} catch {
  console.error('No se pudo procesar el correo pendiente. Revisá la configuración y la conexión; los avisos se conservan.');
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
