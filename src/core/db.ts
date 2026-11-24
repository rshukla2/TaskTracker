import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { mergeWorkspaceSnapshots, type MergeBackupResult } from './merge';
import { isValidLocalDate } from './dates';
import { createId } from './scheduling';
import {
  type AppSettings,
  type BackupPayloadV1,
  type BackupValidationResult,
  EffortLevel,
  type Sprint,
  type Task,
  type WorkCycle,
  type WorkspaceSnapshot,
  type WorkflowStatus,
} from './types';

export type { MergeBackupResult } from './merge';

const NATIVE_WORKSPACE_FILE = 'task-tracker-workspace.json';

function isNativeApp(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

const DB_NAME = 'task_tracker_db';
const DB_VERSION = 1;

const STORE_SETTINGS = 'settings';
const STORE_WORK_CYCLES = 'workCycles';
const STORE_SPRINTS = 'sprints';
const STORE_TASKS = 'tasks';

export function createDefaultSettings(): AppSettings {
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

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser environment.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_WORK_CYCLES)) {
        db.createObjectStore(STORE_WORK_CYCLES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SPRINTS)) {
        const sprintStore = db.createObjectStore(STORE_SPRINTS, { keyPath: 'id' });
        sprintStore.createIndex('workCycleId', 'workCycleId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        const taskStore = db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
        taskStore.createIndex('sprintId', 'sprintId', { unique: false });
        taskStore.createIndex('workCycleId', 'workCycleId', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB database.'));
    };
  });

  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

let nativeCache: WorkspaceSnapshot | null = null;
let nativeWriteChain: Promise<void> = Promise.resolve();

