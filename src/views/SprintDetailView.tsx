import { ArrowLeft, MoreVertical, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AddTaskModal } from '../components/AddTaskModal';
import { EditSprintModal } from '../components/EditSprintModal';
import { MergeSprintModal } from '../components/MergeSprintModal';
import { ProgressBar } from '../components/ProgressBar';
import { TaskCard } from '../components/TaskCard';
import { diffDaysInclusive, formatDateRange } from '../core/dates';
import {
  calculateProgress,
  isSprintOverdue,
  sortSprintTasks,
  sortSprintTasksByStatus,
} from '../core/progress';
import { previewMergeWithNext, type MergeSprintPreview } from '../core/scheduling';
import { getEffectiveStatuses } from '../core/statuses';
import type { LocalDateString } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';

interface SprintDetailViewProps {
  cycleId: string;
  sprintId: string;
  today: LocalDateString;
  onBackToCycle: () => void;
  onOpenTask: (taskId: string) => void;
  onSprintReplaced?: (newSprintId: string) => void;
}

export function SprintDetailView({
  cycleId,
  sprintId,
  today,
  onBackToCycle,
  onOpenTask,
  onSprintReplaced,
}: SprintDetailViewProps) {
  const { settings, workCycles, sprints, tasks, toggleTaskCompletion } = useWorkspace();

  const cycle = workCycles.find((c) => c.id === cycleId);
  const cycleSprints = useMemo(
    () =>
      sprints
        .filter((s) => s.workCycleId === cycleId)
        .sort((a, b) => a.order - b.order),
    [sprints, cycleId]
  );
  const sprintIdx = cycleSprints.findIndex((s) => s.id === sprintId);
  const sprint = sprintIdx >= 0 ? cycleSprints[sprintIdx] : undefined;

  const cycleTasks = useMemo(
    () => tasks.filter((t) => t.workCycleId === cycleId),
    [tasks, cycleId]
  );

  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [mergePreview, setMergePreview] = useState<MergeSprintPreview | null>(null);
  const [sortBy, setSortBy] = useState<'deadline' | 'status'>('deadline');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const statuses = useMemo(
    () => (cycle ? getEffectiveStatuses(cycle, settings) : []),
    [cycle, settings]
  );

  const sprintTasks = useMemo(() => {
    const raw = cycleTasks.filter((t) => t.sprintId === sprintId);
    if (sortBy === 'status' && cycle) {
      return sortSprintTasksByStatus(raw, statuses, cycle.useCustomStatuses, today);
    }
    return sortSprintTasks(raw, today);
  }, [cycleTasks, sprintId, sortBy, cycle, statuses, today]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  if (!cycle || !sprint) {
    return (
      <div className="min-h-dvh bg-white text-slate-900">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-4xl items-center px-4 sm:px-6">
            <button
              type="button"
              onClick={onBackToCycle}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6">
          <p className="text-base font-medium text-slate-900">Sprint not found</p>
          <button
            type="button"
            onClick={onBackToCycle}
            className="mt-4 min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Work Cycle
          </button>
        </main>
      </div>
    );
  }

  const progress = calculateProgress(sprintTasks);
  const overdue = isSprintOverdue(sprint, progress, today);
  const durationDays = diffDaysInclusive(sprint.startDate, sprint.endDate);
  const hasNextSprint = sprintIdx < cycleSprints.length - 1;
  const hasPrevSprint = sprintIdx > 0;

  const surfaceClass = progress.isComplete
    ? 'bg-emerald-50/80 border-emerald-200'
    : overdue
    ? 'bg-amber-50/90 border-amber-200'
    : 'bg-white border-slate-200';

  const statusText = progress.isComplete ? 'Done' : overdue ? 'Overdue' : null;

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={onBackToCycle}
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 max-w-[140px] sm:max-w-[220px]"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="truncate">{cycle.name}</span>
          </button>

          <span className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">
            {sprint.name}
          </span>

          <button
            type="button"
            onClick={() => setAddTaskOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add Task</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-6">
        <section className={`rounded-2xl border p-4 sm:p-6 ${surfaceClass}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {sprint.name}
              </h1>
              <p className="mt-1 text-xs font-medium text-slate-600 tabular-nums sm:text-sm">
                {formatDateRange(sprint.startDate, sprint.endDate)} · {durationDays}{' '}
                {durationDays === 1 ? 'day' : 'days'}
              </p>
            </div>

            <div className="relative -mr-2 -mt-1 shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label="Sprint actions"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-900/5 hover:text-slate-900"
              >
                <MoreVertical className="h-5 w-5" />
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditOpen(true);
                    }}
                    className="flex min-h-[44px] w-full items-center px-4 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Edit Sprint
                  </button>
                  {hasNextSprint ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        const preview = previewMergeWithNext(
                          cycleSprints,
                          cycleTasks,
                          sprint.id
                        );
                        if (preview) setMergePreview(preview);
                      }}
                      className="flex min-h-[44px] w-full items-center px-4 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Merge with Next Sprint
                    </button>
                  ) : null}
                  {!hasNextSprint && hasPrevSprint ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        const prev = cycleSprints[sprintIdx - 1];
                        const preview = previewMergeWithNext(
                          cycleSprints,
                          cycleTasks,
                          prev.id
                        );
                        if (preview) setMergePreview(preview);
                      }}
                      className="flex min-h-[44px] w-full items-center px-4 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Merge into Previous Sprint
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              End Goal
            </p>
            {sprint.endGoal ? (
              <p className="mt-1 text-sm leading-6 text-slate-900 whitespace-pre-line">
                {sprint.endGoal}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="mt-1 text-sm text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-800"
              >
                Add an end goal for this sprint
              </button>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200/80">
            <ProgressBar progress={progress} statusText={statusText} />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900">Tasks</h2>
              <div
                role="group"
                aria-label="Sort tasks by"
                className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200"
              >
                <button
                  type="button"
                  onClick={() => setSortBy('deadline')}
                  aria-pressed={sortBy === 'deadline'}
                  className={`min-h-[36px] rounded-md px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    sortBy === 'deadline'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Deadline
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy('status')}
                  aria-pressed={sortBy === 'status'}
                  className={`min-h-[36px] rounded-md px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    sortBy === 'status'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Status
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddTaskOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              Add Task
            </button>
          </div>

          {sprintTasks.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm font-medium text-slate-900">No tasks in this sprint yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Add tasks with optional deadlines, effort, and workflow status.
              </p>
              <button
                type="button"
                onClick={() => setAddTaskOpen(true)}
                className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Add First Task
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sprintTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  statuses={statuses}
                  today={today}
                  onOpen={() => onOpenTask(task.id)}
                  onToggleComplete={() => toggleTaskCompletion(task.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <AddTaskModal
        open={addTaskOpen}
        onClose={() => setAddTaskOpen(false)}
        workCycleId={cycle.id}
        sprint={sprint}
        statuses={statuses}
      />

      <EditSprintModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        cycle={cycle}
        sprint={sprint}
        cycleSprints={cycleSprints}
        cycleTasks={cycleTasks}
      />

      <MergeSprintModal
        open={Boolean(mergePreview)}
        onClose={() => setMergePreview(null)}
        cycleId={cycle.id}
        preview={mergePreview}
        onMerged={(keptSprintId) => {
          if (keptSprintId !== sprint.id) {
            onSprintReplaced?.(keptSprintId);
          }
        }}
      />
    </div>
  );
}
