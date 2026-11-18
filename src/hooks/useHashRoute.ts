import { useCallback, useEffect, useState } from 'react';

export type AppRoute =
  | { view: 'home' }
  | { view: 'settings' }
  | { view: 'cycle'; cycleId: string }
  | { view: 'cycle-settings'; cycleId: string }
  | { view: 'sprint'; cycleId: string; sprintId: string }
  | { view: 'task'; cycleId: string; sprintId: string; taskId: string };

function parseHash(hash: string): AppRoute {
  const cleaned = hash.replace(/^#/, '');
  const parts = cleaned.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) {
    return { view: 'home' };
  }
  if (parts[0] === 'settings') {
    return { view: 'settings' };
  }
  if (parts[0] === 'cycle' && parts[1]) {
    const cycleId = parts[1];
    if (parts[2] === 'settings') {
      return { view: 'cycle-settings', cycleId };
    }
    if (parts[2] === 'sprint' && parts[3]) {
      const sprintId = parts[3];
      if (parts[4] === 'task' && parts[5]) {
        return { view: 'task', cycleId, sprintId, taskId: parts[5] };
      }
      return { view: 'sprint', cycleId, sprintId };
    }
    return { view: 'cycle', cycleId };
  }
  return { view: 'home' };
}

export function buildHash(route: AppRoute): string {
  switch (route.view) {
    case 'home':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'cycle':
      return `#/cycle/${encodeURIComponent(route.cycleId)}`;
    case 'cycle-settings':
      return `#/cycle/${encodeURIComponent(route.cycleId)}/settings`;
    case 'sprint':
      return `#/cycle/${encodeURIComponent(route.cycleId)}/sprint/${encodeURIComponent(route.sprintId)}`;
    case 'task':
      return `#/cycle/${encodeURIComponent(route.cycleId)}/sprint/${encodeURIComponent(route.sprintId)}/task/${encodeURIComponent(route.taskId)}`;
  }
}

export function useHashRoute() {
  const [route, setRoute] = useState<AppRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute, options?: { replace?: boolean }) => {
    const targetHash = buildHash(nextRoute);
    if (options?.replace) {
      window.history.replaceState(null, '', targetHash);
      setRoute(nextRoute);
    } else if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    } else {
      setRoute(nextRoute);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return { route, navigate };
}