function applyCompletedMigration(settings: AppSettings): {
  settings: AppSettings;
  changed: boolean;
} {
  if (settings.completedStatusMigrated) {
    return { settings, changed: false };
  }
  const hasCompleted = settings.defaultStatuses.some(
    (s) => s.id === 'status-completed' || s.name.trim().toLowerCase() === 'completed'
  );
  return {
    changed: true,
    settings: {
      ...settings,
      defaultStatuses: hasCompleted
        ? settings.defaultStatuses
        : [...settings.defaultStatuses, { id: 'status-completed', name: 'Completed' }],
      completedStatusMigrated: true,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function flushNativeWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  nativeCache = snapshot;
  const serialized = JSON.stringify(snapshot);
  nativeWriteChain = nativeWriteChain.then(() =>
    Filesystem.writeFile({
      path: NATIVE_WORKSPACE_FILE,
      data: serialized,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    }).then(() => undefined)
  );
  await nativeWriteChain;
}

export async function replaceWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  if (isNativeApp()) {
    await flushNativeWorkspace(snapshot);
    return;
  }

  const db = await openDatabase();
  const tx = db.transaction(
    [STORE_SETTINGS, STORE_WORK_CYCLES, STORE_SPRINTS, STORE_TASKS],
    'readwrite'
  );

  // Clear all stores and re-insert all items
  tx.objectStore(STORE_SETTINGS).clear();
  tx.objectStore(STORE_WORK_CYCLES).clear();
  tx.objectStore(STORE_SPRINTS).clear();
  tx.objectStore(STORE_TASKS).clear();

  // Put all items
  tx.objectStore(STORE_SETTINGS).put(snapshot.settings);
  for (const cycle of snapshot.workCycles) {
    tx.objectStore(STORE_WORK_CYCLES).put(cycle);
  }
  for (const sprint of snapshot.sprints) {
    tx.objectStore(STORE_SPRINTS).put(sprint);
  }
  for (const task of snapshot.tasks) {
    tx.objectStore(STORE_TASKS).put(task);
  }

  await transactionDone(tx);
}

async function ensureNativeCache(): Promise<WorkspaceSnapshot> {
  if (nativeCache) return nativeCache;
  try {
    const res = await Filesystem.readFile({
      path: NATIVE_WORKSPACE_FILE,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(String(res.data)) as Partial<WorkspaceSnapshot>;
    let settings = parsed.settings ?? createDefaultSettings();
    const migrated = applyCompletedMigration(settings);
    settings = migrated.settings;

    const snapshot: WorkspaceSnapshot = {
      settings,
      workCycles: Array.isArray(parsed.workCycles) ? parsed.workCycles : [],
      sprints: Array.isArray(parsed.sprints) ? parsed.sprints : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
    nativeCache = snapshot;
    if (migrated.changed) {
      await flushNativeWorkspace(snapshot);
    }
    return snapshot;
  } catch {
    const initial: WorkspaceSnapshot = {
      settings: createDefaultSettings(),
      workCycles: [],
      sprints: [],
      tasks: [],
    };
    await flushNativeWorkspace(initial);
    return initial;
  }
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (isNativeApp()) {
    return ensureNativeCache();
  }

  const db = await openDatabase();
  const tx = db.transaction(
    [STORE_SETTINGS, STORE_WORK_CYCLES, STORE_SPRINTS, STORE_TASKS],
    'readonly'
  );

  const [storedSettings, workCycles, sprints, tasks] = await Promise.all([
    requestToPromise(tx.objectStore(STORE_SETTINGS).get('app_settings')) as Promise<
      AppSettings | undefined
    >,
    requestToPromise(tx.objectStore(STORE_WORK_CYCLES).getAll()) as Promise<WorkCycle[]>,
    requestToPromise(tx.objectStore(STORE_SPRINTS).getAll()) as Promise<Sprint[]>,
    requestToPromise(tx.objectStore(STORE_TASKS).getAll()) as Promise<Task[]>,
  ]);

  await transactionDone(tx);

  let settings = storedSettings;
  if (!settings) {
    settings = createDefaultSettings();
    await saveSettings(settings);
  } else {
    const migrated = applyCompletedMigration(settings);
    if (migrated.changed) {
      settings = migrated.settings;
      await saveSettings(settings);
    }
  }

  return {
    settings,
    workCycles,
    sprints,
    tasks,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    await flushNativeWorkspace({ ...current, settings });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_SETTINGS], 'readwrite');
  tx.objectStore(STORE_SETTINGS).put(settings);
  await transactionDone(tx);
}

export async function createWorkCycleWithSprints(
  cycle: WorkCycle,
  sprints: Sprint[]
): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    await flushNativeWorkspace({
      ...current,
      workCycles: [...current.workCycles.filter((c) => c.id !== cycle.id), cycle],
      sprints: [
        ...current.sprints.filter((s) => !sprints.some((ns) => ns.id === s.id)),
        ...sprints,
      ],
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_WORK_CYCLES, STORE_SPRINTS], 'readwrite');
  tx.objectStore(STORE_WORK_CYCLES).put(cycle);
  const sprintStore = tx.objectStore(STORE_SPRINTS);
  for (const sprint of sprints) {
    sprintStore.put(sprint);
  }
  await transactionDone(tx);
}

export async function saveWorkCycle(cycle: WorkCycle): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    await flushNativeWorkspace({
      ...current,
      workCycles: [...current.workCycles.filter((c) => c.id !== cycle.id), cycle],
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_WORK_CYCLES], 'readwrite');
  tx.objectStore(STORE_WORK_CYCLES).put(cycle);
  await transactionDone(tx);
}

export async function deleteWorkCycleCascade(cycleId: string): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    await flushNativeWorkspace({
      ...current,
      workCycles: current.workCycles.filter((c) => c.id !== cycleId),
      sprints: current.sprints.filter((s) => s.workCycleId !== cycleId),
      tasks: current.tasks.filter((t) => t.workCycleId !== cycleId),
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_WORK_CYCLES, STORE_SPRINTS, STORE_TASKS], 'readwrite');
  tx.objectStore(STORE_WORK_CYCLES).delete(cycleId);

  const sprintStore = tx.objectStore(STORE_SPRINTS);
  const sprintIndex = sprintStore.index('workCycleId');
  const sprintKeys = await requestToPromise(sprintIndex.getAllKeys(cycleId));
  for (const key of sprintKeys) {
    sprintStore.delete(key);
  }

  const taskStore = tx.objectStore(STORE_TASKS);
  const taskIndex = taskStore.index('workCycleId');
  const taskKeys = await requestToPromise(taskIndex.getAllKeys(cycleId));
  for (const key of taskKeys) {
    taskStore.delete(key);
  }

  await transactionDone(tx);
}

export async function saveSprintsBatch(sprints: Sprint[]): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    const map = new Map(current.sprints.map((s) => [s.id, s]));
    for (const s of sprints) map.set(s.id, s);
    await flushNativeWorkspace({ ...current, sprints: Array.from(map.values()) });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_SPRINTS], 'readwrite');
  const store = tx.objectStore(STORE_SPRINTS);
  for (const sprint of sprints) {
    store.put(sprint);
  }
  await transactionDone(tx);
}

