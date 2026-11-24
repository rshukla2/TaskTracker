// Pure sync functions - no browser APIs, no imports from db.ts
// Implements snapshot diffing for sync with server

import type { WorkspaceSnapshot, AppSettings, WorkCycle, Sprint, Task } from './types';

export type SyncKind = 'settings' | 'workCycle' | 'sprint' | 'task';

export interface Change {
  kind: SyncKind;
  id: string;
  data: object | null;
  updatedAt: string;
  deleted: boolean;
}

export interface ShadowEntry {
  h: string; // hash
  u: string; // updatedAt
}

export type Shadow = Record<string /* kind:id */, ShadowEntry>;

// djb2 hash over JSON.stringify - produces small deterministic string
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function hashItem(obj: unknown): string {
  return djb2Hash(JSON.stringify(obj));
}

// List all items from snapshot as {kind, id, item}
export function snapshotEntries(snapshot: WorkspaceSnapshot): Array<{ kind: SyncKind; id: string; item: object }> {
  const entries: Array<{ kind: SyncKind; id: string; item: object }> = [];

  // Settings has a fixed id
  entries.push({ kind: 'settings', id: 'app_settings', item: snapshot.settings });

  // Work cycles
  for (const cycle of snapshot.workCycles) {
    entries.push({ kind: 'workCycle', id: cycle.id, item: cycle });
  }

  // Sprints
  for (const sprint of snapshot.sprints) {
    entries.push({ kind: 'sprint', id: sprint.id, item: sprint });
  }

  // Tasks
  for (const task of snapshot.tasks) {
    entries.push({ kind: 'task', id: task.id, item: task });
  }

  return entries;
}

// Compute outgoing changes based on snapshot and shadow
// Returns changes and an updated snapshot with bumped updatedAt for local changes
export function computeOutgoing(
  snapshot: WorkspaceSnapshot,
  shadow: Shadow,
  nowIso: string
): { changes: Change[]; snapshot: WorkspaceSnapshot } {
  const changes: Change[] = [];
  const newSnapshot = { ...snapshot };

  // Check all entries in snapshot
  for (const { kind, id, item } of snapshotEntries(snapshot)) {
    const key = `${kind}:${id}`;
    const shadowEntry = shadow[key];
    const currentItem = item as any;

    if (!shadowEntry) {
      // New item - not in shadow, send it
      changes.push({
        kind,
        id,
        data: currentItem,
        updatedAt: currentItem.updatedAt || nowIso,
        deleted: false,
      });
    } else if (hashItem(currentItem) !== shadowEntry.h) {
      // Changed item - hash differs
      // If local updatedAt <= shadow's updatedAt, bump it so server accepts it (last-write-wins)
      const localDate = new Date(currentItem.updatedAt || nowIso).getTime();
      const shadowDate = new Date(shadowEntry.u).getTime();

      let updatedItem = currentItem;
      if (localDate <= shadowDate) {
        // Bump the updatedAt in the item and the change
        updatedItem = { ...currentItem, updatedAt: nowIso };
        // Update in newSnapshot
        if (kind === 'settings') {
          newSnapshot.settings = updatedItem as AppSettings;
        } else if (kind === 'workCycle') {
          newSnapshot.workCycles = newSnapshot.workCycles.map((c) => (c.id === id ? updatedItem as WorkCycle : c));
        } else if (kind === 'sprint') {
          newSnapshot.sprints = newSnapshot.sprints.map((s) => (s.id === id ? updatedItem as Sprint : s));
        } else if (kind === 'task') {
          newSnapshot.tasks = newSnapshot.tasks.map((t) => (t.id === id ? updatedItem as Task : t));
        }
      }

      changes.push({
        kind,
        id,
        data: updatedItem,
        updatedAt: updatedItem.updatedAt,
        deleted: false,
      });
    }
  }

  // Check for deleted items - in shadow but not in snapshot
  const presentKeys = new Set(snapshotEntries(snapshot).map((e) => `${e.kind}:${e.id}`));
  for (const key of Object.keys(shadow)) {
    const sep = key.indexOf(':');
    const kind = key.slice(0, sep) as SyncKind;
    const id = key.slice(sep + 1);
    if (!presentKeys.has(key)) {
      // Item was deleted
      changes.push({
        kind,
        id,
        data: null,
        updatedAt: nowIso,
        deleted: true,
      });
    }
  }

  return { changes, snapshot: newSnapshot };
}

