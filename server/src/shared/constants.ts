export const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type OrgRoleType = (typeof ORG_ROLES)[number];

export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
export type TaskStatusType = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriorityType = (typeof TASK_PRIORITIES)[number];

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;

/** Roles that are allowed in invitations (cannot invite as OWNER) */
export const INVITABLE_ROLES = ['ADMIN', 'MEMBER'] as const;

/** CSRF custom header name */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

/** Cookie names */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Invitation token TTL in days */
export const INVITATION_TTL_DAYS = 7;

/** Password reset token TTL in hours */
export const PASSWORD_RESET_TTL_HOURS = 1;
