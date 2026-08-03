import { useEffect, useRef, useCallback } from 'react';
import { useContest } from '../contexts/ContestContext';

type AntiCheatEventType =
  | 'TAB_SWITCH'
  | 'FULLSCREEN_EXIT'
  | 'RIGHT_CLICK'
  | 'COPY_PASTE'
  | 'DEVTOOLS_OPEN'
  | 'VIEW_SOURCE'
  | 'REFRESH_ATTEMPT';

/**
 * Anti-cheat hook: enforces integrity rules during RUNNING state.
 * All events are logged server-side (never silently discarded).
 * Students are told upfront that monitoring is active.
 */
export function useAntiCheat(active: boolean) {
  const { socket } = useContest();
  const eventCounts = useRef<Record<string, number>>({});
  const lastEventTime = useRef<Record<string, number>>({});
  const fullscreenRequested = useRef(false);

  const reportEvent = useCallback(
    (type: AntiCheatEventType, detail?: string) => {
      // Debounce: ignore same event if < 2 seconds since last
      const now = Date.now();
      const last = lastEventTime.current[type] || 0;
      if (now - last < 2000) return;
      lastEventTime.current[type] = now;

      eventCounts.current[type] = (eventCounts.current[type] || 0) + 1;

      if (socket?.connected) {
        socket.emit('anticheat:event', { type, detail });
      }
    },
    [socket]
  );

  // ── Fullscreen enforcement ─────────────────────────────────────────────────
  const requestFullscreen = useCallback(() => {
    if (fullscreenRequested.current) return;
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {
        // User denied fullscreen — we can't force it, just report
      });
      fullscreenRequested.current = true;
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    // Request fullscreen on contest start
    requestFullscreen();

    // ── Event Listeners ───────────────────────────────────────────────────
    const handleVisibilityChange = () => {
      if (document.hidden) {
        reportEvent('TAB_SWITCH');
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && active) {
        reportEvent('FULLSCREEN_EXIT');
        // Re-request fullscreen after exit
        setTimeout(requestFullscreen, 1000);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      reportEvent('RIGHT_CLICK');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block Ctrl+C / Ctrl+V (copy/paste) ONLY when NOT inside Monaco editor
      // Students need copy/paste within the editor to refactor their own code
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v')) {
        const target = e.target as HTMLElement;
        const isInsideMonaco = target.closest('.monaco-editor') !== null;
        if (isInsideMonaco) return; // allow normal editor copy/paste
        e.preventDefault();
        reportEvent('COPY_PASTE', e.key === 'c' ? 'COPY' : 'PASTE');
        return;
      }

      // F12 or Ctrl+Shift+I (DevTools)
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        reportEvent('DEVTOOLS_OPEN');
        return;
      }

      // Ctrl+U (View Source)
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        reportEvent('VIEW_SOURCE');
        return;
      }

      // F5 / Ctrl+R (Refresh) — show confirmation
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
        e.preventDefault();
        reportEvent('REFRESH_ATTEMPT');
        return;
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Your progress will be saved. Are you sure you want to leave?';
      return e.returnValue;
    };

    // DevTools detection (window size heuristic)
    const devToolsTimer = setInterval(() => {
      const threshold = 160;
      if (
        window.outerWidth - window.innerWidth > threshold ||
        window.outerHeight - window.innerHeight > threshold
      ) {
        reportEvent('DEVTOOLS_OPEN', 'size-heuristic');
      }
    }, 3000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(devToolsTimer);
    };
  }, [active, reportEvent, requestFullscreen]);
}
