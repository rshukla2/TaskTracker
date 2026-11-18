import { ChevronRight } from 'lucide-react';
import { diffDaysInclusive, formatDateRange } from '../core/dates';
import { getRemainingDaysLabel } from '../core/progress';
import type {
  LocalDateString,
  ProgressSummary,
  WorkCycle,
  WorkCycleTimeSection,
} from '../core/types';
import { ProgressBar } from './ProgressBar';

interface WorkCycleCardProps {
  cycle: WorkCycle;
  section: WorkCycleTimeSection;
  progress: ProgressSummary;
  sprintCount: number;
  today: LocalDateString;
  onOpen: () => void;
}

export function WorkCycleCard({
  cycle,
  section,
  progress,
  sprintCount,
  today,
  onOpen,
}: WorkCycleCardProps) {
  const isPast = section === 'past';
  const totalDays = diffDaysInclusive(cycle.startDate, cycle.endDate);

  let surfaceClass = 'bg-white border-slate-200 hover:border-slate-300';
  if (isPast) {
    surfaceClass = progress.isComplete
      ? 'bg-emerald-50/45 border-emerald-200/70 hover:border-emerald-300/80'
      : 'bg-slate-50/90 border-slate-200/80 hover:border-slate-300';
  } else if (progress.isComplete) {
    surfaceClass = 'bg-emerald-50/80 border-emerald-200 hover:border-emerald-300';
  }

  const statusText = progress.isComplete
    ? 'Done'
    : getRemainingDaysLabel(cycle.endDate, today);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:p-5 ${surfaceClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className={`text-base font-semibold leading-6 sm:text-lg ${
              isPast ? 'text-slate-700' : 'text-slate-900'
            }`}
          >
            {cycle.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums sm:text-sm">
            <span>{formatDateRange(cycle.startDate, cycle.endDate)}</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>{totalDays} days</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>
              {sprintCount} {sprintCount === 1 ? 'sprint' : 'sprints'}
            </span>
          </div>
          {cycle.endGoal ? (
            <p className="mt-2 hidden text-sm text-slate-600 line-clamp-1 sm:block">
              {cycle.endGoal}
            </p>
          ) : null}
        </div>
        <ChevronRight
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            isPast ? 'text-slate-400' : 'text-slate-400'
          }`}
        />
      </div>

      <div className="mt-3.5">
        <ProgressBar
          progress={progress}
          statusText={statusText}
          muted={isPast}
        />
      </div>
    </button>
  );
}
