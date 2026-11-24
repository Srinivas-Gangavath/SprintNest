import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrg, type Organization } from '../contexts/OrgContext';
import { api, ApiError } from '../lib/api';
import { loginPathWithRedirect } from '../lib/redirect';

/**
 * Handles the invitation link emailed by the server
 * (`${APP_URL}/invitations/:token/accept`).
 *
 * The token stays in the URL path only. It is never written to browser
 * storage and never logged. A new invitee registers
 * here; the server creates the account from the invitation email and accepts
 * it in one step. An existing invitee signs in and returns to this URL.
 */

type InvitationPreview = {
  email: string;
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  accountExists: boolean;
  expiresAt: string;
  organization: { id: string; name: string; slug: string };
  invitedBy: { displayName: string };
};

type Outcome =
  | { kind: 'loading' }
  | { kind: 'accepting' }
  | { kind: 'create-account'; invitation: InvitationPreview }
  | { kind: 'sign-in'; invitation: InvitationPreview }
  | { kind: 'accepted'; organization: Organization }
  | { kind: 'already-member' }
  | { kind: 'wrong-account'; message: string }
  | { kind: 'unusable'; message: string }
  | { kind: 'failed'; message: string };

interface AcceptResponse {
  data: { message: string; organization: Organization };
}

interface PreviewResponse {
  data: { invitation: InvitationPreview };
}

interface RegisterResponse {
  data: { message: string; organization: Organization };
}

