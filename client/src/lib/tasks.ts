export const TASK_STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  BACKLOG: 'bg-slate-100 text-slate-600 border-slate-200',
  TODO: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_REVIEW: 'bg-purple-50 text-purple-700 border-purple-200',
  DONE: 'bg-green-50 text-green-700 border-green-200',
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  NONE: 'None',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export interface TaskSummary {
  BACKLOG: number;
  TODO: number;
  IN_PROGRESS: number;
  IN_REVIEW: number;
  DONE: number;
  total: number;
}
