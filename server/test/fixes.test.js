import { test } from 'node:test';
import assert from 'node:assert';

// Test 1: seq keeps increasing after DELETE /api/sync/all
test('seq keeps increasing after DELETE /api/sync/all', { timeout: 10000 }, async () => {
  const { app, db, server, port } = createTestServer();
  const baseUrl = `http://localhost:${port}`;
  const syncKey = 'test-secret-key-12345';

  try {
    // Push initial data
    const push1 = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'settings',
          id: 'settings-1',
          data: {},
          updatedAt: new Date().toISOString(),
          deleted: 0,
        }],
      }),
    });
    const push1Data = await push1.json();
    const seqAfterPush1 = push1Data.seq;

    // Delete all
    const deleteAll = await makeRequest(`${baseUrl}/api/sync/all`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    assert.strictEqual(deleteAll.status, 200);

    // Push again
    const push2 = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'settings',
          id: 'settings-1',
          data: {},
          updatedAt: new Date().toISOString(),
          deleted: 0,
        }],
      }),
    });
    const push2Data = await push2.json();
    const seqAfterPush2 = push2Data.seq;

    // Seq should be greater after push2
    assert.ok(seqAfterPush2 > seqAfterPush1, `Seq ${seqAfterPush2} should be greater than ${seqAfterPush1}`);
  } finally {
    server.close();
    db.close();
  }
});

// Test 2: push with deleted:true on a workCycle tombstones its sprints and tasks
test('push with deleted:true on workCycle tombstones its sprints and tasks', { timeout: 10000 }, async () => {
  const { app, db, server, port } = createTestServer();
  const baseUrl = `http://localhost:${port}`;
  const syncKey = 'test-secret-key-12345';

  try {
    const now = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';
    const taskId = 'task-1';

    // Create a work cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: { id: cycleId, name: 'Cycle 1', useCustomStatuses: false },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a sprint for the cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'sprint',
          id: sprintId,
          data: { id: sprintId, name: 'Sprint 1', workCycleId: cycleId },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a task for the sprint
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'task',
          id: taskId,
          data: { id: taskId, title: 'Task 1', sprintId, workCycleId: cycleId },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Verify entities exist before delete
    const beforePull = await makeRequest(`${baseUrl}/api/sync/pull?since=0`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const beforeData = await beforePull.json();
    const beforeCount = beforeData.changes.filter(c => c.kind === 'task' && c.id === taskId).length;
    assert.strictEqual(beforeCount, 1, 'Task should exist before deletion');

    // Delete the work cycle (should tombstone sprints and tasks)
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: { id: cycleId, name: 'Cycle 1', useCustomStatuses: false },
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          deleted: true,
        }],
      }),
    });

    // Pull and check that sprints and tasks are tombstoned (deleted: 1)
    const afterPull = await makeRequest(`${baseUrl}/api/sync/pull?since=0`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const afterData = await afterPull.json();
    const taskEntity = afterData.changes.find(c => c.kind === 'task' && c.id === taskId);
    assert.ok(taskEntity, 'Task should be in pull response');
    assert.strictEqual(taskEntity.deleted, 1, 'Task should be tombstoned');
  } finally {
    server.close();
    db.close();
  }
});

// Test 3: POST /api/tasks with status 'In Progress' returns 201 with statusName and workCycleName
test('POST /api/tasks with status In Progress returns 201 with statusName and workCycleName', { timeout: 10000 }, async () => {
  const { app, db, server, port } = createTestServer();
  const baseUrl = `http://localhost:${port}`;
  const syncKey = 'test-secret-key-12345';

  try {
    const now = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';

    // Create a work cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: { id: cycleId, name: 'Cycle 1', useCustomStatuses: false },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a sprint for the cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'sprint',
          id: sprintId,
          data: { id: sprintId, name: 'Sprint 1', workCycleId: cycleId },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a task with status 'In Progress'
    const createTask = await makeRequest(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Test Task',
        sprintId,
        status: 'In Progress',
      }),
    });

    assert.strictEqual(createTask.status, 201, 'Should return 201');
    const taskData = await createTask.json();
    assert.strictEqual(taskData.statusName, 'In Progress', `statusName should be 'In Progress', got ${taskData.statusName}`);
    assert.strictEqual(taskData.workCycleName, 'Cycle 1', `workCycleName should be 'Cycle 1', got ${taskData.workCycleName}`);
  } finally {
    server.close();
    db.close();
  }
});

