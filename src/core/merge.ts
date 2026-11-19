import type { WorkspaceSnapshot } from './types';

/**
 * Result of merging an imported backup into the current workspace.
 */
export interface MergeBackupResult {
  snapshot: WorkspaceSnapshot;
  /** Counts of brand-new items that were actually added (existing ids skipped). */
  added: {
    workCycles: number;
    sprints: number;
    tasks: number;
  };
}

/**
 * Merge an imported snapshot on top of the current one.
 *
 * - The main app **settings are overridden** by the imported settings.
 * - Work cycles, sprints, and tasks are **added by id**: any item whose id
 *   already exists locally is left exactly as-is (existing data is never
 *   changed or removed), and items with a new id are appended.
 *
 * Pure and synchronous — no database or platform access — so the merge
 * semantics can be unit-tested in isolation.
 */
export function mergeWorkspaceSnapshots(
  current: WorkspaceSnapshot,
  incoming: WorkspaceSnapshot,
): MergeBackupResult {
  const existingCycleIds = new Set(current.workCycles.map((c) => c.id));
  const existingSprintIds = new Set(current.sprints.map((s) => s.id));
  const existingTaskIds = new Set(current.tasks.map((t) => t.id));

  const newCycles = incoming.workCycles.filter((c) => !existingCycleIds.has(c.id));
  const newSprints = incoming.sprints.filter((s) => !existingSprintIds.has(s.id));
  const newTasks = incoming.tasks.filter((t) => !existingTaskIds.has(t.id));

  return {
    snapshot: {
      // Settings are the "main app settings" — override them with the import.
      settings: incoming.settings,
      // Existing items are preserved; only ids not already present are added.
      workCycles: [...current.workCycles, ...newCycles],
      sprints: [...current.sprints, ...newSprints],
      tasks: [...current.tasks, ...newTasks],
    },
    added: {
      workCycles: newCycles.length,
      sprints: newSprints.length,
      tasks: newTasks.length,
    },
  };
}
