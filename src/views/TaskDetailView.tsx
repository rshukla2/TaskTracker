import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, RotateCcw, Trash2 } from 'lucide-react';
import { ModalSheet } from '../components/ModalSheet';
import { formatDateRange, formatDisplayDate } from '../core/dates';
import { isTaskDeadlineOutsideSprint, isTaskOverdue } from '../core/progress';
import { getEffectiveStatuses, getStatusName, isBlockedStatus } from '../core/statuses';
import { EffortLevel, type LocalDateString } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';

interface TaskDetailViewProps {
  cycleId: string;
  sprintId: string;
  taskId: string;
  today: LocalDateString;
  onBackToSprint: () => void;
}

export function TaskDetailView({
  cycleId,
  sprintId,
  taskId,
  today,
  onBackToSprint,
}: TaskDetailViewProps) {
  const {
    settings,
    workCycles,
    sprints,
    tasks,
    updateTask,
    toggleTaskCompletion,
    deleteTaskAction,
  } = useWorkspace();

  const cycle = workCycles.find((c) => c.id === cycleId);
  const sprint = sprints.find((s) => s.id === sprintId);
  const task = tasks.find((t) => t.id === taskId);

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [deadline, setDeadline] = useState(task?.deadline ?? '');
  const [estimatedHours, setEstimatedHours] = useState(
    task?.estimatedHours !== null && task?.estimatedHours !== undefined
      ? String(task.estimatedHours)
      : ''
  );
  const [effort, setEffort] = useState<string>(task?.effort ?? '');
  const [statusId, setStatusId] = useState<string>(task?.statusId ?? '');
  const [blockerReason, setBlockerReason] = useState<string>(task?.blockerReason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setDeadline(task.deadline ?? '');
      setEstimatedHours(
        task.estimatedHours !== null && task.estimatedHours !== undefined
          ? String(task.estimatedHours)
          : ''
      );
      setEffort(task.effort ?? '');
      setStatusId(task.statusId ?? '');
      setBlockerReason(task.blockerReason ?? '');
    }
  }, [task?.id]);

  // Keep statusId synced when completion toggle updates status automatically
  useEffect(() => {
    if (task) {
      setStatusId(task.statusId ?? '');
    }
  }, [task?.statusId, task?.completed]);

  if (!cycle || !sprint || !task) {
    return (
      <div className="min-h-dvh bg-white text-slate-900">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
            <button
              type="button"
              onClick={onBackToSprint}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
          <p className="text-base font-medium text-slate-900">Task not found</p>
          <button
            type="button"
            onClick={onBackToSprint}
            className="mt-4 min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Sprint
          </button>
        </main>
      </div>
    );
  }

  const statuses = getEffectiveStatuses(cycle, settings);
  const overdue = isTaskOverdue({ completed: task.completed, deadline: deadline || null }, today);
  const outsideSprint = isTaskDeadlineOutsideSprint(
    { deadline: deadline || null },
    sprint
  );
  const activeStatusName = getStatusName(statusId || null, statuses);
  const isBlocked = isBlockedStatus(statusId || null, statuses);

  const persistFields = async (overrides?: {
    title?: string;
    description?: string;
    deadline?: string;
    estimatedHours?: string;
    effort?: string;
    statusId?: string;
    blockerReason?: string;
  }) => {
    setError(null);
    const nextTitle = (overrides?.title ?? title).trim();
    if (!nextTitle) {
      setError('Task title cannot be empty.');
      return null;
    }

    const rawHours = (overrides?.estimatedHours ?? estimatedHours).trim();
    let parsedHours: number | null = null;
    if (rawHours !== '') {
      const n = Number(rawHours);
      if (!Number.isFinite(n) || n < 0) {
        setError('Estimated hours must be a non-negative number (e.g., 0.5 or 1.5).');
        return null;
      }
      parsedHours = n;
    }

    const nextDeadline = overrides?.deadline !== undefined ? overrides.deadline : deadline;
    const nextEffort = overrides?.effort !== undefined ? overrides.effort : effort;
    const nextStatusId = overrides?.statusId !== undefined ? overrides.statusId : statusId;
    const nextDescription =
      overrides?.description !== undefined ? overrides.description : description;
    const nextBlockerReason =
      overrides?.blockerReason !== undefined ? overrides.blockerReason : blockerReason;

    const nextTask = {
      ...task,
      title: nextTitle,
      description: nextDescription.trim(),
      deadline: nextDeadline || null,
      estimatedHours: parsedHours,
      effort: nextEffort ? (nextEffort as EffortLevel) : null,
      statusId: nextStatusId || null,
      blockerReason: nextBlockerReason.trim(),
    };
    await updateTask(nextTask);
    return nextTask;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await persistFields();
    if (saved) {
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    }
  };

  const handleToggleCompletion = async () => {
    const saved = await persistFields();
    if (saved) {
      await toggleTaskCompletion(task.id, saved);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTaskAction(task.id);
      setDeleteConfirmOpen(false);
      onBackToSprint();
    } finally {
      setDeleting(false);
    }
  };

  const bannerClass = task.completed
    ? 'bg-emerald-50/80 border-emerald-200'
    : isBlocked
    ? 'bg-rose-50/70 border-rose-200'
    : overdue
    ? 'bg-amber-50/90 border-amber-200'
    : 'bg-white border-slate-200';

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={async () => {
              if (title.trim()) {
                await persistFields();
              }
              onBackToSprint();
            }}
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 max-w-[160px] sm:max-w-[240px]"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="truncate">{sprint.name}</span>
          </button>

          <span className="text-sm font-semibold text-slate-900 truncate">Task Detail</span>

          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label="Delete task"
            className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-6">
        <section className={`rounded-2xl border p-4 sm:p-5 space-y-4 ${bannerClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 tabular-nums">
            <span>
              {cycle.name} · {sprint.name} ({formatDateRange(sprint.startDate, sprint.endDate)})
            </span>
            <span
              className={`font-semibold ${
                task.completed
                  ? 'text-emerald-700'
                  : isBlocked
                  ? 'text-rose-800'
                  : overdue
                  ? 'text-amber-800'
                  : 'text-slate-700'
              }`}
            >
              {task.completed
                ? 'Done'
                : overdue
                ? 'Overdue'
                : activeStatusName ?? 'Open'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleToggleCompletion}
            className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
              task.completed
                ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {task.completed ? (
              <>
                <RotateCcw className="h-4 w-4" />
                <span>Reopen Task</span>
              </>
            ) : (
              <>
                <Check className="h-5 w-5" />
                <span>Mark as Done</span>
              </>
            )}
          </button>
        </section>

        <form
          onSubmit={handleFormSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-5"
        >
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor="detail-title" className="block text-sm font-medium text-slate-800">
              Title <span className="text-rose-600">*</span>
            </label>
            <input
              id="detail-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim()) persistFields();
              }}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="detail-desc" className="block text-sm font-medium text-slate-800">
              Description
            </label>
            <textarea
              id="detail-desc"
              rows={4}
              placeholder="Add notes, steps, or links"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (title.trim()) persistFields();
              }}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="detail-deadline" className="block text-sm font-medium text-slate-800">
                Deadline
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="detail-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDeadline(next);
                    if (title.trim()) persistFields({ deadline: next });
                  }}
                  className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
                {deadline ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDeadline('');
                      if (title.trim()) persistFields({ deadline: '' });
                    }}
                    className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {outsideSprint ? (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div className="space-y-1">
                    <p>
                      Deadline ({formatDisplayDate(deadline, { includeYear: true })}) falls
                      outside {sprint.name} dates (
                      {formatDateRange(sprint.startDate, sprint.endDate)}).
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setDeadline(sprint.endDate);
                        if (title.trim()) persistFields({ deadline: sprint.endDate });
                      }}
                      className="font-semibold underline underline-offset-2 hover:text-amber-950"
                    >
                      Set to sprint end ({formatDisplayDate(sprint.endDate)})
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="detail-hours" className="block text-sm font-medium text-slate-800">
                Estimated Hours
              </label>
              <input
                id="detail-hours"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="e.g., 0.5 or 1.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                onBlur={() => {
                  if (title.trim()) persistFields();
                }}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="detail-effort" className="block text-sm font-medium text-slate-800">
                Effort
              </label>
              <select
                id="detail-effort"
                value={effort}
                onChange={(e) => {
                  const next = e.target.value;
                  setEffort(next);
                  if (title.trim()) persistFields({ effort: next });
                }}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">None</option>
                <option value={EffortLevel.Low}>Low</option>
                <option value={EffortLevel.Medium}>Medium</option>
                <option value={EffortLevel.High}>High</option>
              </select>
            </div>

            <div>
              <label htmlFor="detail-status" className="block text-sm font-medium text-slate-800">
                Workflow Status
              </label>
              <select
                id="detail-status"
                value={statusId}
                onChange={(e) => {
                  const next = e.target.value;
                  setStatusId(next);
                  if (title.trim()) persistFields({ statusId: next });
                }}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">None</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {task.completed ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  Card displays Done while completed. Editing workflow status preserves
                  completion state.
                </p>
              ) : null}
            </div>
          </div>

          {isBlocked ? (
            <div>
              <label htmlFor="detail-blocker" className="block text-sm font-medium text-slate-800">
                Blocker &amp; Unblock Plan
              </label>
              <textarea
                id="detail-blocker"
                rows={3}
                placeholder="Optional: explain why this task is blocked or what is needed to unblock it"
                value={blockerReason}
                onChange={(e) => setBlockerReason(e.target.value)}
                onBlur={() => {
                  if (title.trim()) persistFields();
                }}
                className="mt-1.5 w-full rounded-lg border border-rose-200 bg-rose-50/40 px-3 py-2 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>
          ) : null}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Save Changes
            </button>
            {savedNotice ? (
              <span className="text-sm font-medium text-emerald-700">Saved</span>
            ) : null}
          </div>
        </form>
      </main>

      <ModalSheet
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Task?"
        subtitle={task.title}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(false)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="min-h-[44px] rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Task'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          Are you sure you want to permanently delete this task?
        </p>
      </ModalSheet>
    </div>
  );
}
