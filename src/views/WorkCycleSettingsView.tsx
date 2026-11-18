import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { ModalSheet } from '../components/ModalSheet';
import { StatusEditor } from '../components/StatusEditor';
import {
  findUnmatchedTasksForStatusList,
  replaceOrClearTasksStatus,
} from '../core/statuses';
import type { WorkflowStatus } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';

interface WorkCycleSettingsViewProps {
  cycleId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function WorkCycleSettingsView({
  cycleId,
  onBack,
  onDeleted,
}: WorkCycleSettingsViewProps) {
  const {
    settings,
    workCycles,
    tasks,
    updateCycleDetails,
    updateCycleStatusConfig,
    deleteCycle,
  } = useWorkspace();

  const cycle = workCycles.find((c) => c.id === cycleId);
  const cycleTasks = useMemo(
    () => tasks.filter((t) => t.workCycleId === cycleId),
    [tasks, cycleId]
  );

  const [name, setName] = useState(cycle?.name ?? '');
  const [endGoal, setEndGoal] = useState(cycle?.endGoal ?? '');
  const [description, setDescription] = useState(cycle?.description ?? '');
  const [savingDetails, setSavingDetails] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [pendingSwitch, setPendingSwitch] = useState<{
    targetUseCustom: boolean;
    targetStatuses: WorkflowStatus[];
    unmatchedGroups: Array<{ statusId: string; statusName: string; count: number }>;
  } | null>(null);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [switching, setSwitching] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (cycle) {
      setName(cycle.name);
      setEndGoal(cycle.endGoal);
      setDescription(cycle.description);
    }
  }, [cycle?.id]);

  if (!cycle) {
    return (
      <div className="min-h-dvh bg-white text-slate-900">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-4xl items-center px-4 sm:px-6">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-12 text-center">
          <p className="text-base font-medium text-slate-900">Work cycle not found</p>
        </main>
      </div>
    );
  }

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingDetails(true);
    try {
      await updateCycleDetails(cycle.id, { name, endGoal, description });
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2000);
    } finally {
      setSavingDetails(false);
    }
  };

  const handleToggleCustomStatuses = async (nextUseCustom: boolean) => {
    if (nextUseCustom === cycle.useCustomStatuses) return;

    const sourceStatuses = cycle.useCustomStatuses
      ? cycle.customStatuses
      : settings.defaultStatuses;

    // When enabling custom statuses for the first time, copy app defaults
    const targetStatuses = nextUseCustom
      ? cycle.customStatuses.length > 0
        ? cycle.customStatuses
        : settings.defaultStatuses.map((s) => ({ ...s }))
      : settings.defaultStatuses;

    const { unmatchedGroups } = findUnmatchedTasksForStatusList(
      cycleTasks,
      sourceStatuses,
      targetStatuses
    );

    if (unmatchedGroups.length === 0) {
      await updateCycleStatusConfig(
        {
          ...cycle,
          useCustomStatuses: nextUseCustom,
          customStatuses: nextUseCustom ? targetStatuses : cycle.customStatuses,
        },
        []
      );
      return;
    }

    const initialMap: Record<string, string> = {};
    for (const g of unmatchedGroups) {
      initialMap[g.statusId] = targetStatuses[0]?.id ?? '';
    }
    setReplacements(initialMap);
    setPendingSwitch({
      targetUseCustom: nextUseCustom,
      targetStatuses,
      unmatchedGroups,
    });
  };

  const confirmSwitchWithReplacements = async () => {
    if (!pendingSwitch) return;
    setSwitching(true);
    try {
      const normalized: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(replacements)) {
        normalized[k] = v || null;
      }
      const updatedTasks = replaceOrClearTasksStatus(cycleTasks, normalized);
      await updateCycleStatusConfig(
        {
          ...cycle,
          useCustomStatuses: pendingSwitch.targetUseCustom,
          customStatuses: pendingSwitch.targetUseCustom
            ? pendingSwitch.targetStatuses
            : cycle.customStatuses,
        },
        updatedTasks
      );
      setPendingSwitch(null);
    } finally {
      setSwitching(false);
    }
  };

  const handleDeleteCycle = async () => {
    setDeleting(true);
    try {
      await deleteCycle(cycle.id);
      setDeleteConfirmOpen(false);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

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
            <span>{cycle.name}</span>
          </button>
          <span className="text-sm font-semibold text-slate-900 sm:text-base">
            Cycle Settings
          </span>
          <div className="w-16" aria-hidden="true" />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Cycle Details</h2>
          <form onSubmit={handleSaveDetails} className="mt-4 space-y-4">
            <div>
              <label htmlFor="edit-cycle-name" className="block text-sm font-medium text-slate-800">
                Name
              </label>
              <input
                id="edit-cycle-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-cycle-goal" className="block text-sm font-medium text-slate-800">
                End Goal
              </label>
              <textarea
                id="edit-cycle-goal"
                rows={2}
                value={endGoal}
                onChange={(e) => setEndGoal(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-cycle-desc" className="block text-sm font-medium text-slate-800">
                Description
              </label>
              <textarea
                id="edit-cycle-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={savingDetails || !name.trim()}
                className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {savingDetails ? 'Saving…' : 'Save Details'}
              </button>
              {savedNotice ? (
                <span className="text-sm font-medium text-emerald-700">Saved</span>
              ) : null}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Workflow Statuses</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                {cycle.useCustomStatuses
                  ? 'This cycle uses its own independent workflow statuses.'
                  : 'Inheriting default workflow statuses from app Settings.'}
              </p>
            </div>

            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2">
              <input
                type="checkbox"
                checked={cycle.useCustomStatuses}
                onChange={(e) => handleToggleCustomStatuses(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span className="text-sm font-medium text-slate-900 whitespace-nowrap">
                Use custom statuses
              </span>
            </label>
          </div>

          {cycle.useCustomStatuses ? (
            <StatusEditor
              statuses={cycle.customStatuses}
              scopeTasks={cycleTasks}
              onCommit={async (nextStatuses, updatedTasks) => {
                await updateCycleStatusConfig(
                  { ...cycle, customStatuses: nextStatuses },
                  updatedTasks
                );
              }}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Inherited App Defaults
              </p>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm text-slate-800">
                {settings.defaultStatuses.map((s, i) => (
                  <span key={s.id} className="inline-flex items-center gap-2">
                    {i > 0 ? <span className="text-slate-400">·</span> : null}
                    <span>{s.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 sm:p-6">
          <h2 className="text-base font-semibold text-rose-900">Delete Work Cycle</h2>
          <p className="mt-1 text-sm text-rose-800">
            Permanently removes this work cycle, all of its sprints, and all of its tasks.
          </p>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete Work Cycle
          </button>
        </section>
      </main>

      <ModalSheet
        open={Boolean(pendingSwitch)}
        onClose={() => setPendingSwitch(null)}
        title="Replace Affected Statuses"
        subtitle="Some tasks in this cycle use statuses not in the target list"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingSwitch(null)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={switching}
              onClick={confirmSwitchWithReplacements}
              className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {switching ? 'Switching…' : 'Confirm Switch'}
            </button>
          </div>
        }
      >
        {pendingSwitch ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Choose a replacement status or clear the status for affected tasks. Completion
              state remains unchanged.
            </p>
            <div className="space-y-3">
              {pendingSwitch.unmatchedGroups.map((group) => (
                <div
                  key={group.statusId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-900">{group.statusName}</span>
                    <span className="text-xs text-slate-600 tabular-nums">
                      {group.count} {group.count === 1 ? 'task' : 'tasks'}
                    </span>
                  </div>
                  <select
                    aria-label={`Replacement for ${group.statusName}`}
                    value={replacements[group.statusId] ?? ''}
                    onChange={(e) =>
                      setReplacements((prev) => ({
                        ...prev,
                        [group.statusId]: e.target.value,
                      }))
                    }
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {pendingSwitch.targetStatuses.map((target) => (
                      <option key={target.id} value={target.id}>
                        Replace with "{target.name}"
                      </option>
                    ))}
                    <option value="">Clear status (leave unset)</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </ModalSheet>

      <ModalSheet
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={`Delete "${cycle.name}"?`}
        subtitle="This action cannot be undone"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(false)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDeleteCycle}
              className="min-h-[44px] rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Forever'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          This will permanently delete <span className="font-semibold">{cycle.name}</span> and
          all {cycleTasks.length} {cycleTasks.length === 1 ? 'task' : 'tasks'} inside it.
        </p>
      </ModalSheet>
    </div>
  );
}
