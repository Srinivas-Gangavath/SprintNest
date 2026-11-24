import type { Request } from 'express';
import type { OrgRole } from '@prisma/client';

/** Authenticated user context attached by auth middleware */
export interface AuthUser {
  id: string;
  email: string;
}

/** Organization membership context attached by resolveOrg middleware */
export interface OrgContext {
  orgId: string;
  role: OrgRole;
}

/** Extended Express Request with auth context */
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

/** Extended Express Request with auth + org context */
export interface OrgScopedRequest extends AuthenticatedRequest {
  org: OrgContext;
}

/** Standard API success response shape */
export interface ApiResponse<T = unknown> {
  status: 'success';
  data: T;
}

/** Standard API error response shape */
export interface ApiErrorResponse {
  status: 'error';
  statusCode: number;
  message: string;
  errors?: Array<{ field: string; message: string }>;
  requestId?: string;
}