// Test 4: GET /api/changes?since=<ISO> returns 200 with the changed task
test('GET /api/changes?since=<ISO> returns 200 with the changed task', { timeout: 10000 }, async () => {
  const { app, db, server, port } = createTestServer();
  const baseUrl = `http://localhost:${port}`;
  const syncKey = 'test-secret-key-12345';

  try {
    const now = new Date();
    const sinceTime = new Date(now.getTime() - 1000).toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';

    // Create a work cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: { id: cycleId, name: 'Cycle 1', useCustomStatuses: false },
          updatedAt: now.toISOString(),
          deleted: 0,
        }],
      }),
    });

    // Create a sprint for the cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'sprint',
          id: sprintId,
          data: { id: sprintId, name: 'Sprint 1', workCycleId: cycleId },
          updatedAt: now.toISOString(),
          deleted: 0,
        }],
      }),
    });

    // Create a task after the since time
    const taskTime = new Date(now.getTime() + 1000).toISOString();
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'task',
          id: 'task-1',
          data: { id: 'task-1', title: 'Test Task', sprintId, workCycleId: cycleId },
          updatedAt: taskTime,
          deleted: 0,
        }],
      }),
    });

    // Get changes since the earlier time
    const changes = await makeRequest(`${baseUrl}/api/changes?since=${sinceTime}`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });

    assert.strictEqual(changes.status, 200, 'Should return 200');
    const changesData = await changes.json();
    const changedTask = changesData.changes.find(c => c.kind === 'task' && c.id === 'task-1');
    assert.ok(changedTask, 'Should return the changed task');
  } finally {
    server.close();
    db.close();
  }
});

// Test 5: PATCH {completed:true} then {completed:false} restores previous statusId and clears completedAt
test('PATCH {completed:true} then {completed:false} restores previous statusId and clears completedAt', { timeout: 10000 }, async () => {
  const { app, db, server, port } = createTestServer();
  const baseUrl = `http://localhost:${port}`;
  const syncKey = 'test-secret-key-12345';

  try {
    const now = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';

    // Create a work cycle with default statuses
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: { id: cycleId, name: 'Cycle 1', useCustomStatuses: false },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a sprint for the cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'sprint',
          id: sprintId,
          data: { id: sprintId, name: 'Sprint 1', workCycleId: cycleId },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a task with default status (To Do)
    const createTask = await makeRequest(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Test Task',
        sprintId,
      }),
    });
    const taskData = await createTask.json();
    const initialStatusId = taskData.statusId;

    // Mark as completed
    const patchCompleted = await makeRequest(`${baseUrl}/api/tasks/${taskData.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ completed: true }),
    });
    const completedData = await patchCompleted.json();
    assert.ok(completedData.completed, 'Task should be completed');
    assert.strictEqual(completedData.statusId, 'status-completed', 'Status should be completed');

    // Mark as not completed
    const patchNotCompleted = await makeRequest(`${baseUrl}/api/tasks/${taskData.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ completed: false }),
    });
    const notCompletedData = await patchNotCompleted.json();
    assert.ok(!notCompletedData.completed, 'Task should not be completed');
    assert.strictEqual(notCompletedData.statusId, initialStatusId, `Status should be restored to ${initialStatusId}`);
    assert.strictEqual(notCompletedData.completedAt, null, 'completedAt should be null');
    assert.strictEqual(notCompletedData.previousStatusId, null, 'previousStatusId should be null');
  } finally {
    server.close();
    db.close();
  }
});