export async function commitSprintEdit(
  updatedSprints: Sprint[],
  updatedCycle?: WorkCycle
): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    const sprintMap = new Map(current.sprints.map((s) => [s.id, s]));
    for (const s of updatedSprints) sprintMap.set(s.id, s);
    const workCycles = updatedCycle
      ? current.workCycles.map((c) => (c.id === updatedCycle.id ? updatedCycle : c))
      : current.workCycles;
    await flushNativeWorkspace({
      ...current,
      sprints: Array.from(sprintMap.values()),
      workCycles,
    });
    return;
  }
  const db = await openDatabase();
  const stores = updatedCycle ? [STORE_SPRINTS, STORE_WORK_CYCLES] : [STORE_SPRINTS];
  const tx = db.transaction(stores, 'readwrite');
  const sprintStore = tx.objectStore(STORE_SPRINTS);
  for (const s of updatedSprints) {
    sprintStore.put(s);
  }
  if (updatedCycle) {
    tx.objectStore(STORE_WORK_CYCLES).put(updatedCycle);
  }
  await transactionDone(tx);
}

export async function commitSprintMerge(
  keptSprints: Sprint[],
  deletedSprintId: string,
  updatedTasks: Task[]
): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    const keptMap = new Map(keptSprints.map((s) => [s.id, s]));
    const taskMap = new Map(updatedTasks.map((t) => [t.id, t]));
    await flushNativeWorkspace({
      ...current,
      sprints: current.sprints
        .filter((s) => s.id !== deletedSprintId)
        .map((s) => keptMap.get(s.id) ?? s),
      tasks: current.tasks.map((t) => taskMap.get(t.id) ?? t),
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_SPRINTS, STORE_TASKS], 'readwrite');
  const sprintStore = tx.objectStore(STORE_SPRINTS);
  for (const s of keptSprints) {
    sprintStore.put(s);
  }
  sprintStore.delete(deletedSprintId);

  const taskStore = tx.objectStore(STORE_TASKS);
  for (const t of updatedTasks) {
    taskStore.put(t);
  }
  await transactionDone(tx);
}

export async function saveTask(task: Task): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    await flushNativeWorkspace({
      ...current,
      tasks: [...current.tasks.filter((t) => t.id !== task.id), task],
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_TASKS], 'readwrite');
  tx.objectStore(STORE_TASKS).put(task);
  await transactionDone(tx);
}

export async function saveTasksBatch(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    const map = new Map(current.tasks.map((t) => [t.id, t]));
    for (const t of tasks) map.set(t.id, t);
    await flushNativeWorkspace({ ...current, tasks: Array.from(map.values()) });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_TASKS], 'readwrite');
  const store = tx.objectStore(STORE_TASKS);
  for (const t of tasks) {
    store.put(t);
  }
  await transactionDone(tx);
}

export async function deleteTask(taskId: string): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    await flushNativeWorkspace({
      ...current,
      tasks: current.tasks.filter((t) => t.id !== taskId),
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_TASKS], 'readwrite');
  tx.objectStore(STORE_TASKS).delete(taskId);
  await transactionDone(tx);
}

export async function commitSettingsAndTaskUpdates(
  settings: AppSettings,
  updatedTasks: Task[]
): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    const taskMap = new Map(updatedTasks.map((t) => [t.id, t]));
    await flushNativeWorkspace({
      ...current,
      settings,
      tasks: current.tasks.map((t) => taskMap.get(t.id) ?? t),
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_SETTINGS, STORE_TASKS], 'readwrite');
  tx.objectStore(STORE_SETTINGS).put(settings);
  const taskStore = tx.objectStore(STORE_TASKS);
  for (const t of updatedTasks) {
    taskStore.put(t);
  }
  await transactionDone(tx);
}

