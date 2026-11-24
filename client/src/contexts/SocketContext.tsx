import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';

/** Handshake rejection reasons that a token refresh can plausibly fix. */
const RECOVERABLE_AUTH_ERRORS = new Set(['UNAUTHENTICATED', 'TOKEN_EXPIRED']);

/** Give up and sign out rather than retry a failing handshake forever. */
const MAX_AUTH_RECOVERY_ATTEMPTS = 3;

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  joinProject: (projectId: string) => void;
  leaveProject: (projectId: string) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * Owns the single Socket.IO connection for the application session.
 *
 * The connection follows the authenticated user: it opens once after login and
 * closes on logout. Socket.IO handles transient network drops on its own; an
 * expired access token is recovered through the existing REST refresh endpoint.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  // Kept in state so consumers re-render and can attach their listeners.
  const [socket, setSocket] = useState<Socket | null>(null);

  const socketRef = useRef<Socket | null>(null);
  /** Project rooms this session belongs to, replayed after every reconnect. */
  const joinedProjectsRef = useRef<Set<string>>(new Set());
  /** De-duplicates concurrent refresh calls across rapid connect_error bursts. */
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const authRecoveryAttemptsRef = useRef(0);

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const attempt = api
      .post('/api/v1/auth/refresh')
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInFlightRef.current = null;
      });

    refreshInFlightRef.current = attempt;
    return attempt;
  }, []);

  useEffect(() => {
    if (!user) return;

    const activeSocket = io({
      path: '/socket.io',
      withCredentials: true,
      // Transport-level drops are retried by Socket.IO. Authentication
      // failures are handled explicitly in `connect_error` below.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      autoConnect: false,
    });
    socketRef.current = activeSocket;
    setSocket(activeSocket);

    activeSocket.on('connect', () => {
      authRecoveryAttemptsRef.current = 0;
      setIsConnected(true);
      // Re-subscribe to whatever the user is currently looking at. The server
      // re-authorizes each join, so this cannot widen access.
      for (const projectId of joinedProjectsRef.current) {
        activeSocket.emit('join:project', projectId);
      }
    });

    activeSocket.on('disconnect', () => setIsConnected(false));

    activeSocket.on('connect_error', (err: Error) => {
      setIsConnected(false);

      if (!RECOVERABLE_AUTH_ERRORS.has(err.message)) return;

      // Stop the automatic retry loop: reconnecting with the same expired
      // cookie would fail identically.
      activeSocket.disconnect();

      if (authRecoveryAttemptsRef.current >= MAX_AUTH_RECOVERY_ATTEMPTS) {
        void logout();
        return;
      }
      authRecoveryAttemptsRef.current += 1;

      void refreshAccessToken().then((refreshed) => {
        if (socketRef.current !== activeSocket) return;
        if (refreshed) {
          activeSocket.connect();
        } else {
          // Session is genuinely over — clear auth state and let the route
          // guard redirect to the login page.
          void logout();
        }
      });
    });

    activeSocket.connect();

    return () => {
      activeSocket.removeAllListeners();
      activeSocket.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    };
  }, [user?.id, logout, refreshAccessToken]);

  const joinProject = useCallback((projectId: string) => {
    joinedProjectsRef.current.add(projectId);
    socketRef.current?.emit('join:project', projectId);
  }, []);

  const leaveProject = useCallback((projectId: string) => {
    joinedProjectsRef.current.delete(projectId);
    socketRef.current?.emit('leave:project', projectId);
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, joinProject, leaveProject }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocketContext must be used within SocketProvider');
  return ctx;
}
