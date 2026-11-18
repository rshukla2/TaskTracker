import { useEffect, useRef, useState } from 'react';
import { ChevronRight, MoreVertical } from 'lucide-react';
import { diffDaysInclusive, formatDateRange } from '../core/dates';
import { isSprintOverdue } from '../core/progress';
import type { LocalDateString, ProgressSummary, Sprint } from '../core/types';
import { ProgressBar } from './ProgressBar';

interface SprintCardProps {
  sprint: Sprint;
  progress: ProgressSummary;
  today: LocalDateString;
  hasNextSprint: boolean;
  hasPrevSprint: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onMergeWithNext: () => void;
  onMergeWithPrev: () => void;
}

export function SprintCard({
  sprint,
  progress,
  today,
  hasNextSprint,
  hasPrevSprint,
  onOpen,
  onEdit,
  onMergeWithNext,
  onMergeWithPrev,
}: SprintCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  const overdue = isSprintOverdue(sprint, progress, today);
  const durationDays = diffDaysInclusive(sprint.startDate, sprint.endDate);
  const isCurrent = today >= sprint.startDate && today <= sprint.endDate;

  const surfaceClass = progress.isComplete
    ? 'bg-emerald-50/80 border-emerald-200 hover:border-emerald-300'
    : overdue
    ? 'bg-amber-50/90 border-amber-200 hover:border-amber-300'
    : 'bg-white border-slate-200 hover:border-slate-300';

  const statusText = progress.isComplete
    ? 'Done'
    : overdue
    ? 'Overdue'
    : isCurrent
    ? 'Current'
    : null;

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
      className={`relative w-full cursor-pointer rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:p-5 ${surfaceClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 leading-6">
              {sprint.name}
            </h3>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums sm:text-sm">
            <span>{formatDateRange(sprint.startDate, sprint.endDate)}</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>
              {durationDays} {durationDays === 1 ? 'day' : 'days'}
            </span>
          </div>
          {sprint.endGoal ? (
            <p className="mt-1.5 text-sm text-slate-700 line-clamp-2">{sprint.endGoal}</p>
          ) : null}
        </div>

        <div className="flex items-center -mr-2 -mt-1 shrink-0" ref={menuRef}>
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
              aria-label={`Actions for ${sprint.name}`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <MoreVertical className="h-5 w-5" />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
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
                      onMergeWithNext();
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
                      onMergeWithPrev();
                    }}
                    className="flex min-h-[44px] w-full items-center px-4 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Merge into Previous Sprint
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <ChevronRight className="h-5 w-5 text-slate-400 mr-1 hidden sm:block" />
        </div>
      </div>

      <div className="mt-3.5">
        <ProgressBar progress={progress} statusText={statusText} />
      </div>
    </div>
  );
}
