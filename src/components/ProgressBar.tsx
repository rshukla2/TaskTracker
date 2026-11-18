import type { ProgressSummary } from '../core/types';

interface ProgressBarProps {
  progress: ProgressSummary;
  statusText?: string | null;
  muted?: boolean;
  compact?: boolean;
}

export function ProgressBar({
  progress,
  statusText,
  muted = false,
  compact = false,
}: ProgressBarProps) {
  const trackBg = muted ? 'bg-slate-200/80' : 'bg-slate-200/85';
  const fillBg = muted ? 'bg-emerald-600/70' : 'bg-emerald-600';

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 text-xs leading-5">
        <div className="flex items-center gap-2 text-slate-600 tabular-nums">
          <span className="font-semibold text-slate-900">{progress.percentage}%</span>
          <span aria-hidden="true" className="text-slate-400">
            ·
          </span>
          <span>
            {progress.completed}/{progress.total}{' '}
            {progress.total === 1 ? 'task' : 'tasks'}
          </span>
        </div>
        {statusText ? (
          <span
            className={`font-semibold whitespace-nowrap ${
              statusText === 'Done'
                ? 'text-emerald-700'
                : statusText === 'Overdue'
                ? 'text-amber-800'
                : 'text-slate-600'
            }`}
          >
            {statusText}
          </span>
        ) : null}
      </div>
      <div
        className={`mt-1.5 w-full overflow-hidden rounded-full ${trackBg} ${
          compact ? 'h-1.5' : 'h-2'
        }`}
        role="progressbar"
        aria-valuenow={progress.percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${fillBg}`}
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
    </div>
  );
}
