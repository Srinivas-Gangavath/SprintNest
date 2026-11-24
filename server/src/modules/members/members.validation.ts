import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

export const changeRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});

export const memberIdParamSchema = z.object({
  memberId: z.string().uuid('Invalid member ID'),
});

export const invitationTokenParamSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const invitationIdParamSchema = z.object({
  invitationId: z.string().uuid('Invalid invitation ID'),
});

export const registerFromInvitationSchema = z
  .object({
    displayName: z
      .string()
      .min(1, 'Display name is required')
      .max(100, 'Display name must not exceed 100 characters')
      .trim(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must not exceed 128 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
    // Optional. When present it must match the invitation; the account email
    // is always taken from the invitation itself.
    email: z.string().email('Invalid email address').max(255).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
