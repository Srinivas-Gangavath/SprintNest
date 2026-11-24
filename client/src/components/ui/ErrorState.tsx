export default function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary text-xs shrink-0">
          Try again
        </button>
      )}
    </div>
  );
}
