import { useState, useCallback, useEffect, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { api, ApiError } from '../lib/api';
import { useSocketEvent } from '../hooks/useSocket';

// ─── Types ───────────────────────────────────────────

interface CommentAuthor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface Comment {
  id: string;
  taskId: string;
  body: string;
  parentId: string | null;
  isEdited: boolean;
  author: CommentAuthor;
  createdAt: string;
  updatedAt: string;
  replies?: Comment[];
}

interface TaskCommentsProps {
  orgId: string;
  projectId: string;
  taskId: string;
  currentUserId: string;
  currentUserRole: string;
}

// ─── Helper: relative time ──────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Single Comment Component ───────────────────────

function CommentItem({
  comment,
  currentUserId,
  currentUserRole,
  onReply,
  onEdit,
  onDelete,
  isReply = false,
}: {
  comment: Comment;
  currentUserId: string;
  currentUserRole: string;
  onReply: (parentId: string) => void;
  onEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
  isReply?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);

  const canModify =
    comment.author.id === currentUserId ||
    currentUserRole === 'OWNER' ||
    currentUserRole === 'ADMIN';

  const handleSaveEdit = () => {
    if (!editBody.trim()) return;
    onEdit(comment.id, editBody.trim());
    setIsEditing(false);
  };

  return (
    <div className={`group ${isReply ? 'ml-8 pl-4 border-l-2 border-slate-100' : ''}`}>
      <div className="flex items-start gap-2.5 py-2.5">
        <div className="w-7 h-7 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-700 text-[10px] font-bold flex-shrink-0 mt-0.5">
          {comment.author.displayName[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold text-slate-800">{comment.author.displayName}</span>
            <span className="text-[10px] text-slate-400" title={new Date(comment.createdAt).toLocaleString()}>
              {timeAgo(comment.createdAt)}
            </span>
            {comment.isEdited && (
              <span className="text-[9px] text-slate-400 italic">(edited)</span>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="input text-sm min-h-[60px] resize-y"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 px-2 py-0.5 rounded bg-brand-50 hover:bg-brand-100 transition-colors">
                  Save
                </button>
                <button onClick={() => { setIsEditing(false); setEditBody(comment.body); }} className="text-[11px] text-slate-500 hover:text-slate-700 px-2 py-0.5">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-700 prose prose-sm prose-slate max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                {comment.body}
              </ReactMarkdown>
            </div>
          )}

          {/* Actions */}
          {!isEditing && (
            <div className="flex items-center gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isReply && (
                <button onClick={() => onReply(comment.id)} className="text-[10px] text-slate-400 hover:text-brand-600 font-medium transition-colors">
                  Reply
                </button>
              )}
              {canModify && (
                <>
                  <button onClick={() => setIsEditing(true)} className="text-[10px] text-slate-400 hover:text-slate-600 font-medium transition-colors">
                    Edit
                  </button>
                  <button onClick={() => onDelete(comment.id)} className="text-[10px] text-slate-400 hover:text-red-600 font-medium transition-colors">
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-1">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              isReply
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────

export default function TaskComments({
  orgId,
  projectId,
  taskId,
  currentUserId,
  currentUserRole,
}: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New comment form
  const [newBody, setNewBody] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const baseUrl = `/api/v1/orgs/${orgId}/projects/${projectId}/tasks/${taskId}/comments`;

  const fetchComments = useCallback(async () => {
    try {
      const res = await api.get<{ data: { comments: Comment[] } }>(baseUrl);
      setComments(res.data.comments);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Real-time sync: refetch this task's thread when anyone in the project room
  // adds, edits, or deletes one of its comments.
  const syncIfSameTask = useCallback(
    (payload: { taskId?: string }) => {
      if (payload?.taskId === taskId) void fetchComments();
    },
    [taskId, fetchComments],
  );

  useSocketEvent('comment:created', syncIfSameTask);
  useSocketEvent('comment:updated', syncIfSameTask);
  useSocketEvent('comment:deleted', syncIfSameTask);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newBody.trim()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await api.post(baseUrl, {
        body: newBody.trim(),
        parentId: replyingTo || undefined,
      });
      setNewBody('');
      setReplyingTo(null);
      await fetchComments();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (commentId: string, body: string) => {
    try {
      await api.patch(`${baseUrl}/${commentId}`, { body });
      await fetchComments();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.delete(`${baseUrl}/${commentId}`);
      await fetchComments();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  const handleReply = (parentId: string) => {
    setReplyingTo(parentId);
  };

  // Find the parent comment name for reply indicator
  const replyParentName = replyingTo
    ? comments.find((c) => c.id === replyingTo)?.author.displayName
    : null;

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-3">
        Comments {!isLoading && `(${comments.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0)})`}
      </label>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 mb-3 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-2">×</button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="text-xs text-slate-400 text-center py-6">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-6 bg-slate-50 rounded-lg border border-slate-100">
          No comments yet. Be the first to comment.
        </div>
      ) : (
        <div className="space-y-1 mb-4">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Reply indicator */}
      {replyingTo && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-brand-50 rounded text-xs text-brand-700">
          <span>Replying to <strong>{replyParentName}</strong></span>
          <button onClick={() => setReplyingTo(null)} className="text-brand-500 hover:text-brand-700 font-bold ml-auto">×</button>
        </div>
      )}

      {/* New comment form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder={replyingTo ? 'Write a reply...' : 'Add a comment... (Markdown supported)'}
          className="input text-sm min-h-[40px] max-h-[120px] resize-y flex-1"
          rows={1}
        />
        <button
          type="submit"
          disabled={isSubmitting || !newBody.trim()}
          className="btn-primary text-xs py-2 px-3 self-end whitespace-nowrap"
        >
          {isSubmitting ? '...' : replyingTo ? 'Reply' : 'Comment'}
        </button>
      </form>
    </div>
  );
}
