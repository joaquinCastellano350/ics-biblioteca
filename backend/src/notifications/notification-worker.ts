import { EmailDeliveryError, type EmailSender } from './notification.js';
import type { NotificationRepository } from './notification-repository.js';
import { notificationMessage } from './notification-message.js';

export class NotificationWorker {
  private readonly circulationUrl: string;

  constructor(private readonly notifications: NotificationRepository, private readonly sender: EmailSender, origin: string) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('PUBLIC_WEB_ORIGIN debe ser el origen web de la aplicación.');
    }
    this.circulationUrl = new URL('/prestamos', url).href;
  }

  async runBatch(limit = 20): Promise<void> {
    for (let index = 0; index < limit; index++) {
      const notification = await this.notifications.claim();
      if (!notification) break;
      if (!await this.notifications.canSend(notification)) {
        await this.notifications.finish(notification, { state: 'CANCELLED' });
        continue;
      }
      const message = notificationMessage(notification, this.circulationUrl);
      if (!message) {
        await this.notifications.finish(notification, { state: 'FAILED', error: 'INVALID_NOTIFICATION_PAYLOAD' });
        continue;
      }
      if (!await this.notifications.deliveryWindowOpen(notification)) {
        await this.notifications.finish(notification, { state: 'FAILED', error: 'DELIVERY_WINDOW_EXPIRED' });
        continue;
      }
      try {
        const providerMessageId = await this.sender.send(message);
        await this.notifications.finish(notification, { state: 'SENT', providerMessageId });
      } catch (error) {
        await this.notifications.finish(notification, {
          state: error instanceof EmailDeliveryError && error.permanent ? 'FAILED' : 'PENDING',
          error: error instanceof EmailDeliveryError ? error.code : 'EMAIL_DELIVERY_FAILED',
        });
      }
    }
  }
}
