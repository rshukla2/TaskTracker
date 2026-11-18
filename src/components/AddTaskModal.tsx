import React, { useState } from 'react';
import { formatDateRange } from '../core/dates';
import { isBlockedStatus } from '../core/statuses';
import { EffortLevel, type Sprint, type WorkflowStatus } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';
import { ModalSheet } from './ModalSheet';

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  workCycleId: string;
  sprint: Sprint;
  statuses: WorkflowStatus[];
}

export function AddTaskModal({
  open,
  onClose,
  workCycleId,
  sprint,
  statuses,
}: AddTaskModalProps) {
  const { createTask } = useWorkspace();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [effort, setEffort] = useState<string>('');
  const [statusId, setStatusId] = useState<string>('');
  const [blockerReason, setBlockerReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showBlockerField = isBlockedStatus(statusId || null, statuses);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDeadline('');
    setEstimatedHours('');
    setEffort('');
    setStatusId('');
    setBlockerReason('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Enter a task title.');
      return;
    }

    let parsedHours: number | null = null;
    if (estimatedHours.trim() !== '') {
      const n = Number(estimatedHours);
      if (!Number.isFinite(n) || n < 0) {
        setError('Estimated hours must be a valid non-negative number (e.g., 0.5 or 1.5).');
        return;
      }
      parsedHours = n;
    }

    setSaving(true);
    try {
      await createTask({
        workCycleId,
        sprintId: sprint.id,
        title,
        description,
        deadline: deadline || null,
        estimatedHours: parsedHours,
        effort: effort ? (effort as EffortLevel) : null,
        statusId: statusId || null,
        blockerReason: showBlockerField ? blockerReason : '',
      });
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      open={open}
      onClose={handleClose}
      title="Add Task"
      subtitle={`${sprint.name} · ${formatDateRange(sprint.startDate, sprint.endDate)}`}
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
            form="add-task-form"
            disabled={saving}
            className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? 'Adding…' : 'Add Task'}
          </button>
        </div>
      }
    >
      <form id="add-task-form" onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <div>
          <label htmlFor="task-title" className="block text-sm font-medium text-slate-800">
            Title <span className="text-rose-600">*</span>
          </label>
          <input
            id="task-title"
            type="text"
            required
            autoFocus
            placeholder="What needs to get done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="task-description" className="block text-sm font-medium text-slate-800">
            Description
          </label>
          <textarea
            id="task-description"
            rows={3}
            placeholder="Optional notes, checklist, or acceptance criteria"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="task-deadline" className="block text-sm font-medium text-slate-800">
              Deadline
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="task-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
              {deadline ? (
                <button
                  type="button"
                  onClick={() => setDeadline('')}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor="task-hours" className="block text-sm font-medium text-slate-800">
              Estimated Hours
            </label>
            <input
              id="task-hours"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="e.g., 0.5 or 1.5"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="task-effort" className="block text-sm font-medium text-slate-800">
              Effort
            </label>
            <select
              id="task-effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value="">None</option>
              <option value={EffortLevel.Low}>Low</option>
              <option value={EffortLevel.Medium}>Medium</option>
              <option value={EffortLevel.High}>High</option>
            </select>
          </div>

          <div>
            <label htmlFor="task-status" className="block text-sm font-medium text-slate-800">
              Workflow Status
            </label>
            <select
              id="task-status"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value="">None</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showBlockerField ? (
          <div>
            <label htmlFor="task-blocker" className="block text-sm font-medium text-slate-800">
              Blocker &amp; Unblock Plan
            </label>
            <textarea
              id="task-blocker"
              rows={2}
              placeholder="Optional: why is this task blocked and what can unblock it?"
              value={blockerReason}
              onChange={(e) => setBlockerReason(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-rose-200 bg-rose-50/40 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>
        ) : null}
      </form>
    </ModalSheet>
  );
}
