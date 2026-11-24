import { useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef, () => {
    if (!pending) onClose();
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        tabIndex={-1}
        className="card p-6 max-w-md w-full shadow-xl outline-none"
      >
        <h2 id="confirm-title" className="text-lg font-bold text-slate-900 mb-2">
          {title}
        </h2>
        <p id="confirm-description" className="text-sm text-slate-600 mb-5">
          {description}
        </p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={pending} className="btn-secondary text-xs">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className="btn-danger text-xs">
            {pending ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
