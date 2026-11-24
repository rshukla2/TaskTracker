// Unit tests for the sync logic in src/core/sync.ts
//
// Runs standalone with Node's native TypeScript support:
//   npm test          # or: node --experimental-strip-types test/sync.test.ts
//
// All functions in sync.ts are pure and do not touch browser APIs.
import {
  hashItem,
  snapshotEntries,
  computeOutgoing,
  applyIncoming,
  buildShadow,
  type Change,
} from '../src/core/sync.ts';
import type { WorkspaceSnapshot } from '../src/core/types.ts';

// ---- tiny assertion helpers (avoid a node:assert dependency) ----
function assert(cond: unknown, msg?: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed${msg ? `: ${msg}` : ''}.`);
}
function assertEqual<T>(actual: T, expected: T, msg?: string) {
  assert(actual === expected, `${msg ?? ''} expected ${String(expected)}, got ${String(actual)}`);
}
function assertDeepEqual<T>(actual: T, expected: T, msg?: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg ?? ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// ---- fixtures ----
function settings(updatedAt = '2026-01-01T00:00:00.000Z'): any {
  return {
    id: 'app_settings',
    defaultStatuses: [{ id: 'status-todo', name: 'To Do' }],
    completedStatusMigrated: true,
    updatedAt,
  };
}

function cycle(id: string, name = id, updatedAt = '2026-01-01T00:00:00.000Z'): any {
  return {
    id,
    name,
    description: '',
    endGoal: '',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    sprintLengthDays: 1,
    useCustomStatuses: false,
    customStatuses: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

function sprint(id: string, workCycleId: string, updatedAt = '2026-01-01T00:00:00.000Z'): any {
  return {
    id,
    workCycleId,
    name: id,
    endGoal: '',
    startDate: '2026-01-01',
    endDate: '2026-01-07',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

function task(id: string, workCycleId: string, sprintId: string, updatedAt = '2026-01-01T00:00:00.000Z'): any {
  return {
    id,
    workCycleId,
    sprintId,
    title: id,
    description: '',
    deadline: null,
    estimatedHours: null,
    effort: null,
    statusId: null,
    previousStatusId: null,
    blockerReason: '',
    completed: false,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

function makeSnapshot(overrides?: Partial<WorkspaceSnapshot>): WorkspaceSnapshot {
  return {
    settings: settings(),
    workCycles: [cycle('c1', 'Cycle 1')],
    sprints: [sprint('s1', 'c1')],
    tasks: [task('t1', 'c1', 's1')],
    ...overrides,
  };
}

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${label}`);
}

// ---- Tests for hashItem ----
check('hashItem produces deterministic hash', () => {
  const obj = { a: 1, b: 'test' };
  const hash1 = hashItem(obj);
  const hash2 = hashItem(obj);
  assert(hash1 === hash2, 'same object produces same hash');
  assert(hash1.length > 0, 'hash is non-empty');
});

check('hashItem produces different hashes for different objects', () => {
  const hash1 = hashItem({ a: 1 });
  const hash2 = hashItem({ a: 2 });
  assert(hash1 !== hash2, 'different objects produce different hashes');
});

// ---- Tests for snapshotEntries ----
check('snapshotEntries lists all items', () => {
  const snapshot = makeSnapshot();
  const entries = snapshotEntries(snapshot);

  assert(entries.length === 4, 'should have 4 entries (settings + cycle + sprint + task)');

  const kinds = entries.map((e) => e.kind);
  assert(kinds.includes('settings'), 'should include settings');
  assert(kinds.includes('workCycle'), 'should include workCycle');
  assert(kinds.includes('sprint'), 'should include sprint');
  assert(kinds.includes('task'), 'should include task');
});

check('snapshotEntries includes settings with app_settings id', () => {
  const snapshot = makeSnapshot();
  const entries = snapshotEntries(snapshot);
  const settingsEntry = entries.find((e) => e.kind === 'settings');
  assert(settingsEntry !== undefined, 'settings entry should exist');
  assertEqual(settingsEntry.id, 'app_settings', 'settings id should be app_settings');
});

// ---- Tests for computeOutgoing - first sync (empty shadow) ----
check('first sync with empty shadow sends all items', () => {
  const snapshot = makeSnapshot();
  const shadow: any = {};
  const nowIso = '2026-06-01T00:00:00.000Z';

  const { changes, snapshot: bumpedSnapshot } = computeOutgoing(snapshot, shadow, nowIso);

  assertEqual(changes.length, 4, 'should have 4 changes');
  assert(changes.every((c: Change) => !c.deleted), 'no deletions on first sync');

  const kinds = changes.map((c: Change) => c.kind);
  assert(kinds.includes('settings'), 'should include settings');
  assert(kinds.includes('workCycle'), 'should include workCycle');
  assert(kinds.includes('sprint'), 'should include sprint');
  assert(kinds.includes('task'), 'should include task');
});

// ---- Tests for computeOutgoing - unchanged items not sent ----
check('unchanged items not sent', () => {
  const snapshot = makeSnapshot();
  const shadow = buildShadow(snapshot);
  const nowIso = '2026-06-01T00:00:00.000Z';

  const { changes } = computeOutgoing(snapshot, shadow, nowIso);

  assertEqual(changes.length, 0, 'no changes for unchanged items');
});

