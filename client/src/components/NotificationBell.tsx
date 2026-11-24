import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocketEvent } from '../hooks/useSocket';
import { notificationIcon, timeAgo, type AppNotification } from '../lib/notifications';

interface NotificationsResponse {
  status: string;
  data: {
    notifications: AppNotification[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

interface UnreadCountResponse {
  status: string;
  data: { unreadCount: number };
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
      return () => {
        document.removeEventListener('mousedown', handleClick);
        document.removeEventListener('keydown', handleKey);
      };
    }
  }, [isOpen]);

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<UnreadCountResponse>('/api/v1/notifications/unread-count'),
    refetchInterval: 30000,
  });

  const { data: notifData, isLoading, error } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<NotificationsResponse>('/api/v1/notifications?limit=15'),
    enabled: isOpen,
  });

  useSocketEvent('notification:new', () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  const unreadCount = unreadData?.data?.unreadCount ?? 0;
  const notifications = notifData?.data?.notifications ?? [];

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => api.patch(`/api/v1/notifications/${notificationId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post('/api/v1/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleMarkRead = useCallback(
    (id: string) => {
      markReadMutation.mutate(id);
    },
    [markReadMutation],
  );

  const label =
    unreadCount > 0
      ? `Notifications, ${unreadCount} unread`
      : 'Notifications';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        id="notification-bell"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'notification-panel' : undefined}
        className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label={label}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Notifications</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="text-[11px] font-medium text-brand-600 hover:text-brand-700 transition-colors disabled:opacity-50 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="py-10 text-center text-xs text-slate-400">Loading…</div>
            ) : error ? (
              <div className="py-10 text-center text-xs text-red-500">Failed to load notifications</div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <div className="text-2xl mb-1">🔔</div>
                <p className="text-xs text-slate-400">No notifications yet</p>
              </div>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      className={`w-full text-left flex items-start gap-2.5 px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-brand-50 ${
                        !notification.isRead ? 'bg-brand-50/40' : ''
                      }`}
                      onClick={() => {
                        if (!notification.isRead) handleMarkRead(notification.id);
                      }}
                    >
                      <span className="text-sm mt-0.5 shrink-0" aria-hidden="true">
                        {notificationIcon(notification.type)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span
                          className={`text-xs leading-relaxed block ${
                            !notification.isRead ? 'text-slate-800 font-medium' : 'text-slate-500'
                          }`}
                        >
                          {notification.title}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5 block">{timeAgo(notification.createdAt)}</span>
                      </span>
                      {!notification.isRead && (
                        <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0 mt-1.5" aria-label="Unread" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2.5">
            <Link
              to="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
