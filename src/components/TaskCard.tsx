import { Check } from 'lucide-react';
import { formatDisplayDate } from '../core/dates';
import { isTaskDueToday, isTaskOverdue } from '../core/progress';
import { getStatusName, isBlockedStatus } from '../core/statuses';
import type { LocalDateString, Task, WorkflowStatus } from '../core/types';

interface TaskCardProps {
  task: Task;
  statuses: WorkflowStatus[];
  today: LocalDateString;
  onOpen: () => void;
  onToggleComplete: () => void;
}

export function TaskCard({
  task,
  statuses,
  today,
  onOpen,
  onToggleComplete,
}: TaskCardProps) {
  const overdue = isTaskOverdue(task, today);
  const dueToday = isTaskDueToday(task, today);
  const statusName = getStatusName(task.statusId, statuses);
  const isBlocked = !task.completed && isBlockedStatus(task.statusId, statuses);

  const surfaceClasses = task.completed
    ? 'bg-emerald-50/80 border-emerald-200 hover:border-emerald-300'
    : isBlocked
    ? 'bg-rose-50/70 border-rose-200 hover:border-rose-300'
    : overdue
    ? 'bg-amber-50/90 border-amber-200 hover:border-amber-300'
    : 'bg-white border-slate-200 hover:border-slate-300';

  const metaParts: string[] = [];
  if (task.deadline) {
    metaParts.push(
      dueToday
        ? `Due today (${formatDisplayDate(task.deadline)})`
        : `Due ${formatDisplayDate(task.deadline)}`
    );
  }
  if (task.completed) {
    metaParts.push('Done');
  } else {
    if (overdue) {
      metaParts.push('Overdue');
    }
    if (statusName) {
      metaParts.push(statusName);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:px-4 sm:py-3 ${surfaceClasses}`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium leading-5 sm:text-[15px] ${
            task.completed ? 'text-slate-600 line-through' : 'text-slate-900'
          }`}
        >
          {task.title}
        </p>

        {metaParts.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
            {metaParts.map((part, i) => (
              <span key={`${part}-${i}`} className="inline-flex items-center gap-2">
                {i > 0 ? (
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                ) : null}
                <span
                  className={
                    part === 'Overdue'
                      ? 'font-semibold text-amber-800'
                      : part === 'Done'
                      ? 'font-semibold text-emerald-700'
                      : isBlocked && part === statusName
                      ? 'font-semibold text-rose-800'
                      : undefined
                  }
                >
                  {part}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {isBlocked && task.blockerReason?.trim() ? (
          <p className="mt-1 text-xs text-rose-800/85 line-clamp-1">
            {task.blockerReason.trim()}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleComplete();
        }}
        aria-label={task.completed ? `Reopen "${task.title}"` : `Mark "${task.title}" as done`}
        aria-pressed={task.completed}
        className="-mr-1.5 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors ${
            task.completed
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-blue-600 bg-white text-transparent hover:bg-blue-50'
          }`}
        >
          <Check className="h-4 w-4 stroke-[2.5]" />
        </span>
      </button>
    </div>
  );
}
