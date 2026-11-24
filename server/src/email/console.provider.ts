import type { EmailProvider, SendEmailOptions } from './email.provider.js';
import { logger } from '../logger.js';

/** Development email provider — logs email content to stdout */
export class ConsoleEmailProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<void> {
    logger.info(
      {
        to: options.to,
        subject: options.subject,
      },
      `[EMAIL] Would send email to ${options.to}: "${options.subject}"`,
    );
    logger.debug({ html: options.html }, '[EMAIL] Body');
  }
}
