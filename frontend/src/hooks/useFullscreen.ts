import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Enforces fullscreen based on a boolean flag.
 * Returns { isFullscreen, enterFullscreen, exitFullscreen }.
 */
export function useFullscreen(shouldBeFullscreen: boolean) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(!!document.fullscreenElement);
  const shouldBeFullscreenRef = useRef(shouldBeFullscreen);

  useEffect(() => {
    shouldBeFullscreenRef.current = shouldBeFullscreen;
  }, [shouldBeFullscreen]);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        setIsFullscreen(true);
      }
    } catch {
      // Browser blocked (requires user click)
      setIsFullscreen(false);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (shouldBeFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  }, [shouldBeFullscreen, enterFullscreen, exitFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return { isFullscreen, enterFullscreen, exitFullscreen };
}

