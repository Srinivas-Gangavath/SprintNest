import { z } from 'zod';

/** Documented placeholder in `.env.example` — must never reach production. */
const DEV_JWT_SECRET_PLACEHOLDER = 'dev-jwt-secret-change-in-production';
const LOCALHOST_HOST = /(localhost|127\.0\.0\.1|\[::1\])/i;

/**
 * Optional variable that may be present-but-blank in a `.env` file.
 * Blank is normalized to `undefined` so `??` defaults still apply.
 */
const optionalEnv = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

/** Exported so tests can assert the validation rules without touching process.env. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),

    DATABASE_URL: z.string().url(),
    /** Direct non-pooled connection for Neon migrations (optional locally, defaults to DATABASE_URL) */
    DIRECT_URL: optionalEnv,
    REDIS_URL: z.string().default('redis://localhost:6379'),

    JWT_SECRET: z.string().min(16),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().default(7),

    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: optionalEnv,
    /** Resend accepts either `user@domain` or `Name <user@domain>`. */
    RESEND_FROM_EMAIL: optionalEnv,

    APP_URL: z.string().url().default('http://localhost:3000'),

    /** Optional override for the directory holding the built React SPA. */
    CLIENT_DIST_PATH: optionalEnv,
  })
  .superRefine((env, ctx) => {
    // Selecting Resend without a key would otherwise throw when the provider is
    // constructed at import time, which surfaces as an opaque boot crash.
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    // Guard against development defaults leaking into a production deploy.
    if (env.JWT_SECRET === DEV_JWT_SECRET_PLACEHOLDER || env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET must be a unique secret of at least 32 characters in production',
      });
    }

    // Invitation and password-reset links are built from APP_URL.
    if (LOCALHOST_HOST.test(env.APP_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'APP_URL must be the public site URL in production, not localhost',
      });
    }

    if (LOCALHOST_HOST.test(env.REDIS_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL must be the production Redis endpoint, not localhost',
      });
    }

    // Console is the local default; production must send through Resend.
    if (env.EMAIL_PROVIDER !== 'resend') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: 'EMAIL_PROVIDER must be resend in production',
      });
    }
  });

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const config = loadConfig();

export const isProduction = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';