export async function commitCycleStatusAndTaskUpdates(
  cycle: WorkCycle,
  updatedTasks: Task[]
): Promise<void> {
  if (isNativeApp()) {
    const current = await ensureNativeCache();
    const taskMap = new Map(updatedTasks.map((t) => [t.id, t]));
    await flushNativeWorkspace({
      ...current,
      workCycles: current.workCycles.map((c) => (c.id === cycle.id ? cycle : c)),
      tasks: current.tasks.map((t) => taskMap.get(t.id) ?? t),
    });
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction([STORE_WORK_CYCLES, STORE_TASKS], 'readwrite');
  tx.objectStore(STORE_WORK_CYCLES).put(cycle);
  const taskStore = tx.objectStore(STORE_TASKS);
  for (const t of updatedTasks) {
    taskStore.put(t);
  }
  await transactionDone(tx);
}

export function buildBackupPayload(snapshot: WorkspaceSnapshot): BackupPayloadV1 {
  return {
    app: 'task-tracker',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      settings: snapshot.settings,
      workCycles: snapshot.workCycles,
      sprints: snapshot.sprints,
      tasks: snapshot.tasks,
    },
  };
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function validateStatusArray(arr: unknown, label: string, errors: string[]): WorkflowStatus[] {
  if (!Array.isArray(arr)) {
    errors.push(`${label} must be an array.`);
    return [];
  }
  const seenIds = new Set<string>();
  const valid: WorkflowStatus[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id.trim()) {
      errors.push(`${label}[${i}] is missing a valid id.`);
      continue;
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      errors.push(`${label}[${i}] is missing a valid name.`);
      continue;
    }
    if (seenIds.has(item.id)) {
      errors.push(`${label} contains duplicate status id "${item.id}".`);
      continue;
    }
    seenIds.add(item.id);
    valid.push({ id: item.id, name: item.name.trim() });
  }
  return valid;
}

