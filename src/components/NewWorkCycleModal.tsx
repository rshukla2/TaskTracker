import React, { useMemo, useState } from 'react';
import { diffDaysInclusive, formatDisplayDate, isValidLocalDate, todayLocal } from '../core/dates';
import {
  calculateCycleEndDate,
  type DurationUnit,
  generateSprintsForCycle,
} from '../core/scheduling';
import { useWorkspace } from '../state/WorkspaceContext';
import { ModalSheet } from './ModalSheet';

interface NewWorkCycleModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (cycleId: string) => void;
}

export function NewWorkCycleModal({ open, onClose, onCreated }: NewWorkCycleModalProps) {
  const { createCycle } = useWorkspace();
  const initialToday = todayLocal();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endGoal, setEndGoal] = useState('');
  const [startDate, setStartDate] = useState(initialToday);
  const [scheduleMode, setScheduleMode] = useState<'duration' | 'endDate'>('duration');
  const [durationValue, setDurationValue] = useState('6');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('weeks');
  const [manualEndDate, setManualEndDate] = useState(() =>
    calculateCycleEndDate(initialToday, 6, 'weeks')
  );
  const [sprintLengthDays, setSprintLengthDays] = useState('7');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedEndDate = useMemo(() => {
    if (!isValidLocalDate(startDate)) return '';
    if (scheduleMode === 'endDate') {
      return manualEndDate;
    }
    const parsed = Number(durationValue);
    if (!Number.isFinite(parsed) || parsed < 1) return '';
    return calculateCycleEndDate(startDate, parsed, durationUnit);
  }, [startDate, scheduleMode, durationValue, durationUnit, manualEndDate]);

  const previewSummary = useMemo(() => {
    if (!isValidLocalDate(startDate) || !isValidLocalDate(computedEndDate)) {
      return null;
    }
    if (computedEndDate < startDate) {
      return null;
    }
    const sprintLen = Math.floor(Number(sprintLengthDays));
    if (!Number.isFinite(sprintLen) || sprintLen < 1) {
      return null;
    }

    const totalDays = diffDaysInclusive(startDate, computedEndDate);
    const previewSprints = generateSprintsForCycle(
      'preview',
      startDate,
      computedEndDate,
      sprintLen
    );

    const lastSprint = previewSprints[previewSprints.length - 1];
    const lastLen = lastSprint
      ? diffDaysInclusive(lastSprint.startDate, lastSprint.endDate)
      : 0;
    const fullCount =
      lastLen < sprintLen ? previewSprints.length - 1 : previewSprints.length;

    return {
      totalDays,
      sprintCount: previewSprints.length,
      sprintLen,
      fullCount,
      remainderDays: lastLen < sprintLen ? lastLen : 0,
    };
  }, [startDate, computedEndDate, sprintLengthDays]);

  const resetForm = () => {
    const today = todayLocal();
    setName('');
    setDescription('');
    setEndGoal('');
    setStartDate(today);
    setScheduleMode('duration');
    setDurationValue('6');
    setDurationUnit('weeks');
    setManualEndDate(calculateCycleEndDate(today, 6, 'weeks'));
    setSprintLengthDays('7');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Enter a name for the work cycle.');
      return;
    }
    if (!isValidLocalDate(startDate)) {
      setError('Enter a valid start date.');
      return;
    }
    if (!isValidLocalDate(computedEndDate)) {
      setError('Enter a valid duration or end date.');
      return;
    }
    if (computedEndDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    const sprintLen = Math.floor(Number(sprintLengthDays));
    if (!Number.isFinite(sprintLen) || sprintLen < 1) {
      setError('Sprint length must be at least 1 calendar day.');
      return;
    }

    setSubmitting(true);
    try {
      const cycle = await createCycle({
        name,
        description,
        endGoal,
        startDate,
        endDate: computedEndDate,
        sprintLengthDays: sprintLen,
      });
      resetForm();
      onClose();
      onCreated?.(cycle.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create work cycle.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalSheet
      open={open}
      onClose={handleClose}
      title="New Work Cycle"
      subtitle="Define your goal and sprint cadence"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-cycle-form"
            disabled={submitting}
            className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create Work Cycle'}
          </button>
        </div>
      }
    >
      <form id="new-cycle-form" onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <div>
          <label htmlFor="cycle-name" className="block text-sm font-medium text-slate-800">
            Work Cycle Name <span className="text-rose-600">*</span>
          </label>
          <input
            id="cycle-name"
            type="text"
            required
            placeholder="e.g., Q2 Product Launch or Fitness Plan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="cycle-goal" className="block text-sm font-medium text-slate-800">
            End Goal
          </label>
          <textarea
            id="cycle-goal"
            rows={2}
            placeholder="What concrete outcome defines success for this cycle?"
            value={endGoal}
            onChange={(e) => setEndGoal(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="cycle-desc" className="block text-sm font-medium text-slate-800">
            Description
          </label>
          <textarea
            id="cycle-desc"
            rows={2}
            placeholder="Optional context, scope, or notes"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cycle-start" className="block text-sm font-medium text-slate-800">
              Start Date
            </label>
            <input
              id="cycle-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="sprint-length" className="block text-sm font-medium text-slate-800">
              Sprint Length (days)
            </label>
            <input
              id="sprint-length"
              type="number"
              min={1}
              max={365}
              required
              value={sprintLengthDays}
              onChange={(e) => setSprintLengthDays(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-800">Cycle Length</span>
            <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5">
              <button
                type="button"
                onClick={() => setScheduleMode('duration')}
                className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  scheduleMode === 'duration'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Duration
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isValidLocalDate(computedEndDate)) {
                    setManualEndDate(computedEndDate);
                  }
                  setScheduleMode('endDate');
                }}
                className={`min-h-[36px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  scheduleMode === 'endDate'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                End Date
              </button>
            </div>
          </div>

          {scheduleMode === 'duration' ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                aria-label="Duration amount"
                type="number"
                min={1}
                max={365}
                value={durationValue}
                onChange={(e) => setDurationValue(e.target.value)}
                className="w-24 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
              <select
                aria-label="Duration unit"
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as DurationUnit)}
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="weeks">Weeks</option>
                <option value="days">Days</option>
              </select>
            </div>
          ) : (
            <div className="mt-3">
              <input
                aria-label="Cycle end date"
                type="date"
                min={startDate}
                value={manualEndDate}
                onChange={(e) => setManualEndDate(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>
          )}

          {previewSummary ? (
            <div className="mt-3 border-t border-slate-200/80 pt-2.5 text-xs text-slate-700 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                <span className="font-semibold text-slate-900">
                  Ends {formatDisplayDate(computedEndDate, { includeYear: true })}
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  ·
                </span>
                <span>{previewSummary.totalDays} calendar days</span>
              </div>
              <p className="text-slate-600 tabular-nums">
                Generates{' '}
                <span className="font-medium text-slate-900">
                  {previewSummary.sprintCount}{' '}
                  {previewSummary.sprintCount === 1 ? 'sprint' : 'sprints'}
                </span>{' '}
                (
                {previewSummary.remainderDays > 0
                  ? `${previewSummary.fullCount} × ${previewSummary.sprintLen}-day + 1 × ${previewSummary.remainderDays}-day`
                  : `${previewSummary.fullCount} × ${previewSummary.sprintLen}-day`}
                )
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-amber-800">
              Adjust dates and sprint length to preview generated sprints.
            </p>
          )}
        </div>
      </form>
    </ModalSheet>
  );
}
