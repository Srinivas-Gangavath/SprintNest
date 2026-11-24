import { z } from 'zod';

export const labelIdParamSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
  labelId: z.string().uuid('Invalid label ID'),
});

export const createLabelSchema = z.object({
  name: z.string().min(1, 'Label name is required').max(50).trim(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code (e.g., #FF5733)').optional(),
});

export const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).trim().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code').optional(),
});
