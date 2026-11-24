import { test } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

// Minimal server implementation embedded for testing
function createTestApp(dbPath) {
  const app = express();
  const db = new Database(dbPath);

  db.exec(`
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
    if (token.length !== SYNC_KEY.length) {
      return res.status(401).json(UNAUTHORIZED_RESPONSE);
    }
    let equal = true;
    for (let i = 0; i < token.length; i++) {
      if (token[i] !== SYNC_KEY[i]) equal = false;
    }
    if (!equal) {
      return res.status(401).json(UNAUTHORIZED_RESPONSE);
    }
    next();
  }

  app.use(authMiddleware);

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const defaultStatuses = [
    { id: 'status-todo', name: 'To Do' },
    { id: 'status-in-progress', name: 'In Progress' },
    { id: 'status-in-review', name: 'In Review' },
    { id: 'status-blocked', name: 'Blocked' },
    { id: 'status-completed', name: 'Completed' },
  ];

  function getStatuses(cycle) {
    if (cycle && cycle.useCustomStatuses && cycle.customStatuses && cycle.customStatuses.length > 0) {
      return cycle.customStatuses;
    }
    return defaultStatuses;
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

  function getStatusName(statusId, cycle) {
    if (!statusId) return null;
    const statuses = getStatuses(cycle);
    const found = statuses.find(s => s.id === statusId);
    return found ? found.name : null;
  }

  function getCurrentSeq() {
    const stmt = db.prepare('SELECT MAX(seq) as maxSeq FROM entities');
    const result = stmt.get();
    return result.maxSeq || 0;
  }

  function getSnapshot() {
    const stmt = db.prepare('SELECT kind, id, data, updatedAt, deleted, seq FROM entities WHERE deleted = 0 ORDER BY seq');
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

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', seq: getCurrentSeq() });
  });

  app.post('/api/sync/push', (req, res) => {
    const changes = req.body.changes || [];
    const applied = [];
    const skipped = [];
    let maxSeq = getCurrentSeq();

    for (const change of changes) {
      const { kind, id, data, updatedAt, deleted } = change;
      if (!kind || !id || !updatedAt) {
        skipped.push({ kind, id, reason: 'Missing required fields' });
        continue;
      }

      const existing = db.prepare('SELECT data, updatedAt, seq FROM entities WHERE kind = ? AND id = ?').get([kind, id]);

      if (existing) {
        if (new Date(updatedAt) > new Date(existing.updatedAt)) {
          // Bump seq and update
          maxSeq += 1;
          const updateStmt = db.prepare('UPDATE entities SET data = ?, updatedAt = ?, deleted = ?, seq = ? WHERE kind = ? AND id = ?');
          updateStmt.run([JSON.stringify(data), updatedAt, deleted ? 1 : 0, maxSeq, kind, id]);
          applied.push({ kind, id, action: 'updated' });

          // Cascade delete: if deleting a workCycle, also tombstone its sprints and tasks
          if (kind === 'workCycle' && deleted === 1) {
            // Get all sprints and tasks and filter in JS to avoid json_extract issues
            const allSprints = db.prepare('SELECT id, seq, data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']);
            const allTasks = db.prepare('SELECT id, seq, data FROM entities WHERE kind = ? AND deleted = 0').all(['task']);

            // Tombstone sprints
            for (const sprint of allSprints) {
              const sprintData = JSON.parse(sprint.data);
              if (sprintData.workCycleId === id) {
                maxSeq += 1;
                const updateStmt2 = db.prepare('UPDATE entities SET deleted = ?, seq = ? WHERE kind = ? AND id = ?');
                updateStmt2.run([1, maxSeq, 'sprint', sprint.id]);
                applied.push({ kind: 'sprint', id: sprint.id, action: 'tombstoned' });
              }
            }

            // Tombstone tasks
            for (const task of allTasks) {
              const taskData = JSON.parse(task.data);
              if (taskData.workCycleId === id) {
                maxSeq += 1;
                const updateStmt3 = db.prepare('UPDATE entities SET deleted = ?, seq = ? WHERE kind = ? AND id = ?');
                updateStmt3.run([1, maxSeq, 'task', task.id]);
                applied.push({ kind: 'task', id: task.id, action: 'tombstoned' });
              }
            }
          }
        } else {
          skipped.push({ kind, id, reason: 'Stored version is newer or equal' });
        }
      } else {
        // Bump seq and insert
        maxSeq += 1;
        const insertStmt = db.prepare('INSERT INTO entities (kind, id, data, updatedAt, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)');
        insertStmt.run([kind, id, JSON.stringify(data), updatedAt, deleted ? 1 : 0, maxSeq]);
        applied.push({ kind, id, action: 'inserted' });
      }
    }

    res.json({ applied, skipped, seq: maxSeq });
  });

  app.get('/api/sync/pull', (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    const rows = db.prepare('SELECT kind, id, data, updatedAt, deleted, seq FROM entities WHERE seq > ? ORDER BY seq').all([since]);
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

  app.get('/api/sync/snapshot', (req, res) => {
    const snapshot = getSnapshot();
    res.json({
      settings: snapshot.find(r => r.kind === 'settings')?.data || null,
      workCycles: snapshot.filter(r => r.kind === 'workCycle').map(r => r.data),
      sprints: snapshot.filter(r => r.kind === 'sprint').map(r => r.data),
      tasks: snapshot.filter(r => r.kind === 'task').map(r => r.data),
      seq: getCurrentSeq(),
    });
  });

  app.delete('/api/sync/all', (req, res) => {
    db.exec('DELETE FROM entities');
    res.json({ message: 'All data deleted' });
  });

  app.get('/api/statuses', (req, res) => {
    const stmt = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').get(['settings']);
    const settings = stmt ? JSON.parse(stmt.data) : null;
    const defaultStatusesList = settings?.defaultStatuses || defaultStatuses;

    const cyclesStmt = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']);
    const cycles = cyclesStmt.map(r => JSON.parse(r.data));

    const customStatuses = {};
    for (const cycle of cycles) {
      if (cycle.useCustomStatuses && cycle.customStatuses) {
        customStatuses[cycle.id] = cycle.customStatuses;
      }
    }

    res.json({
      default: defaultStatusesList,
      customByCycle: customStatuses,
    });
  });

  app.get('/api/work-cycles', (req, res) => {
    const rows = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']);
    const cycles = rows.map(r => JSON.parse(r.data));
    res.json(cycles);
  });

  app.get('/api/sprints', (req, res) => {
    const workCycleId = req.query.workCycleId;
    if (!workCycleId) {
      return res.status(400).json({ error: 'workCycleId query parameter is required' });
    }
    const rows = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']);
    const sprints = rows.map(r => JSON.parse(r.data)).filter(s => s.workCycleId === workCycleId);
    res.json(sprints);
  });

  app.get('/api/tasks', (req, res) => {
    let tasks = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['task']).map(r => JSON.parse(r.data));

    const statusFilter = req.query.status;
    const workCycleIdFilter = req.query.workCycleId;
    const sprintIdFilter = req.query.sprintId;
    const completedFilter = req.query.completed;
    const dueBeforeFilter = req.query.due_before;

    const cycles = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']).map(r => JSON.parse(r.data));
    const cycleMap = new Map(cycles.map(c => [c.id, c]));

    let resolvedStatusId = null;
    if (statusFilter) {
      for (const task of tasks) {
        const cycle = cycleMap.get(task.workCycleId);
        const statuses = getStatuses(cycle);
        const resolved = resolveStatus(statusFilter, statuses);
        if (resolved) {
          resolvedStatusId = resolved.id;
          break;
        }
      }
    }

    if (statusFilter && resolvedStatusId) {
      tasks = tasks.filter(t => t.statusId === resolvedStatusId);
    } else if (statusFilter && !resolvedStatusId) {
      return res.json([]);
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

    const sprints = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']).map(r => JSON.parse(r.data));
    const sprintMap = new Map(sprints.map(s => [s.id, s]));

    const result = tasks.map(t => ({
      ...t,
      statusName: t.statusId ? getStatusName(t.statusId, cycleMap.get(t.workCycleId)) : null,
      sprintName: sprintMap.get(t.sprintId)?.name || null,
      workCycleName: cycleMap.get(t.workCycleId)?.name || null,
    }));

    res.json(result);
  });

  app.get('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const taskRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['task', id]);
    if (!taskRow) {
      return res.status(404).json({ error: 'Task not found' });
    }
    let task = JSON.parse(taskRow.data);

    const cycleRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', task.workCycleId]);
    const cycle = cycleRow ? JSON.parse(cycleRow.data) : null;

    const sprintRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['sprint', task.sprintId]);
    const sprint = sprintRow ? JSON.parse(sprintRow.data) : null;

    res.json({
      ...task,
      statusName: task.statusId ? getStatusName(task.statusId, cycle) : null,
      sprintName: sprint?.name || null,
      workCycleName: cycle?.name || null,
    });
  });

  app.post('/api/tasks', (req, res) => {
    const { title, sprintId, description, deadline, estimatedHours, effort, status } = req.body;

    if (!title || !sprintId) {
      return res.status(400).json({ error: 'title and sprintId are required' });
    }

    const sprintRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['sprint', sprintId]);
    if (!sprintRow) {
      return res.status(400).json({ error: 'Sprint not found' });
    }
    const sprint = JSON.parse(sprintRow.data);
    const workCycleId = sprint.workCycleId;

    if (effort && !['Low', 'Medium', 'High'].includes(effort)) {
      return res.status(400).json({ error: 'Invalid effort level. Must be Low, Medium, or High' });
    }

    let statusId = null;
    if (status) {
      const cycleRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', workCycleId]);
      const cycle = cycleRow ? JSON.parse(cycleRow.data) : null;
      const statuses = getStatuses(cycle);
      const resolved = resolveStatus(status, statuses);
      if (!resolved) {
        return res.status(400).json({ error: 'Unknown status', validStatuses: statuses.map(s => s.name) });
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

    db.prepare('INSERT INTO entities (kind, id, data, updatedAt, deleted) VALUES (?, ?, ?, ?, ?)')
      .run('task', task.id, JSON.stringify(task), nowIso, 0);

    res.status(201).json({
      ...task,
      statusName: statusId ? getStatusName(statusId, cycle) : null,
      sprintName: sprint.name,
      workCycleName: workCycleId,
    });
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const taskRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['task', id]);
    if (!taskRow) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let task = JSON.parse(taskRow.data);
    const nowIso = new Date().toISOString();

    const cycleRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', task.workCycleId]);
    const cycle = cycleRow ? JSON.parse(cycleRow.data) : null;
    const statuses = getStatuses(cycle);

    if (updates.status !== undefined) {
      const resolved = resolveStatus(updates.status, statuses);
      if (!resolved) {
        return res.status(400).json({ error: 'Unknown status', validStatuses: statuses.map(s => s.name) });
      }

      const completedStatus = findCompletedStatus(statuses);
      const newStatusId = resolved.id;

      if (completedStatus && newStatusId === completedStatus.id) {
        task.completed = true;
        task.completedAt = task.completedAt ?? nowIso;
      } else if (completedStatus && task.statusId === completedStatus.id && newStatusId !== completedStatus.id) {
        task.completed = false;
        task.completedAt = null;
      }

      task.previousStatusId = task.statusId;
      task.statusId = newStatusId;
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

    db.prepare('UPDATE entities SET data = ?, updatedAt = ? WHERE kind = ? AND id = ?')
      .run([JSON.stringify(task), nowIso, 'task', id]);

    res.json({
      ...task,
      statusName: task.statusId ? getStatusName(task.statusId, cycle) : null,
    });
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const taskRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['task', id]);
    if (!taskRow) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = JSON.parse(taskRow.data);
    const nowIso = new Date().toISOString();
    db.prepare('UPDATE entities SET deleted = ?, updatedAt = ? WHERE kind = ? AND id = ?')
      .run([1, nowIso, 'task', id]);

    res.json({ message: 'Task tombstoned' });
  });

  app.get('/api/changes', (req, res) => {
    const since = req.query.since;
    if (!since) {
      return res.status(400).json({ error: 'since query parameter is required' });
    }

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: 'Invalid ISO date format for since parameter' });
    }

    const stmt = db.prepare(`
      SELECT kind, id, data, updatedAt, deleted, seq
      FROM entities
      WHERE updatedAt > ? AND kind IN ('task', 'workCycle', 'sprint')
      ORDER BY seq
    `);
    const rows = stmt.all(since.toISOString());
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

  return app;
}

// Use fetch globally available in Node 18+
async function makeRequest(url, options = {}) {
  const res = await fetch(url, options);
  return {
    status: res.status,
    json: async () => await res.json(),
    headers: res.headers,
  };
}

// Test: 401 without auth key
test('returns 401 without auth key', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;

    const health = await makeRequest(`${baseUrl}/health`);
    assert.strictEqual(health.status, 200);
    const healthData = await health.json();
    assert.strictEqual(healthData.status, 'ok');

    const syncPush = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [] }),
    });
    assert.strictEqual(syncPush.status, 401);

    const syncPull = await makeRequest(`${baseUrl}/api/sync/pull?since=0`);
    assert.strictEqual(syncPull.status, 401);

    const syncSnapshot = await makeRequest(`${baseUrl}/api/sync/snapshot`);
    assert.strictEqual(syncSnapshot.status, 401);

    const syncAll = await makeRequest(`${baseUrl}/api/sync/all`, { method: 'DELETE' });
    assert.strictEqual(syncAll.status, 401);

    const tasks = await makeRequest(`${baseUrl}/api/tasks`);
    assert.strictEqual(tasks.status, 401);

    const workCycles = await makeRequest(`${baseUrl}/api/work-cycles`);
    assert.strictEqual(workCycles.status, 401);
  } finally {
    server.close();
  }
});

// Test: push/pull with last-write-wins
test('push/pull last-write-wins conflict resolution', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const push1 = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'task',
          id: 'task-1',
          data: { title: 'First version', completed: false },
          updatedAt: '2025-01-01T10:00:00.000Z',
          deleted: 0,
        }],
      }),
    });
    assert.strictEqual(push1.status, 200);
    const push1Data = await push1.json();
    assert.strictEqual(push1Data.applied.length, 1);
    assert.strictEqual(push1Data.seq, 1);

    const pull1 = await makeRequest(`${baseUrl}/api/sync/pull?since=0`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    assert.strictEqual(pull1.status, 200);
    const pull1Data = await pull1.json();
    assert.strictEqual(pull1Data.changes.length, 1);
    assert.strictEqual(pull1Data.changes[0].data.title, 'First version');

    const push2 = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'task',
          id: 'task-1',
          data: { title: 'Older version', completed: true },
          updatedAt: '2025-01-01T09:00:00.000Z',
          deleted: 0,
        }],
      }),
    });
    assert.strictEqual(push2.status, 200);
    const push2Data = await push2.json();
    assert.strictEqual(push2Data.skipped.length, 1);
    assert.strictEqual(push2Data.applied.length, 0);

    const pull2 = await makeRequest(`${baseUrl}/api/sync/pull?since=1`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    assert.strictEqual(pull2.status, 200);
    const pull2Data = await pull2.json();
    assert.strictEqual(pull2Data.changes.length, 0);

    const pull3 = await makeRequest(`${baseUrl}/api/sync/pull?since=0`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const pull3Data = await pull3.json();
    assert.strictEqual(pull3Data.changes[0].data.title, 'First version');

    const push3 = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'task',
          id: 'task-1',
          data: { title: 'Newer version', completed: true },
          updatedAt: '2025-01-01T11:00:00.000Z',
          deleted: 0,
        }],
      }),
    });
    assert.strictEqual(push3.status, 200);
    const push3Data = await push3.json();
    assert.strictEqual(push3Data.applied.length, 1);

    const pull4 = await makeRequest(`${baseUrl}/api/sync/pull?since=1`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const pull4Data = await pull4.json();
    assert.strictEqual(pull4Data.changes.length, 1);
    assert.strictEqual(pull4Data.changes[0].data.title, 'Newer version');
  } finally {
    server.close();
  }
});

// Test: workCycle delete cascades tombstones
test('workCycle delete cascades tombstones', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const nowIso = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';
    const taskId1 = 'task-1';
    const taskId2 = 'task-2';

    const pushChanges = [
      {
        kind: 'workCycle',
        id: cycleId,
        data: {
          id: cycleId,
          name: 'Test Cycle',
          description: '',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-14',
          sprintLengthDays: 7,
          useCustomStatuses: false,
          customStatuses: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'sprint',
        id: sprintId,
        data: {
          id: sprintId,
          workCycleId: cycleId,
          name: 'Sprint 1',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          order: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'task',
        id: taskId1,
        data: {
          id: taskId1,
          workCycleId: cycleId,
          sprintId: sprintId,
          title: 'Task 1',
          description: '',
          deadline: null,
          estimatedHours: null,
          effort: null,
          statusId: null,
          previousStatusId: null,
          blockerReason: '',
          completed: false,
          completedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'task',
        id: taskId2,
        data: {
          id: taskId2,
          workCycleId: cycleId,
          sprintId: sprintId,
          title: 'Task 2',
          description: '',
          deadline: null,
          estimatedHours: null,
          effort: null,
          statusId: null,
          previousStatusId: null,
          blockerReason: '',
          completed: false,
          completedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
    ];

    const push1 = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: pushChanges }),
    });
    assert.strictEqual(push1.status, 200);

    const snapshot = await makeRequest(`${baseUrl}/api/sync/snapshot`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const snapData = await snapshot.json();
    assert.strictEqual(snapData.workCycles.length, 1);
    assert.strictEqual(snapData.sprints.length, 1);
    assert.strictEqual(snapData.tasks.length, 2);

    // Use a future date for the delete so it's newer than existing entries
    const deleteDate = new Date();
    deleteDate.setFullYear(deleteDate.getFullYear() + 1);
    const deleteIso = deleteDate.toISOString();

    const pushDelete = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: cycleId,
          data: null,
          updatedAt: deleteIso,
          deleted: 1,
        }],
      }),
    });
    assert.strictEqual(pushDelete.status, 200);

    const snapshot2 = await makeRequest(`${baseUrl}/api/sync/pull?since=${snapData.seq}`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const snapshot2Data = await snapshot2.json();
    const deletedChanges = snapshot2Data.changes.filter(c => c.deleted === 1);

    // workCycle delete cascades: 1 workCycle + 1 sprint + 2 tasks = 4 total
    assert.strictEqual(deletedChanges.length, 4);
    const deletedKinds = deletedChanges.map(c => c.kind);
    assert.ok(deletedKinds.includes('workCycle'));
    assert.ok(deletedKinds.includes('sprint'));
    assert.ok(deletedKinds.includes('task'));
  } finally {
    server.close();
  }
});

// Test: PATCH status to Completed sets completed+completedAt
test('PATCH status to Completed sets completed+completedAt', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const nowIso = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';
    const taskId = 'task-1';

    const pushChanges = [
      {
        kind: 'workCycle',
        id: cycleId,
        data: {
          id: cycleId,
          name: 'Test Cycle',
          description: '',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-14',
          sprintLengthDays: 7,
          useCustomStatuses: false,
          customStatuses: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'sprint',
        id: sprintId,
        data: {
          id: sprintId,
          workCycleId: cycleId,
          name: 'Sprint 1',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          order: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'task',
        id: taskId,
        data: {
          id: taskId,
          workCycleId: cycleId,
          sprintId: sprintId,
          title: 'Task 1',
          description: '',
          deadline: null,
          estimatedHours: null,
          effort: null,
          statusId: 'status-todo',
          previousStatusId: null,
          blockerReason: '',
          completed: false,
          completedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
    ];

    const push = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: pushChanges }),
    });
    assert.strictEqual(push.status, 200);

    const taskResp = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const taskData = await taskResp.json();
    assert.strictEqual(taskData.statusId, 'status-todo');
    assert.strictEqual(taskData.completed, false);
    assert.strictEqual(taskData.completedAt, null);

    const patch = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'Completed' }),
    });
    assert.strictEqual(patch.status, 200);
    const patchData = await patch.json();
    assert.strictEqual(patchData.completed, true);
    assert.ok(patchData.completedAt);

    const taskResp2 = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const taskData2 = await taskResp2.json();
    assert.strictEqual(taskData2.statusId, 'status-completed');
    assert.strictEqual(taskData2.completed, true);
    assert.ok(taskData2.completedAt);
  } finally {
    server.close();
  }
});

// Test: PATCH status away from Completed clears completed+completedAt
test('PATCH status away from Completed clears completed+completedAt', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const nowIso = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';
    const taskId = 'task-1';

    const pushChanges = [
      {
        kind: 'workCycle',
        id: cycleId,
        data: {
          id: cycleId,
          name: 'Test Cycle',
          description: '',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-14',
          sprintLengthDays: 7,
          useCustomStatuses: false,
          customStatuses: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'sprint',
        id: sprintId,
        data: {
          id: sprintId,
          workCycleId: cycleId,
          name: 'Sprint 1',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          order: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'task',
        id: taskId,
        data: {
          id: taskId,
          workCycleId: cycleId,
          sprintId: sprintId,
          title: 'Task 1',
          description: '',
          deadline: null,
          estimatedHours: null,
          effort: null,
          statusId: 'status-completed',
          previousStatusId: null,
          blockerReason: '',
          completed: true,
          completedAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
    ];

    const push = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: pushChanges }),
    });
    assert.strictEqual(push.status, 200);

    const patch = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'In Progress' }),
    });
    assert.strictEqual(patch.status, 200);
    const patchData = await patch.json();
    assert.strictEqual(patchData.statusId, 'status-in-progress');
    assert.strictEqual(patchData.completed, false);
    assert.strictEqual(patchData.completedAt, null);

    const taskResp = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const taskData = await taskResp.json();
    assert.strictEqual(taskData.statusId, 'status-in-progress');
    assert.strictEqual(taskData.completed, false);
    assert.strictEqual(taskData.completedAt, null);
  } finally {
    server.close();
  }
});

// Test: unknown status returns 400 with valid status names
test('unknown status returns 400 with valid status names', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const nowIso = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';
    const taskId = 'task-1';

    const pushChanges = [
      {
        kind: 'workCycle',
        id: cycleId,
        data: {
          id: cycleId,
          name: 'Test Cycle',
          description: '',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-14',
          sprintLengthDays: 7,
          useCustomStatuses: false,
          customStatuses: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'sprint',
        id: sprintId,
        data: {
          id: sprintId,
          workCycleId: cycleId,
          name: 'Sprint 1',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          order: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'task',
        id: taskId,
        data: {
          id: taskId,
          workCycleId: cycleId,
          sprintId: sprintId,
          title: 'Task 1',
          description: '',
          deadline: null,
          estimatedHours: null,
          effort: null,
          statusId: 'status-todo',
          previousStatusId: null,
          blockerReason: '',
          completed: false,
          completedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
    ];

    const push = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: pushChanges }),
    });
    assert.strictEqual(push.status, 200);

    const patch = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'Unknown Status' }),
    });
    assert.strictEqual(patch.status, 400);
    const errorData = await patch.json();
    assert.ok(errorData.error);
    assert.ok(errorData.validStatuses);
    assert.ok(errorData.validStatuses.includes('To Do'));
    assert.ok(errorData.validStatuses.includes('In Progress'));
    assert.ok(errorData.validStatuses.includes('Completed'));
  } finally {
    server.close();
  }
});

// Test: POST /api/tasks creates task with generated id
test('POST /api/tasks creates task with generated id', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const nowIso = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';

    const pushChanges = [
      {
        kind: 'workCycle',
        id: cycleId,
        data: {
          id: cycleId,
          name: 'Test Cycle',
          description: '',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-14',
          sprintLengthDays: 7,
          useCustomStatuses: false,
          customStatuses: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'sprint',
        id: sprintId,
        data: {
          id: sprintId,
          workCycleId: cycleId,
          name: 'Sprint 1',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          order: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
    ];

    const push = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: pushChanges }),
    });
    assert.strictEqual(push.status, 200);

    const postTask = await makeRequest(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'New Task',
        sprintId: sprintId,
        description: 'A test task',
      }),
    });
    assert.strictEqual(postTask.status, 201);
    const taskData = await postTask.json();

    assert.ok(taskData.id);
    assert.ok(taskData.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
    assert.strictEqual(taskData.title, 'New Task');
    assert.strictEqual(taskData.sprintId, sprintId);
    assert.strictEqual(taskData.workCycleId, cycleId);
    assert.strictEqual(taskData.completed, false);
    assert.strictEqual(taskData.completedAt, null);
  } finally {
    server.close();
  }
});

// Test: DELETE /api/sync/all
test('DELETE /api/sync/all', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const push = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes: [{
          kind: 'task',
          id: 'task-1',
          data: { title: 'Test task' },
          updatedAt: '2025-01-01T00:00:00.000Z',
          deleted: 0,
        }],
      }),
    });
    assert.strictEqual(push.status, 200);

    const snapshot = await makeRequest(`${baseUrl}/api/sync/snapshot`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const snapData = await snapshot.json();
    assert.strictEqual(snapData.tasks.length, 1);

    const delAll = await makeRequest(`${baseUrl}/api/sync/all`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    assert.strictEqual(delAll.status, 200);

    const snapshot2 = await makeRequest(`${baseUrl}/api/sync/snapshot`, {
      headers: { 'Authorization': `Bearer ${syncKey}` },
    });
    const snapData2 = await snapshot2.json();
    assert.strictEqual(snapData2.tasks.length, 0);
  } finally {
    server.close();
  }
});

// Test: PATCH status to Completed clears completedAt when moving back
test('PATCH status to Completed clears completedAt when moving back', { timeout: 10000 }, async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const dbPath = `/tmp/tasksync-test-${Date.now()}.db`;
  const app = createTestApp(dbPath);
  const server = app.listen(port);

  try {
    const baseUrl = `http://localhost:${port}`;
    const syncKey = 'test-secret-key-12345';

    const nowIso = new Date().toISOString();
    const cycleId = 'cycle-1';
    const sprintId = 'sprint-1';
    const taskId = 'task-1';

    const pushChanges = [
      {
        kind: 'workCycle',
        id: cycleId,
        data: {
          id: cycleId,
          name: 'Test Cycle',
          description: '',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-14',
          sprintLengthDays: 7,
          useCustomStatuses: false,
          customStatuses: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'sprint',
        id: sprintId,
        data: {
          id: sprintId,
          workCycleId: cycleId,
          name: 'Sprint 1',
          endGoal: '',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          order: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
      {
        kind: 'task',
        id: taskId,
        data: {
          id: taskId,
          workCycleId: cycleId,
          sprintId: sprintId,
          title: 'Task 1',
          description: '',
          deadline: null,
          estimatedHours: null,
          effort: null,
          statusId: 'status-completed',
          previousStatusId: null,
          blockerReason: '',
          completed: true,
          completedAt: '2025-01-10T00:00:00.000Z',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        updatedAt: nowIso,
        deleted: 0,
      },
    ];

    const push = await makeRequest(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ changes: pushChanges }),
    });
    assert.strictEqual(push.status, 200);

    const patch1 = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'In Progress' }),
    });
    assert.strictEqual(patch1.status, 200);
    const patchData1 = await patch1.json();
    assert.strictEqual(patchData1.statusId, 'status-in-progress');
    assert.strictEqual(patchData1.completed, false);
    assert.strictEqual(patchData1.completedAt, null);

    const patch2 = await makeRequest(`${baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'Completed' }),
    });
    assert.strictEqual(patch2.status, 200);
    const patchData2 = await patch2.json();
    assert.strictEqual(patchData2.statusId, 'status-completed');
    assert.strictEqual(patchData2.completed, true);
    assert.ok(patchData2.completedAt);
  } finally {
    server.close();
  }
});
