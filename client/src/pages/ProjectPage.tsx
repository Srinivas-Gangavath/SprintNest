import { lazy, Suspense, useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { useParams, useNavigate, Link, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrg } from '../contexts/OrgContext';
import { api, ApiError } from '../lib/api';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useProjectRoute } from '../hooks/useProjectRoute';
import { useProjectRoom, useSocket, useSocketEvent } from '../hooks/useSocket';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import ErrorState from '../components/ui/ErrorState';

const TaskComments = lazy(() => import('../components/TaskComments'));

// ─── Types ───────────────────────────────────────────────

interface Task {
  id: string;
  projectId: string;
  taskNumber: number;
  title: string;
  description: string | null;
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  priority: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignee: { id: string; displayName: string; email: string } | null;
  createdBy: { id: string; displayName: string };
  dueDate: string | null;
  completedAt: string | null;
  labels: Label[];
  createdAt: string;
  updatedAt: string;
}

interface Label {
  id: string;
  name: string;
  color: string;
  orgId: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  taskCounter: number;
}

interface OrgMember {
  id: string;
  userId: string;
  role: string;
  user: { id: string; displayName: string; email: string };
}

const STATUS_COLS = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;

const STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
};

const STATUS_COLORS: Record<string, string> = {
  BACKLOG: 'bg-slate-100 text-slate-600 border-slate-200',
  TODO: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_REVIEW: 'bg-purple-50 text-purple-700 border-purple-200',
  DONE: 'bg-green-50 text-green-700 border-green-200',
};

