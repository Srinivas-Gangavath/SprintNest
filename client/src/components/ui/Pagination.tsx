export default function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
  busy,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1 || busy}
        aria-label="Previous page"
        className="btn-secondary text-xs disabled:opacity-50"
      >
        Previous
      </button>
      <p className="text-xs text-slate-500 text-center">
        Page {page} of {totalPages}
        {typeof total === 'number' ? ` · ${total} total` : ''}
        {busy ? ' · Updating…' : ''}
      </p>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages || busy}
        aria-label="Next page"
        className="btn-secondary text-xs disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}