function unusableMessage(invitation: InvitationPreview): string | null {
  if (invitation.status === 'EXPIRED') return 'This invitation has expired.';
  if (invitation.status === 'DECLINED') return 'This invitation was cancelled or declined.';
  if (invitation.status === 'ACCEPTED') return 'This invitation has already been used.';
  if (invitation.status !== 'PENDING') return 'This invitation is no longer available.';
  return null;
}

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoading, logout, refreshUser } = useAuth();
  const { setCurrentOrg, refreshOrganizations } = useOrg();

  const [outcome, setOutcome] = useState<Outcome>({ kind: 'loading' });
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Acceptance is a one-shot mutation; StrictMode remounts must not repeat it.
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setOutcome({ kind: 'unusable', message: 'This invitation link is incomplete.' });
      return;
    }
    if (isLoading) return;

    let ignore = false;
    api
      .get<PreviewResponse>(`/api/v1/invitations/${encodeURIComponent(token)}`)
      .then((res) => {
        if (ignore) return;
        setPreview(res.data.invitation);
      })
      .catch((err) => {
        if (ignore) return;
        const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
        setOutcome({ kind: 'unusable', message });
      });

    return () => {
      ignore = true;
    };
  }, [token, isLoading]);

  useEffect(() => {
    if (!token || !preview || isLoading) return;

    const blocked = unusableMessage(preview);
    if (blocked) {
      if (attemptedRef.current) return;
      setOutcome({ kind: 'unusable', message: blocked });
      return;
    }

    if (!user) {
      // A successful registration sets this before the session user arrives.
      if (attemptedRef.current) return;
      setOutcome(
        preview.accountExists
          ? { kind: 'sign-in', invitation: preview }
          : { kind: 'create-account', invitation: preview },
      );
      return;
    }

    if (attemptedRef.current) return;
    attemptedRef.current = true;
    setOutcome({ kind: 'accepting' });

    // Do not ignore this result on effect cleanup. StrictMode remounts in
    // development, and dropping the in-flight response leaves the spinner up.
    api
      .post<AcceptResponse>(`/api/v1/invitations/${encodeURIComponent(token)}/accept`)
      .then((res) => {
        const organization = res.data.organization;
        setCurrentOrg(organization);
        void refreshOrganizations();
        setOutcome({ kind: 'accepted', organization });
      })
      .catch((err) => {
        if (!(err instanceof ApiError)) {
          setOutcome({ kind: 'failed', message: 'Something went wrong. Please try again.' });
          return;
        }

        //  409 — membership already exists
        //  403 — invitation addressed to a different email
        //  400 — invalid, already used, declined, expired, or org unavailable
        if (err.statusCode === 401) {
          navigate(loginPathWithRedirect(`/invitations/${encodeURIComponent(token)}/accept`), { replace: true });
        } else if (err.statusCode === 409) {
          setOutcome({ kind: 'already-member' });
        } else if (err.statusCode === 403) {
          setOutcome({ kind: 'wrong-account', message: err.message });
        } else if (err.statusCode === 400) {
          setOutcome({ kind: 'unusable', message: err.message });
        } else {
          setOutcome({ kind: 'failed', message: err.message });
        }
      });
  }, [token, preview, user, isLoading, navigate, setCurrentOrg, refreshOrganizations]);

  const signInPath = token
    ? loginPathWithRedirect(`/invitations/${encodeURIComponent(token)}/accept`)
    : '/login';

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || outcome.kind !== 'create-account') return;
    setFormError('');
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<RegisterResponse>(
        `/api/v1/invitations/${encodeURIComponent(token)}/register`,
        { displayName, password, confirmPassword },
      );
      attemptedRef.current = true;
      const organization = res.data.organization;
      setCurrentOrg(organization);
      void refreshOrganizations();
      setOutcome({ kind: 'accepted', organization });
      await refreshUser();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setOutcome({ kind: 'sign-in', invitation: outcome.invitation });
        setFormError(err.message);
        return;
      }
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    await logout();
    if (preview && preview.status === 'PENDING') {
      setOutcome(
        preview.accountExists
          ? { kind: 'sign-in', invitation: preview }
          : { kind: 'create-account', invitation: preview },
      );
    }
  };

  const showForm = outcome.kind === 'create-account' || outcome.kind === 'sign-in';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Sprint<span className="text-brand-600">Nest</span>
          </h1>
          <p className="text-slate-500 mt-2">Workspace invitation</p>
        </div>

        <div className={`card p-8 ${showForm ? 'text-left' : 'text-center'}`}>
          {(outcome.kind === 'loading' || outcome.kind === 'accepting') && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500 font-medium">
                {outcome.kind === 'accepting' ? 'Accepting your invitation…' : 'Loading invitation…'}
              </p>
            </div>
          )}

          {outcome.kind === 'create-account' && (
            <>
              <h2 className="text-lg font-bold text-slate-900 mb-1 text-center">Create your account</h2>
              <p className="text-sm text-slate-500 mb-6 text-center">
                Join <strong className="text-slate-800">{outcome.invitation.organization.name}</strong> as{' '}
                <span className="font-medium text-brand-700">{outcome.invitation.role}</span>.
              </p>
              <form onSubmit={(e) => void handleRegister(e)} className="space-y-4">
                {formError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>
                )}
                <div>
                  <label htmlFor="invite-email" className="label">Email</label>
                  <input
                    id="invite-email"
                    type="email"
                    value={outcome.invitation.email}
                    readOnly
                    className="input bg-slate-50 text-slate-600"
                  />
                  <p className="text-xs text-slate-400 mt-1">This invitation is locked to this email address.</p>
                </div>
                <div>
                  <label htmlFor="displayName" className="label">Full name</label>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="input"
                    placeholder="Jane Smith"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="password" className="label">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    placeholder="Min. 8 characters"
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="label">Confirm password</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input"
                    required
                    minLength={8}
                  />
                </div>
                <button type="submit" className="btn-primary w-full" disabled={submitting}>
                  {submitting ? 'Creating account...' : 'Create Account'}
                </button>
              </form>
              <p className="text-center text-sm text-slate-500 mt-6">
                Already have an account?{' '}
                <Link to={signInPath} className="text-brand-600 font-medium hover:text-brand-700">
                  Sign in
                </Link>
              </p>
            </>
          )}

          {outcome.kind === 'sign-in' && (
            <div className="text-center">
              <h2 className="text-lg font-bold text-slate-900 mb-1">Sign in to join</h2>
              <p className="text-sm text-slate-500 mb-4">
                <strong className="text-slate-800">{outcome.invitation.organization.name}</strong> invited{' '}
                <span className="font-medium text-slate-700">{outcome.invitation.email}</span>.
              </p>
              {formError && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 mb-4 text-left">
                  {formError}
                </div>
              )}
              <Link to={signInPath} className="btn-primary w-full inline-block">
                Sign in
              </Link>
            </div>
          )}

          {outcome.kind === 'accepted' && (
            <>
              <div className="w-12 h-12 rounded-xl bg-green-50 border border-green-200 text-green-600 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">You're in</h2>
              <p className="text-sm text-slate-500 mb-6">
                You joined{' '}
                <strong className="text-slate-800">{outcome.organization.name}</strong> as{' '}
                <span className="font-medium text-brand-700">{outcome.organization.role}</span>.
              </p>
              <button type="button" onClick={() => navigate('/dashboard', { replace: true })} className="btn-primary w-full">
                Go to workspace
              </button>
            </>
          )}

          {outcome.kind === 'already-member' && (
            <>
              <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Already a member</h2>
              <p className="text-sm text-slate-500 mb-6">
                You already have access to this workspace — nothing else to do.
              </p>
              <button type="button" onClick={() => navigate('/dashboard', { replace: true })} className="btn-primary w-full">
                Go to dashboard
              </button>
            </>
          )}

          {outcome.kind === 'wrong-account' && (
            <>
              <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Wrong account</h2>
              <p className="text-sm text-slate-500 mb-2">{outcome.message}</p>
              <p className="text-xs text-slate-400 mb-6">
                You are signed in as <span className="font-medium text-slate-600">{user?.email}</span>.
                Sign in with the invited address to continue.
              </p>
              <button onClick={() => void handleSwitchAccount()} className="btn-primary w-full">
                Sign in with a different account
              </button>
            </>
          )}

          {(outcome.kind === 'unusable' || outcome.kind === 'failed') && (
            <>
              <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">
                {outcome.kind === 'unusable' ? 'Invitation unavailable' : 'Something went wrong'}
              </h2>
              <p className="text-sm text-slate-500 mb-6">{outcome.message}</p>
              <p className="text-xs text-slate-400 mb-6">
                Ask a workspace admin to send a new invitation.
              </p>
              <button type="button" onClick={() => navigate('/dashboard', { replace: true })} className="btn-secondary w-full">
                Back to dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
