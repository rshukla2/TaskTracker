import React, { useEffect, useMemo, useState } from 'react';
import { formatDateRange, formatDisplayDate } from '../core/dates';
import { previewSprintEdit } from '../core/scheduling';
import type { Sprint, Task, WorkCycle } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';
import { ModalSheet } from './ModalSheet';

interface EditSprintModalProps {
  open: boolean;
  onClose: () => void;
  cycle: WorkCycle;
  sprint: Sprint | null;
  cycleSprints: Sprint[];
  cycleTasks: Task[];
}

export function EditSprintModal({
  open,
  onClose,
  cycle,
  sprint,
  cycleSprints,
  cycleTasks,
}: EditSprintModalProps) {
  const { commitSprintEditAction } = useWorkspace();

  const [name, setName] = useState('');
  const [endGoal, setEndGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open && sprint) {
      setName(sprint.name);
      setEndGoal(sprint.endGoal);
      setStartDate(sprint.startDate);
      setEndDate(sprint.endDate);
      setSubmitError(null);
    }
  }, [open, sprint]);

  const preview = useMemo(() => {
    if (!sprint) return null;
    return previewSprintEdit(cycle, cycleSprints, cycleTasks, sprint.id, {
      name,
      endGoal,
      startDate,
      endDate,
    });
  }, [cycle, cycleSprints, cycleTasks, sprint, name, endGoal, startDate, endDate]);

  if (!sprint) return null;

  const hasDateShift = Boolean(
    preview?.valid &&
      (preview.affectedSprints.some((s) => s.datesChanged) ||
        preview.proposedCycleEndDate ||
        preview.proposedCycleStartDate)
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview || !preview.valid) return;

    setSaving(true);
    setSubmitError(null);
    try {
      await commitSprintEditAction(
        preview.updatedSprints,
        preview.proposedCycleStartDate,
        preview.proposedCycleEndDate,
        cycle.id
      );
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save sprint changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={`Edit ${sprint.name}`}
      subtitle={`${cycle.name} · ${formatDateRange(cycle.startDate, cycle.endDate)}`}
      maxWidthClass="sm:max-w-xl"
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
            form="edit-sprint-form"
            disabled={saving || !preview?.valid}
            className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : hasDateShift ? 'Confirm & Save Schedule' : 'Save Sprint'}
          </button>
        </div>
      }
    >
      <form id="edit-sprint-form" onSubmit={handleSave} className="space-y-4">
        {submitError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
            {submitError}
          </div>
        ) : null}

        <div>
          <label htmlFor="edit-sprint-name" className="block text-sm font-medium text-slate-800">
            Sprint Name <span className="text-rose-600">*</span>
          </label>
          <input
            id="edit-sprint-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="edit-sprint-goal" className="block text-sm font-medium text-slate-800">
            End Goal
          </label>
          <textarea
            id="edit-sprint-goal"
            rows={2}
            placeholder="What should be completed by the end of this sprint?"
            value={endGoal}
            onChange={(e) => setEndGoal(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-sprint-start" className="block text-sm font-medium text-slate-800">
              Start Date
            </label>
            <input
              id="edit-sprint-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-sprint-end" className="block text-sm font-medium text-slate-800">
              End Date
            </label>
            <input
              id="edit-sprint-end"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        {preview && !preview.valid && preview.error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900">
            <p className="font-medium">Schedule conflict</p>
            <p className="mt-1 text-rose-800">{preview.error.message}</p>
            {preview.error.minAllowedStartDate ? (
              <button
                type="button"
                onClick={() => setStartDate(preview.error!.minAllowedStartDate!)}
                className="mt-2.5 min-h-[36px] rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-100"
              >
                Use {formatDisplayDate(preview.error.minAllowedStartDate, { includeYear: true })}
              </button>
            ) : null}
          </div>
        ) : null}

        {preview && preview.valid && hasDateShift ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Schedule Preview
              </h3>
              {preview.deltaDays !== 0 ? (
                <span className="text-xs font-medium text-slate-600 tabular-nums">
                  Later sprints shift {preview.deltaDays > 0 ? `+${preview.deltaDays}` : preview.deltaDays}{' '}
                  {Math.abs(preview.deltaDays) === 1 ? 'day' : 'days'}
                </span>
              ) : null}
            </div>

            {preview.proposedCycleEndDate ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <span className="font-semibold">Work cycle end date will extend:</span>{' '}
                <span className="tabular-nums">
                  {formatDisplayDate(cycle.endDate, { includeYear: true })} →{' '}
                  {formatDisplayDate(preview.proposedCycleEndDate, { includeYear: true })}
                </span>
              </div>
            ) : null}

            {preview.proposedCycleStartDate ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <span className="font-semibold">Work cycle start date will move earlier:</span>{' '}
                <span className="tabular-nums">
                  {formatDisplayDate(cycle.startDate, { includeYear: true })} →{' '}
                  {formatDisplayDate(preview.proposedCycleStartDate, { includeYear: true })}
                </span>
              </div>
            ) : null}

            <div className="divide-y divide-slate-200/80 rounded-lg border border-slate-200 bg-white">
              {preview.affectedSprints.map((item) => (
                <div
                  key={item.sprintId}
                  className="flex flex-col gap-0.5 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium text-slate-900">{item.name}</span>
                  <span className="text-slate-600 tabular-nums">
                    {item.datesChanged ? (
                      <>
                        <span className="line-through text-slate-400">
                          {formatDateRange(item.oldStartDate, item.oldEndDate)}
                        </span>{' '}
                        <span aria-hidden="true">→</span>{' '}
                        <span className="font-semibold text-slate-900">
                          {formatDateRange(item.newStartDate, item.newEndDate)}
                        </span>
                      </>
                    ) : (
                      <span>{formatDateRange(item.newStartDate, item.newEndDate)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {preview.outsideDeadlineTaskCount > 0 ? (
              <p className="text-xs text-slate-600">
                {preview.outsideDeadlineTaskCount}{' '}
                {preview.outsideDeadlineTaskCount === 1 ? 'task has' : 'tasks have'} a deadline
                outside the updated sprint dates. Existing deadlines will be preserved with an
                indicator in task details.
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </ModalSheet>
  );
}