export function validateBackupJson(rawText: string): BackupValidationResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { valid: false, errors: ['File is not valid JSON.'] };
  }

  if (!isPlainObject(parsed)) {
    return { valid: false, errors: ['Backup root must be a JSON object.'] };
  }

  if (parsed.app !== 'task-tracker') {
    errors.push('Invalid backup identifier (expected app: "task-tracker").');
  }
  if (parsed.schemaVersion !== 1) {
    errors.push(`Unsupported schemaVersion: ${String(parsed.schemaVersion)}. Expected 1.`);
  }
  if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt) {
    errors.push('Missing exportedAt timestamp.');
  }

  if (!isPlainObject(parsed.data)) {
    errors.push('Missing "data" object.');
    return { valid: false, errors };
  }

  const data = parsed.data;

  // Validate settings
  let validSettings: AppSettings | null = null;
  if (!isPlainObject(data.settings)) {
    errors.push('Missing "data.settings" object.');
  } else {
    const statuses = validateStatusArray(
      data.settings.defaultStatuses,
      'settings.defaultStatuses',
      errors
    );
    validSettings = {
      id: 'app_settings',
      defaultStatuses: statuses,
      completedStatusMigrated:
        typeof data.settings.completedStatusMigrated === 'boolean'
          ? data.settings.completedStatusMigrated
          : true,
      updatedAt:
        typeof data.settings.updatedAt === 'string'
          ? data.settings.updatedAt
          : new Date().toISOString(),
    };
  }

  // Validate workCycles
  const workCycles: WorkCycle[] = [];
  const cycleIds = new Set<string>();
  if (!Array.isArray(data.workCycles)) {
    errors.push('"data.workCycles" must be an array.');
  } else {
    for (let i = 0; i < data.workCycles.length; i++) {
      const c = data.workCycles[i];
      if (!isPlainObject(c)) {
        errors.push(`workCycles[${i}] must be an object.`);
        continue;
      }
      if (typeof c.id !== 'string' || !c.id.trim()) {
        errors.push(`workCycles[${i}] is missing a valid id.`);
        continue;
      }
      if (cycleIds.has(c.id)) {
        errors.push(`Duplicate workCycle id "${c.id}".`);
        continue;
      }
      if (typeof c.name !== 'string' || !c.name.trim()) {
        errors.push(`workCycles[${i}] is missing a valid name.`);
      }
      if (!isValidLocalDate(c.startDate) || !isValidLocalDate(c.endDate)) {
        errors.push(`workCycles[${i}] ("${String(c.name)}") has invalid startDate or endDate.`);
      } else if (c.endDate < c.startDate) {
        errors.push(`workCycles[${i}] ("${String(c.name)}") ends before its startDate.`);
      }
      if (typeof c.sprintLengthDays !== 'number' || !Number.isFinite(c.sprintLengthDays) || c.sprintLengthDays < 1) {
        errors.push(`workCycles[${i}] has invalid sprintLengthDays.`);
      }

      const customStatuses =
        c.customStatuses !== undefined
          ? validateStatusArray(c.customStatuses, `workCycles[${i}].customStatuses`, errors)
          : [];

      cycleIds.add(c.id);
      workCycles.push({
        id: c.id,
        name: typeof c.name === 'string' ? c.name.trim() : '',
        description: typeof c.description === 'string' ? c.description : '',
        endGoal: typeof c.endGoal === 'string' ? c.endGoal : '',
        startDate: String(c.startDate),
        endDate: String(c.endDate),
        sprintLengthDays: Math.floor(Number(c.sprintLengthDays) || 1),
        useCustomStatuses: Boolean(c.useCustomStatuses),
        customStatuses,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : new Date().toISOString(),
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date().toISOString(),
      });
    }
  }

  // Validate sprints
  const sprints: Sprint[] = [];
  const sprintCycleMap = new Map<string, string>();
  if (!Array.isArray(data.sprints)) {
    errors.push('"data.sprints" must be an array.');
  } else {
    for (let i = 0; i < data.sprints.length; i++) {
      const s = data.sprints[i];
      if (!isPlainObject(s)) {
        errors.push(`sprints[${i}] must be an object.`);
        continue;
      }
      if (typeof s.id !== 'string' || !s.id.trim()) {
        errors.push(`sprints[${i}] is missing a valid id.`);
        continue;
      }
      if (sprintCycleMap.has(s.id)) {
        errors.push(`Duplicate sprint id "${s.id}".`);
        continue;
      }
      if (typeof s.workCycleId !== 'string' || !cycleIds.has(s.workCycleId)) {
        errors.push(`sprints[${i}] references missing workCycleId "${String(s.workCycleId)}".`);
      }
      if (typeof s.name !== 'string' || !s.name.trim()) {
        errors.push(`sprints[${i}] is missing a valid name.`);
      }
      if (!isValidLocalDate(s.startDate) || !isValidLocalDate(s.endDate)) {
        errors.push(`sprints[${i}] ("${String(s.name)}") has invalid dates.`);
      } else if (s.endDate < s.startDate) {
        errors.push(`sprints[${i}] ("${String(s.name)}") ends before its startDate.`);
      }

      sprintCycleMap.set(s.id, String(s.workCycleId));
      sprints.push({
        id: s.id,
        workCycleId: String(s.workCycleId),
        name: typeof s.name === 'string' ? s.name.trim() : '',
        endGoal: typeof s.endGoal === 'string' ? s.endGoal : '',
        startDate: String(s.startDate),
        endDate: String(s.endDate),
        order: typeof s.order === 'number' && Number.isFinite(s.order) ? s.order : i,
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
        updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date().toISOString(),
      });
    }
  }

  // Validate tasks
  const tasks: Task[] = [];
  const taskIds = new Set<string>();
  const validEfforts = new Set<string>([EffortLevel.Low, EffortLevel.Medium, EffortLevel.High]);
  if (!Array.isArray(data.tasks)) {
    errors.push('"data.tasks" must be an array.');
  } else {
    for (let i = 0; i < data.tasks.length; i++) {
      const t = data.tasks[i];
      if (!isPlainObject(t)) {
        errors.push(`tasks[${i}] must be an object.`);
        continue;
      }
      if (typeof t.id !== 'string' || !t.id.trim()) {
        errors.push(`tasks[${i}] is missing a valid id.`);
        continue;
      }
      if (taskIds.has(t.id)) {
        errors.push(`Duplicate task id "${t.id}".`);
        continue;
      }
      if (typeof t.sprintId !== 'string' || !sprintCycleMap.has(t.sprintId)) {
        errors.push(`tasks[${i}] references missing sprintId "${String(t.sprintId)}".`);
      } else if (t.workCycleId !== sprintCycleMap.get(t.sprintId)) {
        errors.push(`tasks[${i}] workCycleId does not match its sprint's workCycleId.`);
      }
      if (typeof t.title !== 'string' || !t.title.trim()) {
        errors.push(`tasks[${i}] is missing a valid title.`);
      }
      if (typeof t.completed !== 'boolean') {
        errors.push(`tasks[${i}] must have a boolean "completed" field.`);
      }
      if (t.deadline !== null && t.deadline !== undefined && !isValidLocalDate(t.deadline)) {
        errors.push(`tasks[${i}] has invalid deadline "${String(t.deadline)}".`);
      }
      if (
        t.estimatedHours !== null &&
        t.estimatedHours !== undefined &&
        (typeof t.estimatedHours !== 'number' || !Number.isFinite(t.estimatedHours) || t.estimatedHours < 0)
      ) {
        errors.push(`tasks[${i}] has invalid estimatedHours.`);
      }
      if (
        t.effort !== null &&
        t.effort !== undefined &&
        (typeof t.effort !== 'string' || !validEfforts.has(t.effort))
      ) {
        errors.push(`tasks[${i}] has invalid effort "${String(t.effort)}".`);
      }

      taskIds.add(t.id);
      tasks.push({
        id: t.id,
        workCycleId: String(t.workCycleId),
        sprintId: String(t.sprintId),
        title: typeof t.title === 'string' ? t.title.trim() : '',
        description: typeof t.description === 'string' ? t.description : '',
        deadline: typeof t.deadline === 'string' ? t.deadline : null,
        estimatedHours:
          typeof t.estimatedHours === 'number' && Number.isFinite(t.estimatedHours)
            ? t.estimatedHours
            : null,
        effort:
          typeof t.effort === 'string' && validEfforts.has(t.effort)
            ? (t.effort as EffortLevel)
            : null,
        statusId: typeof t.statusId === 'string' ? t.statusId : null,
        previousStatusId:
          typeof t.previousStatusId === 'string' ? t.previousStatusId : null,
        blockerReason: typeof t.blockerReason === 'string' ? t.blockerReason : '',
        completed: Boolean(t.completed),
        completedAt: typeof t.completedAt === 'string' ? t.completedAt : null,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : new Date().toISOString(),
      });
    }
  }

  if (errors.length > 0 || !validSettings) {
    return { valid: false, errors: errors.slice(0, 10) };
  }

  const payload: BackupPayloadV1 = {
    app: 'task-tracker',
    schemaVersion: 1,
    exportedAt: String(parsed.exportedAt),
    data: {
      settings: validSettings,
      workCycles,
      sprints,
      tasks,
    },
  };

  return {
    valid: true,
    errors: [],
    payload,
    summary: {
      workCyclesCount: workCycles.length,
      sprintsCount: sprints.length,
      tasksCount: tasks.length,
      statusesCount: validSettings.defaultStatuses.length,
      exportedAt: payload.exportedAt,
    },
  };
}

