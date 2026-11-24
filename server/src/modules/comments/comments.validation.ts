import { z } from 'zod';

export const commentTaskParamsSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
  projectId: z.string().uuid('Invalid project ID'),
  taskId: z.string().uuid('Invalid task ID'),
});

export const commentParamsSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
  projectId: z.string().uuid('Invalid project ID'),
  taskId: z.string().uuid('Invalid task ID'),
  commentId: z.string().uuid('Invalid comment ID'),
});

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Comment body is required').max(10000).trim(),
  parentId: z.string().uuid('Invalid parent comment ID').optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().min(1, 'Comment body is required').max(10000).trim(),
});
