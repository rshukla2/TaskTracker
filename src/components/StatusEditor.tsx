import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { createNewStatus } from '../core/db';
import { findTasksUsingStatus, replaceOrClearTasksStatus } from '../core/statuses';
import type { Task, WorkflowStatus } from '../core/types';
import { ModalSheet } from './ModalSheet';

interface StatusEditorProps {
  statuses: WorkflowStatus[];
  scopeTasks: Task[];
  disabled?: boolean;
  onCommit: (nextStatuses: WorkflowStatus[], updatedTasks: Task[]) => Promise<void>;
}

export function StatusEditor({
  statuses,
  scopeTasks,
  disabled = false,
  onCommit,
}: StatusEditorProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending status removal when tasks use it
  const [pendingRemoval, setPendingRemoval] = useState<{
    status: WorkflowStatus;
    affectedCount: number;
  } | null>(null);
  const [replacementId, setReplacementId] = useState<string>('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (statuses.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`Status "${trimmed}" already exists.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const next = [...statuses, createNewStatus(trimmed)];
      await onCommit(next, []);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add status.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (status: WorkflowStatus) => {
    setEditingId(status.id);
    setEditingName(status.name);
    setError(null);
  };

  const commitRename = async (statusId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setError('Status name cannot be empty.');
      return;
    }
    if (
      statuses.some(
        (s) => s.id !== statusId && s.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      setError(`Status "${trimmed}" already exists.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const next = statuses.map((s) =>
        s.id === statusId ? { ...s, name: trimmed } : s
      );
      await onCommit(next, []);
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename status.');
    } finally {
      setBusy(false);
    }
  };

  const moveStatus = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= statuses.length) return;
    const next = [...statuses];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);

    setBusy(true);
    setError(null);
    try {
      await onCommit(next, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder statuses.');
    } finally {
      setBusy(false);
    }
  };

  const requestRemove = async (status: WorkflowStatus) => {
    setError(null);
    const affected = findTasksUsingStatus(scopeTasks, status.id);
    if (affected.length === 0) {
      setBusy(true);
      try {
        await onCommit(
          statuses.filter((s) => s.id !== status.id),
          []
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove status.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const remaining = statuses.filter((s) => s.id !== status.id);
    setReplacementId(remaining[0]?.id ?? '');
    setPendingRemoval({
      status,
      affectedCount: affected.length,
    });
  };

  const confirmRemoveWithReplacement = async () => {
    if (!pendingRemoval) return;
    setBusy(true);
    setError(null);
    try {
      const nextStatuses = statuses.filter((s) => s.id !== pendingRemoval.status.id);
      const updatedTasks = replaceOrClearTasksStatus(scopeTasks, {
        [pendingRemoval.status.id]: replacementId || null,
      });
      await onCommit(nextStatuses, updatedTasks);
      setPendingRemoval(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove status.');
    } finally {
      setBusy(false);
    }
  };

  const remainingForModal = pendingRemoval
    ? statuses.filter((s) => s.id !== pendingRemoval.status.id)
    : [];

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {statuses.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            No workflow statuses configured. Add one below.
          </div>
        ) : (
          statuses.map((status, idx) => (
            <div
              key={status.id}
              className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4"
            >
              {editingId === status.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(status.id);
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                    autoFocus
                    aria-label="Edit status name"
                    className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => commitRename(status.id)}
                    aria-label="Save status name"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label="Cancel rename"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 pl-1">
                    {status.name}
                  </span>
                  <div className="flex items-center">
                    <button
                      type="button"
                      disabled={disabled || busy || idx === 0}
                      onClick={() => moveStatus(idx, -1)}
                      aria-label={`Move ${status.name} up`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || busy || idx === statuses.length - 1}
                      onClick={() => moveStatus(idx, 1)}
                      aria-label={`Move ${status.name} down`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => startEdit(status)}
                      aria-label={`Rename ${status.name}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => requestRemove(status)}
                      aria-label={`Remove ${status.name}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <input
          type="text"
          disabled={disabled || busy}
          placeholder="Add new status (e.g., Ready for QA)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={disabled || busy || !newName.trim()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </form>

      <ModalSheet
        open={Boolean(pendingRemoval)}
        onClose={() => setPendingRemoval(null)}
        title="Status In Use"
        subtitle={
          pendingRemoval
            ? `"${pendingRemoval.status.name}" is assigned to ${pendingRemoval.affectedCount} ${
                pendingRemoval.affectedCount === 1 ? 'task' : 'tasks'
              }`
            : undefined
        }
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingRemoval(null)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirmRemoveWithReplacement}
              className="min-h-[44px] rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? 'Updating…' : 'Remove Status'}
            </button>
          </div>
        }
      >
        {pendingRemoval ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Choose what to do with the {pendingRemoval.affectedCount}{' '}
              {pendingRemoval.affectedCount === 1 ? 'task' : 'tasks'} currently using{' '}
              <span className="font-semibold text-slate-900">
                {pendingRemoval.status.name}
              </span>
              . Completion state will stay unchanged.
            </p>
            <div>
              <label
                htmlFor="replacement-status-select"
                className="block text-sm font-medium text-slate-800"
              >
                Replacement Action
              </label>
              <select
                id="replacement-status-select"
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {remainingForModal.map((s) => (
                  <option key={s.id} value={s.id}>
                    Replace with "{s.name}"
                  </option>
                ))}
                <option value="">Clear status (leave unset)</option>
              </select>
            </div>
          </div>
        ) : null}
      </ModalSheet>
    </div>
  );
}