// Apply incoming changes with last-write-wins
// Returns updated snapshot and whether anything changed
export function applyIncoming(
  snapshot: WorkspaceSnapshot,
  changes: Change[]
): { snapshot: WorkspaceSnapshot; changed: boolean } {
  let newSnapshot = { ...snapshot };
  let changed = false;

  for (const change of changes) {
    const key = `${change.kind}:${change.id}`;
    const remoteDate = new Date(change.updatedAt).getTime();

    if (change.deleted) {
      // Tombstone - remove the item locally if exists
      if (change.kind === 'settings') {
        // Settings should be replaced, not deleted (but we treat as removed if data is null)
        if (change.data === null) {
          newSnapshot.settings = createDefaultSettings();
          changed = true;
        }
      } else if (change.kind === 'workCycle') {
        if (newSnapshot.workCycles.some((c) => c.id === change.id)) {
          newSnapshot.workCycles = newSnapshot.workCycles.filter((c) => c.id !== change.id);
          changed = true;
        }
      } else if (change.kind === 'sprint') {
        if (newSnapshot.sprints.some((s) => s.id === change.id)) {
          newSnapshot.sprints = newSnapshot.sprints.filter((s) => s.id !== change.id);
          changed = true;
        }
      } else if (change.kind === 'task') {
        if (newSnapshot.tasks.some((t) => t.id === change.id)) {
          newSnapshot.tasks = newSnapshot.tasks.filter((t) => t.id !== change.id);
          changed = true;
        }
      }
      continue;
    }

    if (!change.data) {
      continue;
    }

    if (change.kind === 'settings') {
      // Settings change replaces settings
      newSnapshot.settings = change.data as AppSettings;
      changed = true;
    } else if (change.kind === 'workCycle') {
      const existing = newSnapshot.workCycles.find((c) => c.id === change.id);
      if (!existing) {
        newSnapshot.workCycles = [...newSnapshot.workCycles, change.data as WorkCycle];
        changed = true;
      } else {
        const localDate = new Date(existing.updatedAt).getTime();
        if (remoteDate > localDate) {
          newSnapshot.workCycles = newSnapshot.workCycles.map((c) =>
            c.id === change.id ? (change.data as WorkCycle) : c
          );
          changed = true;
        }
      }
    } else if (change.kind === 'sprint') {
      const existing = newSnapshot.sprints.find((s) => s.id === change.id);
      if (!existing) {
        newSnapshot.sprints = [...newSnapshot.sprints, change.data as Sprint];
        changed = true;
      } else {
        const localDate = new Date(existing.updatedAt).getTime();
        if (remoteDate > localDate) {
          newSnapshot.sprints = newSnapshot.sprints.map((s) =>
            s.id === change.id ? (change.data as Sprint) : s
          );
          changed = true;
        }
      }
    } else if (change.kind === 'task') {
      const existing = newSnapshot.tasks.find((t) => t.id === change.id);
      if (!existing) {
        newSnapshot.tasks = [...newSnapshot.tasks, change.data as Task];
        changed = true;
      } else {
        const localDate = new Date(existing.updatedAt).getTime();
        if (remoteDate > localDate) {
          newSnapshot.tasks = newSnapshot.tasks.map((t) =>
            t.id === change.id ? (change.data as Task) : t
          );
          changed = true;
        }
      }
    }
  }

  return { snapshot: newSnapshot, changed };
}

// Build shadow from current items
export function buildShadow(snapshot: WorkspaceSnapshot): Shadow {
  const shadow: Shadow = {};

  for (const { kind, id, item } of snapshotEntries(snapshot)) {
    const key = `${kind}:${id}`;
    shadow[key] = {
      h: hashItem(item),
      u: (item as any).updatedAt || new Date().toISOString(),
    };
  }

  return shadow;
}

// Create default settings for tombstone
function createDefaultSettings(): AppSettings {
  return {
    id: 'app_settings',
    defaultStatuses: [
      { id: 'status-todo', name: 'To Do' },
      { id: 'status-in-progress', name: 'In Progress' },
      { id: 'status-in-review', name: 'In Review' },
      { id: 'status-blocked', name: 'Blocked' },
      { id: 'status-completed', name: 'Completed' },
    ],
    completedStatusMigrated: true,
    updatedAt: new Date().toISOString(),
  };
}