/**
 * Import a backup by MERGING it into the current workspace rather than
 * replacing it.
 *
 * - The main app **settings** are overridden by the imported settings.
 * - Work cycles, sprints, and tasks are **added by id**: items that already
 *   exist locally are left untouched (existing data is never changed or
 *   removed), and items with a new id are appended.
 *
 * Returns the merged snapshot plus a count of how many new items were added,
 * so the UI can tell the user exactly what changed.
 */
export async function mergeWorkspaceFromBackup(
  payload: BackupPayloadV1
): Promise<MergeBackupResult> {
  const current = await loadWorkspace();

  const result = mergeWorkspaceSnapshots(current, {
    settings: payload.data.settings,
    workCycles: payload.data.workCycles,
    sprints: payload.data.sprints,
    tasks: payload.data.tasks,
  });
  const merged = result.snapshot;

  if (isNativeApp()) {
    await flushNativeWorkspace(merged);
    return result;
  }

  const db = await openDatabase();
  const tx = db.transaction(
    [STORE_SETTINGS, STORE_WORK_CYCLES, STORE_SPRINTS, STORE_TASKS],
    'readwrite'
  );

  const settingsStore = tx.objectStore(STORE_SETTINGS);
  const cycleStore = tx.objectStore(STORE_WORK_CYCLES);
  const sprintStore = tx.objectStore(STORE_SPRINTS);
  const taskStore = tx.objectStore(STORE_TASKS);

  // No clears: we keep every existing record and upsert the merged set, so
  // existing cycles/sprints/tasks are preserved and only new ids are added.
  // Only the settings record is overwritten (it has the fixed key 'app_settings').
  settingsStore.put(merged.settings);
  for (const cycle of merged.workCycles) {
    cycleStore.put(cycle);
  }
  for (const sprint of merged.sprints) {
    sprintStore.put(sprint);
  }
  for (const task of merged.tasks) {
    taskStore.put(task);
  }

  await transactionDone(tx);

  return result;
}

export function createNewStatus(name: string): WorkflowStatus {
  return {
    id: `status-${createId()}`,
    name: name.trim(),
  };
}
