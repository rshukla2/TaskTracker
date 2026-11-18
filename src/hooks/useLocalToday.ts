import { useEffect, useState } from 'react';
import { msUntilNextLocalMidnight, todayLocal } from '../core/dates';
import type { LocalDateString } from '../core/types';

/**
 * Tracks the user's current local calendar date (YYYY-MM-DD).
 * Automatically updates when the app becomes visible again, regains focus,
 * or crosses local midnight while loaded.
 */
export function useLocalToday(): LocalDateString {
  const [today, setToday] = useState<LocalDateString>(() => todayLocal());

  useEffect(() => {
    const syncToday = () => {
      const current = todayLocal();
      setToday((prev) => (prev === current ? prev : current));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncToday();
      }
    };

    window.addEventListener('focus', syncToday);
    document.addEventListener('visibilitychange', handleVisibility);

    let midnightTimer: number | undefined;
    const scheduleMidnightCheck = () => {
      const waitMs = msUntilNextLocalMidnight();
      midnightTimer = window.setTimeout(() => {
        syncToday();
        scheduleMidnightCheck();
      }, waitMs);
    };
    scheduleMidnightCheck();

    return () => {
      window.removeEventListener('focus', syncToday);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (midnightTimer !== undefined) {
        window.clearTimeout(midnightTimer);
      }
    };
  }, []);

  return today;
}
