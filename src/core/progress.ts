import { diffDays } from './dates';
import type {
  LocalDateString,
  ProgressSummary,
  Sprint,
  Task,
  WorkCycle,
  WorkCycleTimeSection,
} from './types';

export function getWorkCycleTimeSection(
  cycle: Pick<WorkCycle, 'startDate' | 'endDate'>,
  today: LocalDateString
): WorkCycleTimeSection {
  if (today < cycle.startDate) {
    return 'upcoming';
  }
  if (today > cycle.endDate) {
    return 'past';
  }
  return 'active';
}

export function isTaskOverdue(
  task: Pick<Task, 'completed' | 'deadline'>,
  today: LocalDateString
): boolean {
  if (task.completed || !task.deadline) {
    return false;
  }
  return task.deadline < today;
}

export function isTaskDueToday(
  task: Pick<Task, 'completed' | 'deadline'>,
  today: LocalDateString
): boolean {
  if (task.completed || !task.deadline) {
    return false;
  }
  return task.deadline === today;
}

export function isTaskDeadlineOutsideSprint(
  task: Pick<Task, 'deadline'>,
  sprint: Pick<Sprint, 'startDate' | 'endDate'>
): boolean {
  if (!task.deadline) {
    return false;
  }
  return task.deadline < sprint.startDate || task.deadline > sprint.endDate;
}

export function isSprintOverdue(
  sprint: Pick<Sprint, 'endDate'>,
  progress: ProgressSummary,
  today: LocalDateString
): boolean {
  return today > sprint.endDate && !progress.isComplete;
}

/**
 * Calculates progress with each task counting equally.
 * Reserves 100% strictly for when every task is done (and total > 0).
 */
export function calculateProgress(tasks: ReadonlyArray<Pick<Task, 'completed'>>): ProgressSummary {
  const total = tasks.length;
  if (total === 0) {
    return {
      completed: 0,
      total: 0,
      percentage: 0,
      isComplete: false,
    };
  }

  const completed = tasks.reduce((acc, task) => acc + (task.completed ? 1 : 0), 0);
  if (completed === total) {
    return {
      completed,
      total,
      percentage: 100,
      isComplete: true,
    };
  }

  const rawPercent = Math.round((completed / total) * 100);
  const percentage = Math.min(99, Math.max(0, rawPercent));

  return {
    completed,
    total,
    percentage,
    isComplete: false,
  };
}

/**
 * Orders tasks within a sprint:
 * 1. Overdue unfinished tasks, earliest deadline first
 * 2. Other unfinished tasks with deadlines, earliest deadline first
 * 3. Unfinished tasks without deadlines
 * 4. Completed tasks at the bottom
 */
export function sortSprintTasks(tasks: ReadonlyArray<Task>, today: LocalDateString): Task[] {
  const getBucket = (task: Task): number => {
    if (task.completed) return 3;
    if (task.deadline && task.deadline < today) return 0;
    if (task.deadline) return 1;
    return 2;
  };

  return [...tasks].sort((a, b) => {
    const bucketA = getBucket(a);
    const bucketB = getBucket(b);
    if (bucketA !== bucketB) {
      return bucketA - bucketB;
    }

    if (bucketA === 0 || bucketA === 1) {
      const cmp = (a.deadline ?? '').localeCompare(b.deadline ?? '');
      if (cmp !== 0) return cmp;
    }

    if (bucketA === 3) {
      // Among completed tasks, keep tasks with deadlines or earlier creation ordered deterministically
      if (a.deadline && b.deadline) {
        const cmp = a.deadline.localeCompare(b.deadline);
        if (cmp !== 0) return cmp;
      } else if (a.deadline && !b.deadline) {
        return -1;
      } else if (!a.deadline && b.deadline) {
        return 1;
      }
    }

    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Orders tasks within a sprint by workflow status in the exact order configured in Settings
 * (or custom cycle statuses). Within the same status, falls back to deadline/overdue ordering.
 * For custom-status cycles where completed tasks don't receive an automatic Completed status,
 * completed tasks are grouped at the bottom after open tasks.
 */
export function sortSprintTasksByStatus(
  tasks: ReadonlyArray<Task>,
  statuses: ReadonlyArray<{ id: string }>,
  useCustomStatuses: boolean,
  today: LocalDateString
): Task[] {
  const statusRank = new Map<string, number>();
  statuses.forEach((s, index) => {
    statusRank.set(s.id, index);
  });

  const getRank = (task: Task): number => {
    if (useCustomStatuses && task.completed) {
      return statuses.length + 1;
    }
    if (task.statusId && statusRank.has(task.statusId)) {
      return statusRank.get(task.statusId)!;
    }
    // Open tasks without a status (or unset) come after defined statuses
    if (!task.completed) {
      return statuses.length;
    }
    return statuses.length + 1;
  };

  // Precompute deadline order so ties within the same status group preserve deadline/overdue order
  const deadlineOrdered = sortSprintTasks(tasks, today);
  const deadlineTieIndex = new Map<string, number>();
  deadlineOrdered.forEach((t, idx) => deadlineTieIndex.set(t.id, idx));

  return [...tasks].sort((a, b) => {
    const rankA = getRank(a);
    const rankB = getRank(b);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return (deadlineTieIndex.get(a.id) ?? 0) - (deadlineTieIndex.get(b.id) ?? 0);
  });
}

export function sortWorkCycles(cycles: ReadonlyArray<WorkCycle>, today: LocalDateString): {
  active: WorkCycle[];
  upcoming: WorkCycle[];
  past: WorkCycle[];
} {
  const active: WorkCycle[] = [];
  const upcoming: WorkCycle[] = [];
  const past: WorkCycle[] = [];

  for (const cycle of cycles) {
    const section = getWorkCycleTimeSection(cycle, today);
    if (section === 'active') active.push(cycle);
    else if (section === 'upcoming') upcoming.push(cycle);
    else past.push(cycle);
  }

  // Active: earliest ending first (most urgent), then startDate
  active.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.startDate.localeCompare(b.startDate));
  // Upcoming: soonest starting first
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  // Past: most recently ended first
  past.sort((a, b) => b.endDate.localeCompare(a.endDate));

  return { active, upcoming, past };
}

export function getRemainingDaysLabel(
  endDate: LocalDateString,
  today: LocalDateString
): string {
  const remaining = diffDays(today, endDate);
  if (remaining < 0) {
    const ago = Math.abs(remaining);
    return `Ended ${ago} ${ago === 1 ? 'day' : 'days'} ago`;
  }
  if (remaining === 0) {
    return 'Ends today';
  }
  if (remaining === 1) {
    return '1 day left';
  }
  return `${remaining} days left`;
}
