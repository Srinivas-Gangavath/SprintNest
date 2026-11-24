import { z } from 'zod';

export const projectIdParamSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
  projectId: z.string().uuid('Invalid project ID'),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100).trim(),
  description: z.string().max(2000).trim().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(2000).trim().nullable().optional(),
});

export const archiveProjectSchema = z.object({
  isArchived: z.boolean(),
});

export const listProjectsQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional().default('false'),
});
