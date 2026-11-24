/**
 * Centralized notification type definitions.
 * Future phases can extend this list safely.
 */
export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'task_assigned',
  COMMENT_ADDED: 'comment_added',
  INVITATION_RECEIVED: 'invitation_received',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Typed notification data payloads for each notification type.
 * The `data` JSONB column stores these structured payloads.
 */
export interface TaskAssignedData {
  taskId: string;
  projectId: string;
  orgId: string;
  taskTitle: string;
  projectName: string;
  assignedByName: string;
}

export interface CommentAddedData {
  commentId: string;
  taskId: string;
  projectId: string;
  orgId: string;
  taskTitle: string;
  commenterName: string;
}

export interface InvitationReceivedData {
  invitationId: string;
  orgId: string;
  orgName: string;
  invitedByName: string;
  role: string;
}

export type NotificationData =
  | TaskAssignedData
  | CommentAddedData
  | InvitationReceivedData;
