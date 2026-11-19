// Unit tests for the backup-merge logic in src/core/merge.ts.
//
// Runs standalone with Node's native TypeScript support (no test framework):
//   npm test          # or: node --experimental-strip-types test/merge.test.ts
//
// mergeWorkspaceSnapshots is pure and does not touch IndexedDB/Capacitor, so it
// can be imported and exercised directly. (The type-only imports are erased at
// runtime, so nothing from db.ts/@capacitor is loaded.)
import { mergeWorkspaceSnapshots } from '../src/core/merge.ts';
import type {
  AppSettings,
  Sprint,
  Task,
  WorkCycle,
  WorkspaceSnapshot,
} from '../src/core/types.ts';

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
function settings(names: string[] = ['To Do', 'Done']): AppSettings {
  return {
    id: 'app_settings',
    defaultStatuses: names.map((name) => ({ id: `status-${name}`, name })),
    completedStatusMigrated: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function cycle(id: string, name = id): WorkCycle {
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
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function sprint(id: string, workCycleId: string): Sprint {
  return {
    id,
    workCycleId,
    name: id,
    endGoal: '',
    startDate: '2026-01-01',
    endDate: '2026-01-07',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function task(id: string, workCycleId: string, sprintId: string): Task {
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
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${label}`);
}

// 1) New items added, existing kept, settings overridden.
check('adds new items, keeps existing, overrides settings', () => {
  const current: WorkspaceSnapshot = {
    settings: settings(['To Do']),
    workCycles: [cycle('c1', 'Existing')],
    sprints: [sprint('s1', 'c1')],
    tasks: [task('t1', 'c1', 's1')],
  };
  const incoming: WorkspaceSnapshot = {
    settings: settings(['To Do', 'In Review', 'Done']),
    workCycles: [cycle('c1', 'Existing'), cycle('c2', 'New')],
    sprints: [sprint('s1', 'c1'), sprint('s2', 'c2')],
    tasks: [task('t1', 'c1', 's1'), task('t2', 'c2', 's2')],
  };

  const result = mergeWorkspaceSnapshots(current, incoming);

  assertDeepEqual(result.added, { workCycles: 1, sprints: 1, tasks: 1 });
  assertEqual(result.snapshot.workCycles.length, 2);
  assertEqual(result.snapshot.sprints.length, 2);
  assertEqual(result.snapshot.tasks.length, 2);
  // Settings overridden with the import's three statuses.
  assertEqual(result.snapshot.settings.defaultStatuses.length, 3);
  // Existing cycle kept its original name (not replaced by the import's copy).
  const kept = result.snapshot.workCycles.find((c) => c.id === 'c1');
  assert(kept, 'existing cycle c1 should be present');
  assertEqual(kept?.name, 'Existing');
  // New items are present.
  assert(result.snapshot.workCycles.some((c) => c.id === 'c2'), 'new cycle c2 should be added');
  assert(result.snapshot.tasks.some((t) => t.id === 't2'), 'new task t2 should be added');
});

// 2) No duplicate ids in the merged result.
check('never produces duplicate ids', () => {
  const current: WorkspaceSnapshot = {
    settings: settings(),
    workCycles: [cycle('c1')],
    sprints: [sprint('s1', 'c1')],
    tasks: [task('t1', 'c1', 's1')],
  };
  const incoming: WorkspaceSnapshot = {
    settings: settings(),
    workCycles: [cycle('c1'), cycle('c3')],
    sprints: [sprint('s1', 'c1'), sprint('s3', 'c3')],
    tasks: [task('t1', 'c1', 's1'), task('t3', 'c3', 's3')],
  };
  const result = mergeWorkspaceSnapshots(current, incoming);
  const cycleIds = result.snapshot.workCycles.map((c) => c.id);
  assertEqual(new Set(cycleIds).size, cycleIds.length, 'no duplicate cycle ids');
  assertDeepEqual([...cycleIds].sort(), ['c1', 'c3']);
});

// 3) An id collision keeps the existing item's data (existing wins, never mutated).
check('id collision keeps existing data', () => {
  const current: WorkspaceSnapshot = {
    settings: settings(['To Do']),
    workCycles: [cycle('c1', 'Original Name')],
    sprints: [],
    tasks: [],
  };
  const incoming: WorkspaceSnapshot = {
    settings: settings(['To Do', 'Done']),
    workCycles: [cycle('c1', 'Imported Name')],
    sprints: [],
    tasks: [],
  };
  const result = mergeWorkspaceSnapshots(current, incoming);
  assertEqual(result.added.workCycles, 0);
  assertEqual(result.snapshot.workCycles.length, 1);
  assertEqual(result.snapshot.workCycles[0]?.name, 'Original Name');
  assertEqual(result.snapshot.settings.defaultStatuses.length, 2);
});

// 4) Empty workspace: everything in the import is added.
check('empty workspace adds everything', () => {
  const current: WorkspaceSnapshot = {
    settings: settings(),
    workCycles: [],
    sprints: [],
    tasks: [],
  };
  const incoming: WorkspaceSnapshot = {
    settings: settings(['To Do']),
    workCycles: [cycle('c1')],
    sprints: [sprint('s1', 'c1')],
    tasks: [task('t1', 'c1', 's1')],
  };
  const result = mergeWorkspaceSnapshots(current, incoming);
  assertDeepEqual(result.added, { workCycles: 1, sprints: 1, tasks: 1 });
});

// 5) Nothing new: counts are zero and existing data is untouched (settings still overridden).
check('no new items leaves data unchanged (settings overridden)', () => {
  const current: WorkspaceSnapshot = {
    settings: settings(['To Do']),
    workCycles: [cycle('c1')],
    sprints: [sprint('s1', 'c1')],
    tasks: [task('t1', 'c1', 's1')],
  };
  const incoming: WorkspaceSnapshot = {
    settings: settings(['To Do', 'Done']),
    workCycles: [cycle('c1')],
    sprints: [sprint('s1', 'c1')],
    tasks: [task('t1', 'c1', 's1')],
  };
  const result = mergeWorkspaceSnapshots(current, incoming);
  assertDeepEqual(result.added, { workCycles: 0, sprints: 0, tasks: 0 });
  assertEqual(result.snapshot.workCycles.length, 1);
});

console.log(`\nAll ${passed} merge test(s) passed.`);
