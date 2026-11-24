import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { loginPathWithRedirect, redirectFromSearch } from './lib/redirect';
import AppShell from './components/layout/AppShell';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));
const AcceptInvitationPage = lazy(() => import('./pages/AcceptInvitationPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center" role="status">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-500 font-medium">Loading...</span>
      </div>
    </div>
  );
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div role="alert" className="max-w-md text-center">
            <h1 className="text-lg font-semibold text-slate-900 mb-2">This page failed to load</h1>
            <p className="text-sm text-slate-600 mb-4">The page could not be downloaded. Reload to try again.</p>
            <button type="button" className="btn-primary text-sm" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-slate-500 font-medium">Loading SprintNest...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={loginPathWithRedirect(location.pathname + location.search)} replace />;
  }

  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <PageFallback />;
  }

  if (user) {
    return <Navigate to={redirectFromSearch(location.search) ?? '/dashboard'} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/orgs/:orgId/projects/:projectId" element={<ProjectPage />}>
              <Route path="tasks/:taskId" element={<Outlet />} />
            </Route>
          </Route>

          <Route path="/invitations/:token/accept" element={<AcceptInvitationPage />} />

          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <RegisterPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicOnlyRoute>
                <ForgotPasswordPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/reset-password"
            element={
              <PublicOnlyRoute>
                <ResetPasswordPage />
              </PublicOnlyRoute>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  );
}
