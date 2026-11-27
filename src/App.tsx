import { useHashRoute } from './hooks/useHashRoute';
import { useLocalToday } from './hooks/useLocalToday';
import { useWorkspace, WorkspaceProvider } from './state/WorkspaceContext';
import { HomeView } from './views/HomeView';
import { SettingsView } from './views/SettingsView';
import { SprintDetailView } from './views/SprintDetailView';
import { TaskDetailView } from './views/TaskDetailView';
import { WorkCycleDetailView } from './views/WorkCycleDetailView';
import { WorkCycleSettingsView } from './views/WorkCycleSettingsView';

function TaskTrackerRouter() {
  const { loading, error } = useWorkspace();
  const { route, navigate } = useHashRoute();
  const today = useLocalToday();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4 text-sm text-slate-600">
        Loading workspace…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          <p className="font-semibold">Unable to open local storage</p>
          <p className="mt-1 text-rose-800">{error}</p>
        </div>
      </div>
    );
  }

  switch (route.view) {
    case 'home':
      return (
        <HomeView
          today={today}
          onOpenCycle={(cycleId) => navigate({ view: 'cycle', cycleId })}
          onOpenSettings={() => navigate({ view: 'settings' })}
        />
      );
    case 'settings':
      return <SettingsView onBack={() => navigate({ view: 'home' })} />;
    case 'cycle':
      return (
        <WorkCycleDetailView
          cycleId={route.cycleId}
          today={today}
          onBack={() => navigate({ view: 'home' })}
          onOpenCycleSettings={() =>
            navigate({ view: 'cycle-settings', cycleId: route.cycleId })
          }
          onOpenSprint={(sprintId) =>
            navigate({ view: 'sprint', cycleId: route.cycleId, sprintId })
          }
        />
      );
    case 'cycle-settings':
      return (
        <WorkCycleSettingsView
          cycleId={route.cycleId}
          onBack={() => navigate({ view: 'cycle', cycleId: route.cycleId })}
          onDeleted={() => navigate({ view: 'home' }, { replace: true })}
        />
      );
    case 'sprint':
      return (
        <SprintDetailView
          cycleId={route.cycleId}
          sprintId={route.sprintId}
          today={today}
          onBackToCycle={() => navigate({ view: 'cycle', cycleId: route.cycleId })}
          onOpenTask={(taskId) =>
            navigate({
              view: 'task',
              cycleId: route.cycleId,
              sprintId: route.sprintId,
              taskId,
            })
          }
          onSprintReplaced={(newSprintId) =>
            navigate(
              { view: 'sprint', cycleId: route.cycleId, sprintId: newSprintId },
              { replace: true }
            )
          }
        />
      );
    case 'task':
      return (
        <TaskDetailView
          cycleId={route.cycleId}
          sprintId={route.sprintId}
          taskId={route.taskId}
          today={today}
          onBackToSprint={() =>
            navigate({
              view: 'sprint',
              cycleId: route.cycleId,
              sprintId: route.sprintId,
            })
          }
          onMovedToSprint={(newSprintId) =>
            navigate({ view: 'task', cycleId: route.cycleId, sprintId: newSprintId, taskId: route.taskId }, { replace: true })
          }
        />
      );
  }
}

export default function App() {
  return (
    <WorkspaceProvider>
      <TaskTrackerRouter />
    </WorkspaceProvider>
  );
}
