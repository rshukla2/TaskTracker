import type { AppSettings, Task, WorkCycle, WorkflowStatus } from './types';

export function getEffectiveStatuses(
  cycle: Pick<WorkCycle, 'useCustomStatuses' | 'customStatuses'>,
  settings: Pick<AppSettings, 'defaultStatuses'>
): WorkflowStatus[] {
  return cycle.useCustomStatuses ? cycle.customStatuses : settings.defaultStatuses;
}

export function getStatusName(
  statusId: string | null,
  statuses: ReadonlyArray<WorkflowStatus>
): string | null {
  if (!statusId) return null;
  const found = statuses.find((s) => s.id === statusId);
  return found ? found.name : null;
}

export function isBlockedStatus(
  statusId: string | null,
  statuses: ReadonlyArray<WorkflowStatus>
): boolean {
  if (!statusId) return false;
  if (statusId === 'status-blocked') {
    const found = statuses.find((s) => s.id === statusId);
    if (!found || found.name.trim().toLowerCase() === 'blocked') {
      return true;
    }
  }
  const found = statuses.find((s) => s.id === statusId);
  return found ? found.name.trim().toLowerCase() === 'blocked' : false;
}

export function findCompletedStatus(
  statuses: ReadonlyArray<WorkflowStatus>
): WorkflowStatus | null {
  const byId = statuses.find((s) => s.id === 'status-completed');
  if (byId) return byId;
  const byName = statuses.find((s) => s.name.trim().toLowerCase() === 'completed');
  return byName ?? null;
}

export function findTasksUsingStatus(
  tasks: ReadonlyArray<Task>,
  statusId: string
): Task[] {
  return tasks.filter((t) => t.statusId === statusId);
}

export function findUnmatchedTasksForStatusList(
  tasks: ReadonlyArray<Task>,
  sourceStatuses: ReadonlyArray<WorkflowStatus>,
  targetStatuses: ReadonlyArray<WorkflowStatus>
): {
  affectedTasks: Task[];
  unmatchedGroups: Array<{ statusId: string; statusName: string; count: number }>;
} {
  const targetIds = new Set(targetStatuses.map((s) => s.id));
  const sourceNameMap = new Map(sourceStatuses.map((s) => [s.id, s.name]));
  const counts = new Map<string, number>();
  const affectedTasks: Task[] = [];

  for (const task of tasks) {
    if (task.statusId && !targetIds.has(task.statusId)) {
      affectedTasks.push(task);
      counts.set(task.statusId, (counts.get(task.statusId) ?? 0) + 1);
    }
  }

  const unmatchedGroups = Array.from(counts.entries()).map(([statusId, count]) => ({
    statusId,
    statusName: sourceNameMap.get(statusId) ?? 'Unknown status',
    count,
  }));

  return { affectedTasks, unmatchedGroups };
}

export function replaceOrClearTasksStatus(
  tasks: ReadonlyArray<Task>,
  replacements: Record<string, string | null>
): Task[] {
  const nowIso = new Date().toISOString();
  const updated: Task[] = [];
  for (const task of tasks) {
    if (task.statusId && task.statusId in replacements) {
      updated.push({
        ...task,
        statusId: replacements[task.statusId],
        updatedAt: nowIso,
      });
    }
  }
  return updated;
}
