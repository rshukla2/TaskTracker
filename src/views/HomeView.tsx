import { Plus, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NewWorkCycleModal } from '../components/NewWorkCycleModal';
import { WorkCycleCard } from '../components/WorkCycleCard';
import { calculateProgress, sortWorkCycles } from '../core/progress';
import type { LocalDateString, WorkCycle } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';

interface HomeViewProps {
  today: LocalDateString;
  onOpenCycle: (cycleId: string) => void;
  onOpenSettings: () => void;
}

export function HomeView({ today, onOpenCycle, onOpenSettings }: HomeViewProps) {
  const { workCycles, sprints, tasks } = useWorkspace();
  const [newCycleOpen, setNewCycleOpen] = useState(false);

  const grouped = useMemo(() => sortWorkCycles(workCycles, today), [workCycles, today]);

  const sprintCountByCycle = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sprints) {
      counts.set(s.workCycleId, (counts.get(s.workCycleId) ?? 0) + 1);
    }
    return counts;
  }, [sprints]);

  const tasksByCycle = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const list = map.get(t.workCycleId);
      if (list) list.push(t);
      else map.set(t.workCycleId, [t]);
    }
    return map;
  }, [tasks]);

  const renderSection = (
    title: string,
    items: WorkCycle[],
    section: 'active' | 'upcoming' | 'past'
  ) => {
    if (items.length === 0) return null;
    return (
      <section aria-labelledby={`section-${section}`} className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2
            id={`section-${section}`}
            className={`text-sm font-semibold tracking-tight sm:text-base ${
              section === 'past' ? 'text-slate-500' : 'text-slate-900'
            }`}
          >
            {title}
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            {items.length} {items.length === 1 ? 'cycle' : 'cycles'}
          </span>
        </div>

        <div className="space-y-3">
          {items.map((cycle) => {
            const cycleTasks = tasksByCycle.get(cycle.id) ?? [];
            const progress = calculateProgress(cycleTasks);
            return (
              <WorkCycleCard
                key={cycle.id}
                cycle={cycle}
                section={section}
                progress={progress}
                sprintCount={sprintCountByCycle.get(cycle.id) ?? 0}
                today={today}
                onOpen={() => onOpenCycle(cycle.id)}
              />
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 sm:text-lg">
            Task Tracker
          </span>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setNewCycleOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 sm:px-4"
            >
              <Plus className="h-4 w-4" />
              <span>New Work Cycle</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        {workCycles.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center sm:py-16">
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
              Plan your first work cycle
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              Set an end goal, break your schedule into sprints, and track tasks locally in your
              browser.
            </p>
            <button
              type="button"
              onClick={() => setNewCycleOpen(true)}
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              New Work Cycle
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {renderSection('Active Work Cycles', grouped.active, 'active')}
            {renderSection('Upcoming Work Cycles', grouped.upcoming, 'upcoming')}
            {renderSection('Past Work Cycles', grouped.past, 'past')}
          </div>
        )}
      </main>

      <NewWorkCycleModal
        open={newCycleOpen}
        onClose={() => setNewCycleOpen(false)}
        onCreated={(cycleId) => onOpenCycle(cycleId)}
      />
    </div>
  );
}
