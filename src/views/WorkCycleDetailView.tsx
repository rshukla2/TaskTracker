import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EditSprintModal } from '../components/EditSprintModal';
import { MergeSprintModal } from '../components/MergeSprintModal';
import { ProgressBar } from '../components/ProgressBar';
import { SprintCard } from '../components/SprintCard';
import { diffDaysInclusive, formatDateRange } from '../core/dates';
import {
  calculateProgress,
  getRemainingDaysLabel,
  getWorkCycleTimeSection,
} from '../core/progress';
import { previewMergeWithNext, type MergeSprintPreview } from '../core/scheduling';
import type { LocalDateString, Sprint } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';

interface WorkCycleDetailViewProps {
  cycleId: string;
  today: LocalDateString;
  onBack: () => void;
  onOpenCycleSettings: () => void;
  onOpenSprint: (sprintId: string) => void;
}

export function WorkCycleDetailView({
  cycleId,
  today,
  onBack,
  onOpenCycleSettings,
  onOpenSprint,
}: WorkCycleDetailViewProps) {
  const { workCycles, sprints, tasks } = useWorkspace();

  const cycle = workCycles.find((c) => c.id === cycleId);

  const cycleSprints = useMemo(
    () =>
      sprints
        .filter((s) => s.workCycleId === cycleId)
        .sort((a, b) => a.order - b.order),
    [sprints, cycleId]
  );

  const cycleTasks = useMemo(
    () => tasks.filter((t) => t.workCycleId === cycleId),
    [tasks, cycleId]
  );

  const tasksBySprint = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    for (const t of cycleTasks) {
      const list = map.get(t.sprintId);
      if (list) list.push(t);
      else map.set(t.sprintId, [t]);
    }
    return map;
  }, [cycleTasks]);

  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [mergePreview, setMergePreview] = useState<MergeSprintPreview | null>(null);

  if (!cycle) {
    return (
      <div className="min-h-dvh bg-white text-slate-900">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-4xl items-center px-4 sm:px-6">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Home
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6">
          <p className="text-base font-medium text-slate-900">Work cycle not found</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Home
          </button>
        </main>
      </div>
    );
  }

  const cycleProgress = calculateProgress(cycleTasks);
  const timeSection = getWorkCycleTimeSection(cycle, today);
  const totalDays = diffDaysInclusive(cycle.startDate, cycle.endDate);
  const statusText = cycleProgress.isComplete
    ? 'Done'
    : getRemainingDaysLabel(cycle.endDate, today);

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Home</span>
          </button>

          <span className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">
            {cycle.name}
          </span>

          <button
            type="button"
            onClick={onOpenCycleSettings}
            className="-mr-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Cycle Settings</span>
            <span className="sm:hidden">Settings</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-6">
        <section
          className={`rounded-2xl border p-4 sm:p-6 ${
            cycleProgress.isComplete
              ? timeSection === 'past'
                ? 'bg-emerald-50/45 border-emerald-200/70'
                : 'bg-emerald-50/80 border-emerald-200'
              : timeSection === 'past'
              ? 'bg-slate-50/90 border-slate-200/80'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {cycle.name}
            </h1>
            <span className="text-xs font-medium text-slate-600 tabular-nums sm:text-sm">
              {formatDateRange(cycle.startDate, cycle.endDate)} · {totalDays} days
            </span>
          </div>

          {cycle.endGoal ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                End Goal
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-900 whitespace-pre-line">
                {cycle.endGoal}
              </p>
            </div>
          ) : null}

          {cycle.description ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-700 whitespace-pre-line">
                {cycle.description}
              </p>
            </div>
          ) : null}

          <div className="mt-4 pt-3 border-t border-slate-200/80">
            <ProgressBar
              progress={cycleProgress}
              statusText={statusText}
              muted={timeSection === 'past'}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Sprints</h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {cycleSprints.length} {cycleSprints.length === 1 ? 'sprint' : 'sprints'}
            </span>
          </div>

          <div className="space-y-3">
            {cycleSprints.map((sprint, idx) => {
              const sprintTasks = tasksBySprint.get(sprint.id) ?? [];
              const sprintProgress = calculateProgress(sprintTasks);
              const prevSprint = idx > 0 ? cycleSprints[idx - 1] : null;
              return (
                <SprintCard
                  key={sprint.id}
                  sprint={sprint}
                  progress={sprintProgress}
                  today={today}
                  hasNextSprint={idx < cycleSprints.length - 1}
                  hasPrevSprint={idx > 0}
                  onOpen={() => onOpenSprint(sprint.id)}
                  onEdit={() => setEditingSprint(sprint)}
                  onMergeWithNext={() => {
                    const preview = previewMergeWithNext(
                      cycleSprints,
                      cycleTasks,
                      sprint.id
                    );
                    if (preview) setMergePreview(preview);
                  }}
                  onMergeWithPrev={() => {
                    if (!prevSprint) return;
                    const preview = previewMergeWithNext(
                      cycleSprints,
                      cycleTasks,
                      prevSprint.id
                    );
                    if (preview) setMergePreview(preview);
                  }}
                />
              );
            })}
          </div>
        </section>
      </main>

      <EditSprintModal
        open={Boolean(editingSprint)}
        onClose={() => setEditingSprint(null)}
        cycle={cycle}
        sprint={editingSprint}
        cycleSprints={cycleSprints}
        cycleTasks={cycleTasks}
      />

      <MergeSprintModal
        open={Boolean(mergePreview)}
        onClose={() => setMergePreview(null)}
        cycleId={cycle.id}
        preview={mergePreview}
      />
    </div>
  );
}
