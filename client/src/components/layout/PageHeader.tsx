import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import Breadcrumbs, { type Crumb } from '../ui/Breadcrumbs';

export default function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
}) {
  return (
    <div className="space-y-3">
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
          {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6', className)}>
      {children}
    </div>
  );
}

export function WorkspaceAlert({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex justify-between items-center gap-3">
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-red-500 hover:text-red-700 font-bold rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}