// ---- Tests for computeOutgoing - changed items get bumped updatedAt ----
check('changed item with same updatedAt gets bumped', () => {
  const snapshot = makeSnapshot();
  const shadow = buildShadow(snapshot);
  const nowIso = '2026-06-01T00:00:00.000Z';

  // Modify the task in the snapshot (keeping updatedAt the same)
  const modifiedSnapshot: WorkspaceSnapshot = {
    ...snapshot,
    tasks: snapshot.tasks.map((t) => ({ ...t, title: 'Modified' })),
  };
  // Reset updatedAt to match shadow to test bumping
  (modifiedSnapshot.tasks[0] as any).updatedAt = shadow['task:t1'].u;

  const { changes, snapshot: bumpedSnapshot } = computeOutgoing(modifiedSnapshot, shadow, nowIso);

  assertEqual(changes.length, 1, 'one change for modified task');
  assertEqual(changes[0].kind, 'task', 'change is for task');
  assertEqual((changes[0].data as any).title, 'Modified', 'change data has modified title');
  // updatedAt should be bumped to nowIso since it was <= shadow's u
  assertEqual(changes[0].updatedAt, nowIso, 'updatedAt is bumped to nowIso');

  // Check the snapshot is also bumped
  assertEqual(bumpedSnapshot.tasks[0].updatedAt, nowIso, 'bumped snapshot task has bumped updatedAt');
});

// ---- Tests for computeOutgoing - deleted items become tombstones ----
check('deleted item becomes tombstone', () => {
  const snapshot = makeSnapshot({ tasks: [] }); // tasks removed
  const shadow = buildShadow(makeSnapshot());
  const nowIso = '2026-06-01T00:00:00.000Z';

  const { changes } = computeOutgoing(snapshot, shadow, nowIso);

  const tombstone = changes.find((c: Change) => c.kind === 'task' && c.id === 't1' && c.deleted);
  assert(tombstone !== undefined, 'should have tombstone for deleted task');
  assertEqual(tombstone?.data, null, 'tombstone data is null');
  assertEqual(tombstone?.updatedAt, nowIso, 'tombstone updatedAt is nowIso');
});

// ---- Tests for applyIncoming - newer wins ----
check('applyIncoming: newer remote wins', () => {
  const snapshot = makeSnapshot();
  const changes: Change[] = [
    {
      kind: 'task',
      id: 't1',
      data: task('t1', 'c1', 's1', '2026-07-01T00:00:00.000Z'),
      updatedAt: '2026-07-01T00:00:00.000Z',
      deleted: false,
    },
  ];

  const { snapshot: newSnapshot, changed } = applyIncoming(snapshot, changes);

  assert(changed, 'snapshot should change');
  assertEqual(newSnapshot.tasks[0].updatedAt, '2026-07-01T00:00:00.000Z', 'remote newer wins');
});

// ---- Tests for applyIncoming - older ignored ----
check('applyIncoming: older remote ignored', () => {
  const snapshot = makeSnapshot();
  const changes: Change[] = [
    {
      kind: 'task',
      id: 't1',
      data: task('t1', 'c1', 's1', '2026-01-01T00:00:00.000Z'),
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: false,
    },
  ];

  const { snapshot: newSnapshot, changed } = applyIncoming(snapshot, changes);

  assert(!changed, 'snapshot should not change');
  assertEqual(newSnapshot.tasks[0].updatedAt, '2026-01-01T00:00:00.000Z', 'local unchanged');
});

// ---- Tests for applyIncoming - deleted removes ----
check('applyIncoming: deleted removes item', () => {
  const snapshot = makeSnapshot();
  const changes: Change[] = [
    {
      kind: 'task',
      id: 't1',
      data: null,
      updatedAt: '2026-07-01T00:00:00.000Z',
      deleted: true,
    },
  ];

  const { snapshot: newSnapshot, changed } = applyIncoming(snapshot, changes);

  assert(changed, 'snapshot should change');
  assertEqual(newSnapshot.tasks.length, 0, 'task removed');
});

// ---- Tests for applyIncoming - settings replaced ----
check('applyIncoming: settings replaced', () => {
  const snapshot = makeSnapshot();
  const changes: Change[] = [
    {
      kind: 'settings',
      id: 'app_settings',
      data: settings('2026-07-01T00:00:00.000Z'),
      updatedAt: '2026-07-01T00:00:00.000Z',
      deleted: false,
    },
  ];

  const { snapshot: newSnapshot, changed } = applyIncoming(snapshot, changes);

  assert(changed, 'snapshot should change');
  assertEqual(newSnapshot.settings.updatedAt, '2026-07-01T00:00:00.000Z', 'settings replaced');
});

// ---- Tests for buildShadow round trip ----
check('buildShadow round trip: computeOutgoing after buildShadow -> no changes', () => {
  const snapshot = makeSnapshot();
  const shadow = buildShadow(snapshot);
  const nowIso = '2026-06-01T00:00:00.000Z';

  // First call - should have no changes
  const { changes } = computeOutgoing(snapshot, shadow, nowIso);

  assertEqual(changes.length, 0, 'no changes for fresh shadow');
});

// ---- Tests for applyIncoming - new items added ----
check('applyIncoming: new items added', () => {
  const snapshot = makeSnapshot();
  const changes: Change[] = [
    {
      kind: 'task',
      id: 't2',
      data: task('t2', 'c1', 's1', '2026-07-01T00:00:00.000Z'),
      updatedAt: '2026-07-01T00:00:00.000Z',
      deleted: false,
    },
  ];

  const { snapshot: newSnapshot, changed } = applyIncoming(snapshot, changes);

  assert(changed, 'snapshot should change');
  assertEqual(newSnapshot.tasks.length, 2, 'new task added');
  assert(newSnapshot.tasks.some((t) => t.id === 't2'), 'new task exists');
});

console.log(`\nAll ${passed} sync test(s) passed.`);
