import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <p className="text-sm font-semibold text-brand-600 mb-2">404</p>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Page not found</h1>
      <p className="text-sm text-slate-600 mb-6">That address does not match a SprintNest page.</p>
      <Link to="/dashboard" className="btn-primary text-sm">
        Back to dashboard
      </Link>
    </div>
  );
}
