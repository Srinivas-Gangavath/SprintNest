import type { EmailProvider, SendEmailOptions } from './email.provider.js';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

/**
 * Resend email provider for production.
 * Uses Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
 * No SDK dependency — simple fetch call.
 */
export class ResendEmailProvider implements EmailProvider {
  private apiKey: string;
  private from: string;

  constructor() {
    if (!config.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required for the Resend email provider');
    }
    this.apiKey = config.RESEND_API_KEY;
    // Resend's free tier requires onboarding@resend.dev or a verified domain
    this.from = config.RESEND_FROM_EMAIL ?? 'SprintNest <onboarding@resend.dev>';
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        { status: response.status, body },
        'Resend API error',
      );
      throw new Error(`Resend API error: ${response.status}`);
    }

    logger.info({ to: options.to, subject: options.subject }, 'Email sent via Resend');
  }
}
