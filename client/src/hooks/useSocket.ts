import { useEffect, useRef } from 'react';
import { useSocketContext } from '../contexts/SocketContext';

/** Access the application's single Socket.IO connection. */
export function useSocket() {
  return useSocketContext();
}

/**
 * Subscribes to one server event for the lifetime of the component.
 *
 * The handler is read through a ref so callers can pass inline closures without
 * re-subscribing on every render.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): void {
  const { socket } = useSocketContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;

    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);

    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/**
 * Keeps the session subscribed to a project's room while the component is
 * mounted, and leaves it on navigation away.
 */
export function useProjectRoom(projectId: string | undefined): void {
  const { joinProject, leaveProject, socket } = useSocketContext();

  useEffect(() => {
    if (!projectId || !socket) return;

    joinProject(projectId);
    return () => leaveProject(projectId);
  }, [projectId, socket, joinProject, leaveProject]);
}
