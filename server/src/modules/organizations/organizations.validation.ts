import { z } from 'zod';

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
});

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
});

export const orgIdParamSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
});