const PRIORITY_LABELS: Record<string, string> = {
  NONE: '—',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

const PRIORITY_COLORS: Record<string, string> = {
  NONE: 'text-slate-400',
  LOW: 'text-blue-500',
  MEDIUM: 'text-amber-500',
  HIGH: 'text-orange-500',
  URGENT: 'text-red-600',
};

const PRIORITY_ICONS: Record<string, string> = {
  NONE: '○',
  LOW: '↓',
  MEDIUM: '→',
  HIGH: '↑',
  URGENT: '⚡',
};

// ─── Component ───────────────────────────────────────────

export default function ProjectPage() {
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  const { taskId: routeTaskId } = useProjectRoute();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizations } = useOrg();
  const routeRole = organizations.find((org) => org.id === orgId)?.role;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Task creation
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [createInStatus, setCreateInStatus] = useState<string>('TODO');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('NONE');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskLabels, setNewTaskLabels] = useState<string[]>([]);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  // Task detail view
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskAccess, setTaskAccess] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'forbidden'>('idle');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const createTaskRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const taskPanelRef = useRef<HTMLDivElement>(null);

  // Labels management
  const [showLabelsModal, setShowLabelsModal] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3B82F6');

  // Filters
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');

  const isAdminOrOwner = routeRole === 'OWNER' || routeRole === 'ADMIN';
  const projectPath = orgId && projectId ? `/orgs/${orgId}/projects/${projectId}` : '/projects';

  const closeTask = useCallback(() => {
    setEditingField(null);
    setConfirmDelete(false);
    navigate(projectPath);
  }, [navigate, projectPath]);

  const openTask = useCallback(
    (id: string) => {
      if (!orgId || !projectId) return;
      navigate(`/orgs/${orgId}/projects/${projectId}/tasks/${id}`);
    },
    [navigate, orgId, projectId],
  );

  useFocusTrap(showCreateTask, createTaskRef, () => setShowCreateTask(false));
  useFocusTrap(showLabelsModal, labelsRef, () => setShowLabelsModal(false));
  useFocusTrap(Boolean(routeTaskId) && !isLoading && Boolean(project) && !confirmDelete && !showCreateTask && !showLabelsModal, taskPanelRef, closeTask);

  // ─── Data Fetching ───────────────────────────────────

  const viewedProject = useRef({ orgId, projectId });
  viewedProject.current = { orgId, projectId };

  const fetchProject = useCallback(async () => {
    if (!orgId || !projectId) return;
    try {
      const res = await api.get<{ data: { project: Project } }>(`/api/v1/orgs/${orgId}/projects/${projectId}`);
      if (viewedProject.current.orgId !== orgId || viewedProject.current.projectId !== projectId) return;
      setProject(res.data.project);
      setError(null);
    } catch (err) {
      if (viewedProject.current.orgId !== orgId || viewedProject.current.projectId !== projectId) return;
      setProject(null);
      setError(err instanceof ApiError ? err.message : 'This project could not be loaded.');
    }
  }, [orgId, projectId]);

  const fetchTasks = useCallback(async () => {
    if (!orgId || !projectId) return;
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterPriority) params.set('priority', filterPriority);
      if (filterAssignee) params.set('assigneeId', filterAssignee);
      const res = await api.get<{ data: { tasks: Task[] } }>(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks?${params}`);
      if (viewedProject.current.orgId !== orgId || viewedProject.current.projectId !== projectId) return;
      setTasks(res.data.tasks);
    } catch (err) {
      if (viewedProject.current.orgId !== orgId || viewedProject.current.projectId !== projectId) return;
      setError(err instanceof ApiError ? err.message : 'Tasks could not be loaded.');
    }
  }, [orgId, projectId, filterPriority, filterAssignee]);

  const fetchLabels = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await api.get<{ data: { labels: Label[] } }>(`/api/v1/orgs/${orgId}/labels`);
      setLabels(res.data.labels);
    } catch { /* ignore */ }
  }, [orgId]);

  const fetchMembers = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await api.get<{ data: { members: OrgMember[] } }>(`/api/v1/orgs/${orgId}/members`);
      setMembers(res.data.members);
    } catch { /* ignore */ }
  }, [orgId]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setProject(null);
    Promise.all([fetchProject(), fetchLabels(), fetchMembers()]).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchProject, fetchLabels, fetchMembers]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!routeTaskId || !orgId || !projectId) {
      setSelectedTask(null);
      setTaskAccess('idle');
      return;
    }

    let cancelled = false;
    setSelectedTask(null);
    setTaskAccess('loading');
    setEditingField(null);

    api
      .get<{ data: { task: Task } }>(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${routeTaskId}`)
      .then((res) => {
        if (cancelled) return;
        setSelectedTask(res.data.task);
        setTaskAccess('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setSelectedTask(null);
        setTaskAccess(err instanceof ApiError && err.statusCode === 403 ? 'forbidden' : 'missing');
      });

    return () => {
      cancelled = true;
    };
  }, [routeTaskId, orgId, projectId]);

  // ─── Real-Time Sync ──────────────────────────────────
  // Subscribe to this project's room while the board is open. Socket events are
  // only signals — the board state itself still comes from the REST API, so a
  // missed event self-heals on the next fetch or page open.

  const { isConnected } = useSocket();
  useProjectRoom(projectId);

  useSocketEvent('task:created', () => { void fetchTasks(); });

  useSocketEvent<{ task?: Task }>('task:updated', (payload) => {
    void fetchTasks();
    // Keep an open slide-out in sync when someone else edits the same task.
    setSelectedTask((prev) =>
      prev && payload.task && prev.id === payload.task.id ? payload.task : prev,
    );
  });

  useSocketEvent<{ taskId?: string }>('task:deleted', (payload) => {
    void fetchTasks();
    if (payload.taskId && payload.taskId === routeTaskId) {
      setSelectedTask(null);
      setTaskAccess('missing');
    }
  });

  // Members can change while the board is open (affects assignee pickers).
  useSocketEvent('member:added', () => { void fetchMembers(); });
  useSocketEvent('member:removed', () => { void fetchMembers(); });

  // ─── Create Task ─────────────────────────────────────

  const handleCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !projectId || !newTaskTitle.trim()) return;
    setIsCreatingTask(true);
    setError(null);

    try {
      await api.post(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks`, {
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || undefined,
        status: createInStatus,
        priority: newTaskPriority,
        assigneeId: newTaskAssignee || undefined,
        labelIds: newTaskLabels.length > 0 ? newTaskLabels : undefined,
      });
      setNewTaskTitle('');
      setNewTaskDescription('');
      setNewTaskPriority('NONE');
      setNewTaskAssignee('');
      setNewTaskLabels([]);
      setShowCreateTask(false);
      await fetchTasks();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setIsCreatingTask(false);
    }
  };

  // ─── Update Task Status (quick drag-style) ────────────

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    if (!orgId || !projectId) return;
    try {
      await api.patch(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`, { status: newStatus });
      await fetchTasks();
      if (selectedTask?.id === taskId) {
        setSelectedTask(prev => prev ? { ...prev, status: newStatus as Task['status'] } : null);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  // ─── Update Task Field ──────────────────────────────

  const handleUpdateTask = async (taskId: string, data: Record<string, unknown>) => {
    if (!orgId || !projectId) return;
    try {
      const res = await api.patch<{ data: { task: Task } }>(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`, data);
      setSelectedTask(res.data.task);
      await fetchTasks();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  // ─── Delete Task ─────────────────────────────────────

  const handleDeleteTask = async () => {
    if (!orgId || !projectId || !selectedTask) return;
    try {
      await api.delete(`/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${selectedTask.id}`);
      setConfirmDelete(false);
      navigate(projectPath);
      await fetchTasks();
    } catch (err) {
      setConfirmDelete(false);
      setError(err instanceof ApiError ? err.message : 'This task could not be deleted.');
    }
  };

  // ─── Labels CRUD ─────────────────────────────────────

  const handleCreateLabel = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !newLabelName.trim()) return;
    try {
      await api.post(`/api/v1/orgs/${orgId}/labels`, { name: newLabelName.trim(), color: newLabelColor });
      setNewLabelName('');
      setNewLabelColor('#3B82F6');
      await fetchLabels();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  const handleDeleteLabel = async (labelId: string) => {
    if (!orgId) return;
    try {
      await api.delete(`/api/v1/orgs/${orgId}/labels/${labelId}`);
      await fetchLabels();
      await fetchTasks();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  // ─── Group tasks by status ───────────────────────────

  const tasksByStatus: Record<string, Task[]> = {};
  for (const col of STATUS_COLS) {
    tasksByStatus[col] = tasks.filter(t => t.status === col);
  }

  // ─── Render ──────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-500 font-medium">Loading project...</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 space-y-4">
        <ErrorState message={error ?? 'Project not found.'} />
        <div className="text-center">
          <button type="button" onClick={() => navigate('/projects')} className="btn-primary text-sm">
            Back to projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              to="/projects"
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              <span className="text-sm font-medium">Projects</span>
            </Link>
            <div className="h-5 w-px bg-slate-200 shrink-0" />
            <h1 className="text-lg font-bold text-slate-900 truncate">{project.name}</h1>
            {project.isArchived && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">ARCHIVED</span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {!isConnected && (
              <span
                className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium text-slate-400"
                title="Live updates are reconnecting. The board still works normally."
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Reconnecting
              </span>
            )}
            <button type="button" onClick={() => setShowLabelsModal(true)} className="text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              🏷 Labels
            </button>
            <button
              type="button"
              onClick={() => { setCreateInStatus('TODO'); setShowCreateTask(true); }}
              className="btn-primary text-xs py-1.5 px-3"
            >
              + New Task
            </button>
          </div>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="text-red-500 hover:text-red-700 font-bold ml-4">×</button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-slate-500 font-medium">Filters:</span>
        <select aria-label="Filter by priority" value={filterPriority} onChange={e => { setFilterPriority(e.target.value); }} className="text-xs border border-slate-200 rounded-md px-2 py-1 text-slate-600 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <option value="">All Priorities</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Filter by assignee" value={filterAssignee} onChange={e => { setFilterAssignee(e.target.value); }} className="text-xs border border-slate-200 rounded-md px-2 py-1 text-slate-600 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <option value="">All Assignees</option>
          {members.map(m => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
        </select>
        <span className="text-slate-400 ml-auto">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Board View */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 p-4 sm:p-6 min-w-max">
          {STATUS_COLS.map(status => (
            <div key={status} className="w-72 flex-shrink-0">
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${STATUS_COLORS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{tasksByStatus[status].length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setCreateInStatus(status); setShowCreateTask(true); }}
                  className="text-slate-400 hover:text-brand-600 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={`Add task to ${STATUS_LABELS[status]}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>
              </div>

              {/* Task Cards */}
              <div className="space-y-2">
                {tasksByStatus[status].map(task => (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => openTask(task.id)}
                    className="interactive-card w-full text-left bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-brand-300 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {/* Labels */}
                    {task.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {task.labels.map(l => (
                          <span key={l.id} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: l.color }}>
                            {l.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Title */}
                    <p className="text-sm font-medium text-slate-800 leading-snug mb-2">{task.title}</p>

                    {/* Meta */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-mono">#{task.taskNumber}</span>
                      <div className="flex items-center gap-2">
                        {/* Priority */}
                        <span className={`text-[10px] font-bold ${PRIORITY_COLORS[task.priority]}`} title={PRIORITY_LABELS[task.priority]}>
                          {PRIORITY_ICONS[task.priority]}
                        </span>
                        {/* Assignee */}
                        {task.assignee && (
                          <div className="w-5 h-5 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center text-[9px] font-bold text-brand-700" title={task.assignee.displayName}>
                            {task.assignee.displayName[0]?.toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Modal: Create Task ────────────────────────── */}
      {showCreateTask && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={createTaskRef} role="dialog" aria-modal="true" aria-labelledby="create-task-title" tabIndex={-1} className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl outline-none">
            <h3 id="create-task-title" className="text-lg font-bold text-slate-900 mb-1">New Task</h3>
            <p className="text-xs text-slate-500 mb-4">Adding to <span className="font-semibold text-slate-700">{STATUS_LABELS[createInStatus]}</span></p>
            <form onSubmit={handleCreateTask} className="space-y-3">
              <div>
                <label className="label">Title *</label>
                <input type="text" required value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="What needs to be done?" className="input" autoFocus />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea value={newTaskDescription} onChange={e => setNewTaskDescription(e.target.value)} placeholder="Add details..." className="input min-h-[80px] resize-y" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value)} className="input cursor-pointer">
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{PRIORITY_ICONS[k]} {v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Assignee</label>
                  <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} className="input cursor-pointer">
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
                  </select>
                </div>
              </div>
              {labels.length > 0 && (
                <div>
                  <label className="label">Labels</label>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map(l => (
                      <button key={l.id} type="button"
                        onClick={() => setNewTaskLabels(prev => prev.includes(l.id) ? prev.filter(id => id !== l.id) : [...prev, l.id])}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${newTaskLabels.includes(l.id) ? 'text-white border-transparent ring-2 ring-offset-1 ring-brand-300' : 'text-slate-600 border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                        style={newTaskLabels.includes(l.id) ? { backgroundColor: l.color } : {}}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setShowCreateTask(false)} className="btn-secondary text-xs">Cancel</button>
                <button type="submit" disabled={isCreatingTask || !newTaskTitle.trim()} className="btn-primary text-xs">
                  {isCreatingTask ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Slide-out: Task Detail ───────────────────── */}
      {routeTaskId && (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close task" onClick={closeTask} />
          <div
            ref={taskPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-panel-title"
            tabIndex={-1}
            className="ml-auto relative bg-white w-full max-w-xl shadow-2xl border-l border-slate-200 overflow-y-auto animate-slide-in outline-none"
          >
            <div className="p-6">
              <h2 id="task-panel-title" className="sr-only">{selectedTask?.title ?? 'Task details'}</h2>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-slate-400 font-mono">{selectedTask ? `#${selectedTask.taskNumber}` : 'Task'}</span>
                <div className="flex items-center gap-2">
                  {selectedTask && (
                    <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Delete</button>
                  )}
                  <button type="button" onClick={closeTask} aria-label="Close task" className="text-slate-400 hover:text-slate-600 p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              {taskAccess === 'loading' && !selectedTask && (
                <p className="text-sm text-slate-500" role="status">Loading task...</p>
              )}
              {taskAccess === 'missing' && (
                <p className="text-sm text-slate-600" role="status">Task not found.</p>
              )}
              {taskAccess === 'forbidden' && (
                <p className="text-sm text-slate-600" role="status">You don&apos;t have access to this task.</p>
              )}
              {selectedTask && (<>

              {/* Title */}
              {editingField === 'title' ? (
                <input type="text" defaultValue={selectedTask.title} autoFocus
                  onBlur={e => { handleUpdateTask(selectedTask.id, { title: e.target.value }); setEditingField(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                  className="input text-xl font-bold mb-4" />
              ) : (
                <h2 onClick={() => setEditingField('title')} className="text-xl font-bold text-slate-900 mb-4 cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 py-0.5 transition-colors">{selectedTask.title}</h2>
              )}

              {/* Status, Priority, Assignee Grid */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Status</label>
                  <select value={selectedTask.status}
                    onChange={e => handleStatusChange(selectedTask.id, e.target.value)}
                    className="text-xs font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 w-full bg-slate-50 cursor-pointer"
                  >
                    {STATUS_COLS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Priority</label>
                  <select value={selectedTask.priority}
                    onChange={e => handleUpdateTask(selectedTask.id, { priority: e.target.value })}
                    className="text-xs font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 w-full bg-slate-50 cursor-pointer"
                  >
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Assignee</label>
                  <select value={selectedTask.assignee?.id || ''}
                    onChange={e => handleUpdateTask(selectedTask.id, { assigneeId: e.target.value || null })}
                    className="text-xs font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 w-full bg-slate-50 cursor-pointer"
                  >
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Due Date</label>
                  <input type="date" value={selectedTask.dueDate?.split('T')[0] || ''}
                    onChange={e => handleUpdateTask(selectedTask.id, { dueDate: e.target.value || null })}
                    className="text-xs font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 w-full bg-slate-50 cursor-pointer"
                  />
                </div>
              </div>

              {/* Labels */}
              <div className="mb-5">
                <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-2">Labels</label>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map(l => {
                    const isActive = selectedTask.labels.some(tl => tl.id === l.id);
                    return (
                      <button key={l.id}
                        onClick={() => {
                          const currentIds = selectedTask.labels.map(tl => tl.id);
                          const newIds = isActive ? currentIds.filter(id => id !== l.id) : [...currentIds, l.id];
                          handleUpdateTask(selectedTask.id, { labelIds: newIds });
                        }}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${isActive ? 'text-white border-transparent' : 'text-slate-500 border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                        style={isActive ? { backgroundColor: l.color } : {}}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Description */}
              <div className="mb-5">
                <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-2">Description</label>
                {editingField === 'description' ? (
                  <textarea defaultValue={selectedTask.description || ''} autoFocus rows={4}
                    onBlur={e => { handleUpdateTask(selectedTask.id, { description: e.target.value || null }); setEditingField(null); }}
                    className="input text-sm resize-y" />
                ) : (
                  <div onClick={() => setEditingField('description')}
                    className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 min-h-[80px] cursor-pointer hover:bg-slate-100 transition-colors border border-slate-100"
                  >
                    {selectedTask.description || <span className="text-slate-400 italic">Click to add a description...</span>}
                  </div>
                )}
              </div>

              {/* Comments */}
              {orgId && projectId && user && (
                <Suspense fallback={<p className="text-xs text-slate-500" role="status">Loading comments...</p>}>
                  <TaskComments
                    orgId={orgId}
                    projectId={projectId}
                    taskId={selectedTask.id}
                    currentUserId={user.id}
                    currentUserRole={routeRole || 'MEMBER'}
                  />
                </Suspense>
              )}

              {/* Meta */}
              <div className="border-t border-slate-100 pt-4 space-y-1.5 text-xs text-slate-400">
                <div>Created by <span className="text-slate-600 font-medium">{selectedTask.createdBy.displayName}</span> on {new Date(selectedTask.createdAt).toLocaleDateString()}</div>
                {selectedTask.completedAt && <div>Completed on {new Date(selectedTask.completedAt).toLocaleDateString()}</div>}
              </div>
              </>)}
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Labels Management ─────────────────── */}
      {showLabelsModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={labelsRef} role="dialog" aria-modal="true" aria-labelledby="labels-title" tabIndex={-1} className="card p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl outline-none">
            <div className="flex items-center justify-between mb-4">
              <h3 id="labels-title" className="text-lg font-bold text-slate-900">Manage Labels</h3>
              <button type="button" onClick={() => setShowLabelsModal(false)} aria-label="Close labels" className="text-slate-400 hover:text-slate-600 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Create Label Form */}
            {isAdminOrOwner && (
              <form onSubmit={handleCreateLabel} className="flex items-end gap-2 mb-4 pb-4 border-b border-slate-100">
                <div className="flex-1">
                  <label className="label">Name</label>
                  <input type="text" value={newLabelName} onChange={e => setNewLabelName(e.target.value)} placeholder="Label name" className="input text-sm" />
                </div>
                <div className="w-20">
                  <label className="label">Color</label>
                  <input type="color" value={newLabelColor} onChange={e => setNewLabelColor(e.target.value)} className="h-[38px] w-full rounded-lg border border-slate-300 cursor-pointer p-0.5" />
                </div>
                <button type="submit" disabled={!newLabelName.trim()} className="btn-primary text-xs whitespace-nowrap py-2.5">Add</button>
              </form>
            )}

            {/* Labels list */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {labels.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No labels yet</p>
              ) : (
                labels.map(l => (
                  <div key={l.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50">
                    <div className="flex items-center gap-2.5">
                      <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: l.color }} />
                      <span className="text-sm font-medium text-slate-700">{l.name}</span>
                    </div>
                    {isAdminOrOwner && (
                      <button onClick={() => handleDeleteLabel(l.id)} className="text-xs text-slate-400 hover:text-red-600 transition-colors">Remove</button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        description="This removes the task for everyone in the project."
        confirmLabel="Delete task"
        onConfirm={() => void handleDeleteTask()}
        onClose={() => setConfirmDelete(false)}
      />
      <Outlet />

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slideIn 0.2s ease-out; }
      `}</style>
    </div>
  );
}
