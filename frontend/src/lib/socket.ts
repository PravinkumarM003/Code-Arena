import { io, Socket } from 'socket.io-client';
import { auth } from '../config/firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

let socket: Socket | null = null;

// Guard against React StrictMode calling getSocket() twice rapidly.
// The second call awaits the first instead of creating a duplicate.
let connectingPromise: Promise<Socket> | null = null;

/**
 * Get or create the Socket.IO connection.
 * Always fetches a fresh (cached) Firebase token on creation so that
 * reconnects after the 1-hour token TTL don't fail with "Unauthorized".
 */
export async function getSocket(): Promise<Socket> {
  // If socket exists but is NOT connected, destroy it so we start fresh
  // with a newly-fetched token. This fixes stale-token Unauthorized errors.
  if (socket && !socket.connected && !socket.io._reconnecting) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    connectingPromise = null;
  }

  if (socket?.connected) return socket;

  // If a connection attempt is already in-flight (e.g. React StrictMode
  // double-mount), return the same promise instead of creating a duplicate.
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    // forceRefresh=false uses the cached token if still valid; Firebase
    // automatically refreshes it when within the 5-minute expiry window.
    const token = await user.getIdToken(false);

    socket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 60000,
    });

    // Refresh the Firebase token before every reconnect attempt.
    // This ensures that after the 1-hour token TTL, the server's
    // verifyIdToken() call still succeeds instead of returning Unauthorized.
    socket.on('reconnect_attempt', async () => {
      try {
        const currentUser = auth.currentUser;
        if (currentUser) {
          const freshToken = await currentUser.getIdToken(false);
          socket!.auth = { token: freshToken };
        }
      } catch {
        // If token refresh fails, the reconnect will still be attempted
        // and the server will reject with Unauthorized — handled below.
      }
    });

    // If the server rejects us with Unauthorized (e.g. after token expiry
    // during a long session), force a full recreation on the next getSocket() call.
    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') {
        socket?.removeAllListeners();
        socket?.disconnect();
        socket = null;
        connectingPromise = null;
      }
    });

    return socket;
  })();

  // Clear the in-flight guard once the promise settles (success or failure)
  connectingPromise.catch(() => { connectingPromise = null; });

  return connectingPromise;
}

export function getExistingSocket(): Socket | null {
  return socket;
}

export async function disconnectSocket(): Promise<void> {
  connectingPromise = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

