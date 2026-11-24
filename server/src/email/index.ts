import type { EmailProvider } from './email.provider.js';
import { ConsoleEmailProvider } from './console.provider.js';
import { ResendEmailProvider } from './resend.provider.js';
import { config } from '../config/index.js';

/** Factory: returns the configured email provider */
export function createEmailProvider(): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider();
    case 'console':
    default:
      return new ConsoleEmailProvider();
  }
}

export const emailProvider = createEmailProvider();
