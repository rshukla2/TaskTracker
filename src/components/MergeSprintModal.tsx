import React, { useEffect, useState } from 'react';
import { formatDateRange } from '../core/dates';
import type { MergeSprintPreview } from '../core/scheduling';
import { useWorkspace } from '../state/WorkspaceContext';
import { ModalSheet } from './ModalSheet';

interface MergeSprintModalProps {
  open: boolean;
  onClose: () => void;
  cycleId: string;
  preview: MergeSprintPreview | null;
  onMerged?: (keptSprintId: string) => void;
}

export function MergeSprintModal({
  open,
  onClose,
  cycleId,
  preview,
  onMerged,
}: MergeSprintModalProps) {
  const { commitSprintMergeAction } = useWorkspace();
  const [name, setName] = useState('');
  const [endGoal, setEndGoal] = useState('');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && preview) {
      setName(preview.defaultName);
      setEndGoal(preview.defaultEndGoal);
      setError(null);
    }
  }, [open, preview]);

  if (!preview) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a name for the merged sprint.');
      return;
    }

    setMerging(true);
    setError(null);
    try {
      await commitSprintMergeAction(
        cycleId,
        preview.firstSprint.id,
        name.trim(),
        endGoal.trim()
      );
      onClose();
      onMerged?.(preview.firstSprint.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge sprints.');
    } finally {
      setMerging(false);
    }
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title="Merge Sprints"
      subtitle={`Combine ${preview.firstSprint.name} and ${preview.secondSprint.name}`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="merge-sprint-form"
            disabled={merging}
            className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {merging ? 'Merging…' : 'Confirm Merge'}
          </button>
        </div>
      }
    >
      <form id="merge-sprint-form" onSubmit={handleConfirm} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600">Resulting dates</span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {formatDateRange(preview.resultingStartDate, preview.resultingEndDate)} (
              {preview.resultingDurationDays}{' '}
              {preview.resultingDurationDays === 1 ? 'day' : 'days'})
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600">Tasks after merge</span>
            <span className="font-medium text-slate-900 tabular-nums">
              {preview.totalTaskCountAfterMerge}{' '}
              {preview.totalTaskCountAfterMerge === 1 ? 'task' : 'tasks'} (
              {preview.movedTaskCount} moved from {preview.secondSprint.name})
            </span>
          </div>
          <p className="text-xs text-slate-500 pt-1">
            All task deadlines and completion states are preserved.
          </p>
        </div>

        <div>
          <label htmlFor="merge-sprint-name" className="block text-sm font-medium text-slate-800">
            Merged Sprint Name <span className="text-rose-600">*</span>
          </label>
          <input
            id="merge-sprint-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="merge-sprint-goal" className="block text-sm font-medium text-slate-800">
            Merged Sprint End Goal
          </label>
          <textarea
            id="merge-sprint-goal"
            rows={3}
            placeholder="End goal for the combined sprint"
            value={endGoal}
            onChange={(e) => setEndGoal(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>
      </form>
    </ModalSheet>
  );
}