// Test 6: in a work cycle with useCustomStatuses true, PATCH status does not change completed
test('in custom status cycle, PATCH status does not change completed', { timeout: 10000 }, async () => {
  const { app, db, server, port } = createTestServer();
  const baseUrl = `http://localhost:${port}`;
  const syncKey = 'test-secret-key-12345';

  try {
    const now = new Date().toISOString();
    const cycleId = 'cycle-custom';
    const sprintId = 'sprint-custom';

    // Create a work cycle with custom statuses
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: {
            id: cycleId,
            name: 'Custom Cycle',
            useCustomStatuses: true,
            customStatuses: [
              { id: 'custom-todo', name: 'To Do' },
              { id: 'custom-in-progress', name: 'In Progress' },
              { id: 'custom-done', name: 'Done' },
            ],
          },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a sprint for the cycle
    await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'sprint',
          id: sprintId,
          data: { id: sprintId, name: 'Custom Sprint', workCycleId: cycleId },
          updatedAt: now,
          deleted: 0,
        }],
      }),
    });

    // Create a task (will have completed: false by default)
    const createTask = await makeRequest(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Test Task',
        sprintId,
      }),
    });
    const taskData = await createTask.json();
    assert.strictEqual(taskData.completed, false, 'Task should start as not completed');

    // Patch to mark as completed
    const patchCompleted = await makeRequest(`${baseUrl}/api/tasks/${taskData.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ completed: true }),
    });
    const completedData = await patchCompleted.json();
    assert.ok(completedData.completed, 'Task should be completed after patch');

    // Patch to a different custom status - completed should NOT change
    const patchStatus = await makeRequest(`${baseUrl}/api/tasks/${taskData.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'In Progress' }),
    });
    const statusData = await patchStatus.json();
    assert.ok(statusData.completed, 'Task should still be completed after status change');

    // Patch to 'Done' status (the 'completed' status in custom list)
    const patchDone = await makeRequest(`${baseUrl}/api/tasks/${taskData.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'Done' }),
    });
    const doneData = await patchDone.json();
    assert.ok(doneData.completed, 'Task should still be completed');
  } finally {
    server.close();
    db.close();
  }
});

// ========== Test Server Helper Functions ==========
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import crypto from 'crypto';

function createTestServer() {
  const dbPath = `/tmp/tasksync-fixes-${Date.now()}.db`;
  process.env.DB_PATH = dbPath;
  process.env.PORT = '8788';
  process.env.SYNC_KEY = 'test-secret-key-12345';

  const app = express();
  const testDb = new Database(dbPath);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value INTEGER
    );

    CREATE TABLE IF NOT EXISTS entities (
      kind TEXT,
      id TEXT,
      data TEXT,
      updatedAt TEXT,
      deleted INTEGER DEFAULT 0,
      seq INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_entities_seq ON entities(seq);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_kind_id ON entities(kind, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_seq_unique ON entities(seq);
  `);

  // Initialize meta table
  testDb.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(['seq', 0]);

  const allowedOrigins = [
    'https://rshukla2.github.io',
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:3000',
  ];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));

  app.use(express.json());

  const SYNC_KEY = 'test-secret-key-12345';
  const SYNC_KEY_HASH = crypto.createHash('sha256').update(SYNC_KEY).digest();
  const UNAUTHORIZED_RESPONSE = { error: 'Unauthorized' };

  function authMiddleware(req, res, next) {
    if (req.path === '/health') {
      return next();
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(UNAUTHORIZED_RESPONSE);
    }
    const token = authHeader.substring(7);
    const tokenHash = crypto.createHash('sha256').update(token).digest();

    if (!crypto.timingSafeEqual(tokenHash, SYNC_KEY_HASH)) {
      return res.status(401).json(UNAUTHORIZED_RESPONSE);
    }
    next();
  }

  app.use(authMiddleware);

  // Helper functions from index.js
  function nextSeq() {
    const result = testDb.prepare(`
      INSERT INTO meta (key, value) VALUES ('seq', 0)
      ON CONFLICT(key) DO UPDATE SET value = value + 1
      RETURNING value
    `).get();
    return result.value;
  }

  function getCurrentSeq() {
    const result = testDb.prepare('SELECT value FROM meta WHERE key = ?').get(['seq']);
    return result?.value || 0;
  }

  function createId() {
    return crypto.randomUUID();
  }

  const defaultStatuses = [
    { id: 'status-todo', name: 'To Do' },
    { id: 'status-in-progress', name: 'In Progress' },
    { id: 'status-in-review', name: 'In Review' },
    { id: 'status-blocked', name: 'Blocked' },
    { id: 'status-completed', name: 'Completed' },
  ];

  function getTaskStatuses(task, settings) {
    const cycle = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', task.workCycleId]);
    if (!cycle) return defaultStatuses;
    const cycleData = JSON.parse(cycle.data);
    if (cycleData.useCustomStatuses && cycleData.customStatuses && cycleData.customStatuses.length > 0) {
      return cycleData.customStatuses;
    }
    return settings?.defaultStatuses || defaultStatuses;
  }

  function findCompletedStatus(statuses) {
    const byId = statuses.find(s => s.id === 'status-completed');
    if (byId) return byId;
    const byName = statuses.find(s => s.name.trim().toLowerCase() === 'completed');
    return byName ?? null;
  }

  function resolveStatus(statusInput, statuses) {
    if (!statusInput) return null;
    const found = statuses.find(s => s.id === statusInput || s.name.trim().toLowerCase() === statusInput.trim().toLowerCase());
    return found || null;
  }

  function isValidKind(kind) {
    return ['settings', 'workCycle', 'sprint', 'task'].includes(kind);
  }

  function isValidDate(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    return !isNaN(d.getTime());
  }

  function getSnapshot() {
    const stmt = testDb.prepare('SELECT kind, id, data, updatedAt, deleted, seq FROM entities WHERE deleted = 0 ORDER BY seq');
    const rows = stmt.all();
    return rows.map(r => ({
      kind: r.kind,
      id: r.id,
      data: JSON.parse(r.data),
      updatedAt: r.updatedAt,
      deleted: r.deleted,
      seq: r.seq,
    }));
  }

  // API: Push changes
  app.post('/api/sync/push', (req, res) => {
    const changes = req.body.changes || [];
    const applied = [];
    const skipped = [];
    const transaction = testDb.transaction(() => {
      let currentSeq = getCurrentSeq();
      for (const change of changes) {
        const { kind, id, data, updatedAt, deleted } = change;
        if (!isValidKind(kind)) {
          skipped.push({ kind, id, reason: 'Invalid kind' });
          continue;
        }
        if (!kind || !id || !updatedAt) {
          skipped.push({ kind, id, reason: 'Missing required fields' });
          continue;
        }
        if (!isValidDate(updatedAt)) {
          skipped.push({ kind, id, reason: 'Invalid updatedAt date' });
          continue;
        }
        const isDeleted = !!deleted;
        const existing = testDb.prepare('SELECT data, updatedAt, seq FROM entities WHERE kind = ? AND id = ?').get([kind, id]);
        if (existing) {
          if (new Date(updatedAt) > new Date(existing.updatedAt)) {
            currentSeq = nextSeq();
            testDb.prepare('UPDATE entities SET data = ?, updatedAt = ?, deleted = ?, seq = ? WHERE kind = ? AND id = ?')
              .run([JSON.stringify(data), updatedAt, isDeleted ? 1 : 0, currentSeq, kind, id]);
            applied.push({ kind, id, action: 'updated' });
            if (kind === 'workCycle' && isDeleted) {
              const nowIso = new Date(updatedAt).toISOString();
              const allSprints = testDb.prepare('SELECT id, seq, data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']);
              const allTasks = testDb.prepare('SELECT id, seq, data FROM entities WHERE kind = ? AND deleted = 0').all(['task']);
              for (const sprint of allSprints) {
                const sprintData = JSON.parse(sprint.data);
                if (sprintData.workCycleId === id) {
                  currentSeq = nextSeq();
                  testDb.prepare('UPDATE entities SET deleted = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
                    .run([1, nowIso, currentSeq, 'sprint', sprint.id]);
                  applied.push({ kind: 'sprint', id: sprint.id, action: 'tombstoned' });
                }
              }
              for (const task of allTasks) {
                const taskData = JSON.parse(task.data);
                if (taskData.workCycleId === id) {
                  currentSeq = nextSeq();
                  testDb.prepare('UPDATE entities SET deleted = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
                    .run([1, nowIso, currentSeq, 'task', task.id]);
                  applied.push({ kind: 'task', id: task.id, action: 'tombstoned' });
                }
              }
            }
          } else {
            skipped.push({ kind, id, reason: 'Stored version is newer or equal' });
          }
        } else {
          currentSeq = nextSeq();
          testDb.prepare('INSERT INTO entities (kind, id, data, updatedAt, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)')
            .run([kind, id, JSON.stringify(data), updatedAt, isDeleted ? 1 : 0, currentSeq]);
          applied.push({ kind, id, action: 'inserted' });
        }
      }
      return { applied, skipped, seq: currentSeq };
    });
    const result = transaction();
    res.json(result);
  });

  // API: Pull changes since seq
  app.get('/api/sync/pull', (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    const rows = testDb.prepare('SELECT kind, id, data, updatedAt, deleted, seq FROM entities WHERE seq > ? ORDER BY seq').all([since]);
    const changes = rows.map(r => ({
      kind: r.kind,
      id: r.id,
      data: JSON.parse(r.data),
      updatedAt: r.updatedAt,
      deleted: r.deleted,
      seq: r.seq,
    }));
    res.json({ changes, seq: getCurrentSeq() });
  });

  // API: Delete all data
  app.delete('/api/sync/all', (req, res) => {
    testDb.exec('DELETE FROM entities');
    res.json({ message: 'All data deleted' });
  });

  // API: Get tasks
  app.get('/api/tasks', (req, res) => {
    let tasks = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['task']).map(r => JSON.parse(r.data));
    const statusFilter = req.query.status;
    const workCycleIdFilter = req.query.workCycleId;
    const sprintIdFilter = req.query.sprintId;
    const completedFilter = req.query.completed;
    const dueBeforeFilter = req.query.due_before;

    const cycles = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']).map(r => JSON.parse(r.data));
    const cycleMap = new Map(cycles.map(c => [c.id, c]));

    if (statusFilter) {
      const filteredTasks = [];
      for (const task of tasks) {
        const cycle = cycleMap.get(task.workCycleId);
        const statuses = getTaskStatuses(task);
        const resolved = resolveStatus(statusFilter, statuses);
        if (resolved && task.statusId === resolved.id) {
          filteredTasks.push(task);
        }
      }
      tasks = filteredTasks;
    }

    if (workCycleIdFilter) {
      tasks = tasks.filter(t => t.workCycleId === workCycleIdFilter);
    }
    if (sprintIdFilter) {
      tasks = tasks.filter(t => t.sprintId === sprintIdFilter);
    }
    if (completedFilter !== undefined) {
      const completedBool = completedFilter === 'true';
      tasks = tasks.filter(t => t.completed === completedBool);
    }
    if (dueBeforeFilter) {
      tasks = tasks.filter(t => t.deadline && t.deadline <= dueBeforeFilter);
    }

    const sprints = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']).map(r => JSON.parse(r.data));
    const sprintMap = new Map(sprints.map(s => [s.id, s]));

    const result = tasks.map(t => ({
      ...t,
      statusName: t.statusId ? resolveStatus(t.statusId, getTaskStatuses(t))?.name || null : null,
      sprintName: sprintMap.get(t.sprintId)?.name || null,
      workCycleName: cycleMap.get(t.workCycleId)?.name || null,
    }));

    res.json(result);
  });

  // API: Create task
  app.post('/api/tasks', (req, res) => {
    const { title, sprintId, description, deadline, estimatedHours, effort, status } = req.body;

    if (!title || !sprintId) {
      return res.status(400).json({ error: 'title and sprintId are required' });
    }

    const sprintRow = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['sprint', sprintId]);
    if (!sprintRow) {
      return res.status(400).json({ error: 'Sprint not found' });
    }
    const sprint = JSON.parse(sprintRow.data);
    const workCycleId = sprint.workCycleId;

    const cycleRow = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', workCycleId]);
    const cycle = cycleRow ? JSON.parse(cycleRow.data) : null;
    const statuses = getTaskStatuses({ workCycleId, statusId: null });

    if (effort && !['Low', 'Medium', 'High'].includes(effort)) {
      return res.status(400).json({ error: 'Invalid effort level. Must be Low, Medium, or High' });
    }

    let statusId = null;
    if (status) {
      const resolved = resolveStatus(status, statuses);
      if (!resolved) {
        return res.status(400).json({
          error: 'Unknown status',
          validStatuses: statuses.map(s => s.name),
        });
      }
      statusId = resolved.id;
    }

    const nowIso = new Date().toISOString();
    const task = {
      id: createId(),
      workCycleId,
      sprintId,
      title: title.trim(),
      description: (description ?? '').trim(),
      deadline: deadline ?? null,
      estimatedHours: estimatedHours ?? null,
      effort: effort ?? null,
      statusId,
      previousStatusId: null,
      blockerReason: (req.body.blockerReason ?? '').trim(),
      completed: false,
      completedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const seq = nextSeq();
    testDb.prepare('INSERT INTO entities (kind, id, data, updatedAt, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)')
      .run(['task', task.id, JSON.stringify(task), nowIso, 0, seq]);

    res.status(201).json({
      ...task,
      statusName: statusId ? resolveStatus(statusId, getTaskStatuses(task))?.name || null : null,
      sprintName: sprint.name,
      workCycleName: cycle?.name || null,
    });
  });

  // API: Patch task
  app.patch('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const taskRow = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['task', id]);
    if (!taskRow) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let task = JSON.parse(taskRow.data);
    const nowIso = new Date().toISOString();

    const cycleRow = testDb.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', task.workCycleId]);
    const cycle = cycleRow ? JSON.parse(cycleRow.data) : null;
    const statuses = getTaskStatuses(task);
    const usesDefaultStatuses = !cycle?.useCustomStatuses;
    const completedStatus = findCompletedStatus(statuses);

    if (updates.status !== undefined) {
      const resolved = resolveStatus(updates.status, statuses);
      if (!resolved) {
        return res.status(400).json({
          error: 'Unknown status',
          validStatuses: statuses.map(s => s.name),
        });
      }

      const newStatusId = resolved.id;

      if (usesDefaultStatuses && completedStatus) {
        if (newStatusId === completedStatus.id) {
          if (task.statusId !== completedStatus.id) {
            task.previousStatusId = task.statusId;
          }
          task.statusId = completedStatus.id;
          task.completed = true;
          task.completedAt = task.completedAt ?? nowIso;
        } else if (task.statusId === completedStatus.id) {
          task.statusId = task.previousStatusId ?? null;
          task.previousStatusId = null;
          task.completed = false;
          task.completedAt = null;
        } else {
          task.previousStatusId = task.statusId;
          task.statusId = newStatusId;
        }
      } else {
        task.previousStatusId = task.statusId;
        task.statusId = newStatusId;
      }
    }

    if (updates.completed !== undefined) {
      const nextCompleted = !!updates.completed;
      if (nextCompleted) {
        // Setting completed: true - if using default statuses, also update status to completed
        if (usesDefaultStatuses && completedStatus) {
          if (task.statusId !== completedStatus.id) {
            task.previousStatusId = task.statusId;
            task.statusId = completedStatus.id;
          }
        }
        task.completed = true;
        task.completedAt = task.completedAt ?? nowIso;
      } else {
        // Setting completed: false
        if (usesDefaultStatuses && task.statusId === completedStatus?.id) {
          task.statusId = task.previousStatusId ?? null;
          task.previousStatusId = null;
        } else if (!usesDefaultStatuses && usesDefaultStatuses === false) {
          // For custom status cycles, just clear completed without changing status
        }
        task.completed = false;
        task.completedAt = null;
      }
    }

    if (updates.title !== undefined) task.title = updates.title.trim();
    if (updates.description !== undefined) task.description = (updates.description ?? '').trim();
    if (updates.deadline !== undefined) task.deadline = updates.deadline ?? null;
    if (updates.estimatedHours !== undefined) task.estimatedHours = updates.estimatedHours ?? null;
    if (updates.effort !== undefined) {
      if (updates.effort && !['Low', 'Medium', 'High'].includes(updates.effort)) {
        return res.status(400).json({ error: 'Invalid effort level. Must be Low, Medium, or High' });
      }
      task.effort = updates.effort ?? null;
    }
    if (updates.blockerReason !== undefined) task.blockerReason = (updates.blockerReason ?? '').trim();

    task.updatedAt = nowIso;

    const seq = nextSeq();
    testDb.prepare('UPDATE entities SET data = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
      .run([JSON.stringify(task), nowIso, seq, 'task', id]);

    res.json({
      ...task,
      statusName: task.statusId ? resolveStatus(task.statusId, getTaskStatuses(task))?.name || null : null,
    });
  });

  // API: Get changes since ISO timestamp
  app.get('/api/changes', (req, res) => {
    const since = req.query.since;
    if (!since) {
      return res.status(400).json({ error: 'since query parameter is required' });
    }

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: 'Invalid ISO date format for since parameter' });
    }

    const rows = testDb.prepare(`
      SELECT kind, id, data, updatedAt, deleted, seq
      FROM entities
      WHERE updatedAt > ? AND kind IN ('task', 'workCycle', 'sprint')
      ORDER BY seq
    `).all([sinceDate.toISOString()]);
    const changes = rows.map(r => ({
      kind: r.kind,
      id: r.id,
      data: JSON.parse(r.data),
      updatedAt: r.updatedAt,
      deleted: r.deleted,
      seq: r.seq,
    }));

    res.json({ changes, seq: getCurrentSeq() });
  });

  const server = app.listen(0);
  const port = server.address().port;
  return { app, db: testDb, server, port };
}

async function makeRequest(url, options = {}) {
  const res = await fetch(url, options);
  return {
    status: res.status,
    json: async () => await res.json(),
  };
}
