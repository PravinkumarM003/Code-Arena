import { useEffect, useRef } from 'react';

/**
 * Enforces fullscreen based on a boolean flag.
 * - Requests fullscreen when `shouldBeFullscreen` becomes true.
 * - Exits fullscreen when `shouldBeFullscreen` becomes false (pause / end).
 * - If the user presses Escape while `shouldBeFullscreen` is still true,
 *   the hook immediately re-enters fullscreen.
 */
export function useFullscreen(shouldBeFullscreen: boolean) {
  const shouldBeFullscreenRef = useRef(shouldBeFullscreen);

  // Keep ref in sync so the event listener always sees the latest value
  useEffect(() => {
    shouldBeFullscreenRef.current = shouldBeFullscreen;
  });

  // Enter / exit fullscreen when the flag changes
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        }
      } catch {
        // Browser may block if no user gesture is recent; silently ignore
      }
    };

    const exitFullscreen = async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        // ignore
      }
    };

    if (shouldBeFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  }, [shouldBeFullscreen]);

  // Re-enter fullscreen if the user manually exits (Escape) while contest is still running
  useEffect(() => {
    const handleFullscreenChange = async () => {
      if (!document.fullscreenElement && shouldBeFullscreenRef.current) {
        // Small delay to avoid conflicting with the native exit animation
        await new Promise<void>((r) => setTimeout(r, 200));
        try {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch {
          // ignore
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
}
