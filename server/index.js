import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate SYNC_KEY at startup
const SYNC_KEY = process.env.SYNC_KEY;
if (!SYNC_KEY || SYNC_KEY.length < 16) {
  console.error('Error: SYNC_KEY must be set and at least 16 characters long');
  process.exit(1);
}

// SHA256 hash of the SYNC_KEY for comparison
const SYNC_KEY_HASH = crypto.createHash('sha256').update(SYNC_KEY).digest();

const app = express();
const PORT = process.env.PORT || 8787;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tasksync.db');

// CORS configuration
const allowedOrigins = [
  'https://rshukla2.github.io',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  'http://localhost:3000',
];

// Chrome Private Network Access: lets the GitHub Pages site reach a server on localhost/LAN.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

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

// Auth middleware - check SYNC_KEY using timing-safe comparison
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

// Database setup
const dbPath = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(__dirname, DB_PATH);
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize database schema with meta table for seq counter
db.exec(`
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

db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', 0)").run();

// Get next sequence number from meta table
function nextSeq() {
  const result = db.prepare(`
    UPDATE meta SET value = value + 1 WHERE key = 'seq' RETURNING value
  `).get();
  return result.value;
}

// Get current max seq (from meta table)
function getCurrentSeq() {
  const result = db.prepare('SELECT value FROM meta WHERE key = ?').get(['seq']);
  return result?.value || 0;
}

// Custom id generator (same as createId in src/core/scheduling.ts)
function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Default statuses
const defaultStatuses = [
  { id: 'status-todo', name: 'To Do' },
  { id: 'status-in-progress', name: 'In Progress' },
  { id: 'status-in-review', name: 'In Review' },
  { id: 'status-blocked', name: 'Blocked' },
  { id: 'status-completed', name: 'Completed' },
];

// Helper to get statuses for a work cycle from settings
function getTaskStatuses(task, settings) {
  const cycle = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', task.workCycleId]);
  if (!cycle) return defaultStatuses;
  const cycleData = JSON.parse(cycle.data);
  if (cycleData.useCustomStatuses && cycleData.customStatuses && cycleData.customStatuses.length > 0) {
    return cycleData.customStatuses;
  }
  return settings?.defaultStatuses || defaultStatuses;
}

// Helper to find completed status
function findCompletedStatus(statuses) {
  const byId = statuses.find(s => s.id === 'status-completed');
  if (byId) return byId;
  const byName = statuses.find(s => s.name.trim().toLowerCase() === 'completed');
  return byName ?? null;
}

// Helper to resolve status by name or id
function resolveStatus(statusInput, statuses) {
  if (!statusInput) return null;
  const found = statuses.find(s => s.id === statusInput || s.name.trim().toLowerCase() === statusInput.trim().toLowerCase());
  return found || null;
}

// Helper to validate kind
function isValidKind(kind) {
  return ['settings', 'workCycle', 'sprint', 'task'].includes(kind);
}

// Helper to check if updatedAt is valid date
function isValidDate(dateString) {
  if (!dateString) return false;
  const d = new Date(dateString);
  return !isNaN(d.getTime());
}

// API: Health check (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', seq: getCurrentSeq() });
});

// API: Get all non-deleted entities as snapshot
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

// API: Push changes
app.post('/api/sync/push', (req, res) => {
  const changes = req.body.changes || [];
  const applied = [];
  const skipped = [];

  // Wrap entire operation in a transaction
  const transaction = db.transaction(() => {
    let currentSeq = getCurrentSeq();

    for (const change of changes) {
      const { kind, id, data, updatedAt, deleted } = change;

      // Validate kind
      if (!isValidKind(kind)) {
        skipped.push({ kind, id, reason: 'Invalid kind' });
        continue;
      }

      // Check for required fields
      if (!kind || !id || !updatedAt) {
        skipped.push({ kind, id, reason: 'Missing required fields' });
        continue;
      }

      // Validate updatedAt is a valid date
      if (!isValidDate(updatedAt)) {
        skipped.push({ kind, id, reason: 'Invalid updatedAt date' });
        continue;
      }

      // Check if deleted is truthy (true or 1)
      const isDeleted = !!deleted;

      const existing = db.prepare('SELECT data, updatedAt, seq FROM entities WHERE kind = ? AND id = ?').get([kind, id]);

      if (existing) {
        // Last-write-wins comparison
        if (new Date(updatedAt) > new Date(existing.updatedAt)) {
          // Bump seq and update
          currentSeq = nextSeq();
          db.prepare('UPDATE entities SET data = ?, updatedAt = ?, deleted = ?, seq = ? WHERE kind = ? AND id = ?')
            .run([JSON.stringify(data), updatedAt, isDeleted ? 1 : 0, currentSeq, kind, id]);
          applied.push({ kind, id, action: 'updated' });

          // Cascade delete: if deleting a workCycle, also tombstone its sprints and tasks
          if (kind === 'workCycle' && isDeleted) {
            const nowIso = new Date(updatedAt).toISOString();
            const allSprints = db.prepare('SELECT id, seq, data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']);
            const allTasks = db.prepare('SELECT id, seq, data FROM entities WHERE kind = ? AND deleted = 0').all(['task']);

            for (const sprint of allSprints) {
              const sprintData = JSON.parse(sprint.data);
              if (sprintData.workCycleId === id) {
                currentSeq = nextSeq();
                db.prepare('UPDATE entities SET deleted = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
                  .run([1, nowIso, currentSeq, 'sprint', sprint.id]);
                applied.push({ kind: 'sprint', id: sprint.id, action: 'tombstoned' });
              }
            }

            for (const task of allTasks) {
              const taskData = JSON.parse(task.data);
              if (taskData.workCycleId === id) {
                currentSeq = nextSeq();
                db.prepare('UPDATE entities SET deleted = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
                  .run([1, nowIso, currentSeq, 'task', task.id]);
                applied.push({ kind: 'task', id: task.id, action: 'tombstoned' });
              }
            }
          }
        } else {
          skipped.push({ kind, id, reason: 'Stored version is newer or equal' });
        }
      } else {
        // Bump seq and insert
        currentSeq = nextSeq();
        db.prepare('INSERT INTO entities (kind, id, data, updatedAt, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)')
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
  const rows = db.prepare('SELECT kind, id, data, updatedAt, deleted, seq FROM entities WHERE seq > ? ORDER BY seq').all([since]);
  const changes = rows.map(r => ({
    kind: r.kind,
    id: r.id,
    data: JSON.parse(r.data),
    updatedAt: r.updatedAt,
    deleted: r.deleted,
    seq: r.seq,
  }));
  res.json({
    changes,
    seq: getCurrentSeq(),
  });
});

// API: Get full snapshot (first-time sync)
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

// API: Delete all data
app.delete('/api/sync/all', (req, res) => {
  db.exec('DELETE FROM entities');
  // Note: meta table is NOT deleted, seq counter persists
  res.json({ message: 'All data deleted' });
});

// Agent API: Get statuses
app.get('/api/statuses', (req, res) => {
  const stmt = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').get(['settings']);
  const settings = stmt ? JSON.parse(stmt.data) : null;
  const defaultStatusesList = settings?.defaultStatuses || defaultStatuses;

  const cycles = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']);
  const cyclesData = cycles.map(r => JSON.parse(r.data));

  const customStatuses = {};
  for (const cycle of cyclesData) {
    if (cycle.useCustomStatuses && cycle.customStatuses) {
      customStatuses[cycle.id] = cycle.customStatuses;
    }
  }

  res.json({
    default: defaultStatusesList,
    customByCycle: customStatuses,
  });
});

// Agent API: Get work cycles
app.get('/api/work-cycles', (req, res) => {
  const rows = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']);
  const cycles = rows.map(r => JSON.parse(r.data));
  res.json(cycles);
});

// Agent API: Get sprints for a work cycle
app.get('/api/sprints', (req, res) => {
  const workCycleId = req.query.workCycleId;
  if (!workCycleId) {
    return res.status(400).json({ error: 'workCycleId query parameter is required' });
  }
  const rows = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['sprint']);
  const sprints = rows.map(r => JSON.parse(r.data)).filter(s => s.workCycleId === workCycleId);
  res.json(sprints);
});

// Helper to get task's statuses (default or custom based on cycle config)
function getStatusesForTask(task) {
  const cycle = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', task.workCycleId]);
  if (!cycle) return defaultStatuses;
  const cycleData = JSON.parse(cycle.data);
  if (cycleData.useCustomStatuses && cycleData.customStatuses && cycleData.customStatuses.length > 0) {
    return cycleData.customStatuses;
  }
  const settings = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').get(['settings']);
  const settingsData = settings ? JSON.parse(settings.data) : null;
  return settingsData?.defaultStatuses || defaultStatuses;
}

// Helper to get task's statusName
function getStatusName(statusId, cycle) {
  if (!statusId) return null;
  const statuses = getStatusesForTask({ workCycleId: cycle ? cycle.id : null });
  const found = statuses.find(s => s.id === statusId);
  return found ? found.name : null;
}

// Agent API: Get tasks with optional filters
app.get('/api/tasks', (req, res) => {
  let tasks = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['task']).map(r => JSON.parse(r.data));

  const statusFilter = req.query.status;
  const workCycleIdFilter = req.query.workCycleId;
  const sprintIdFilter = req.query.sprintId;
  const completedFilter = req.query.completed;
  const dueBeforeFilter = req.query.due_before;

  const cycles = db.prepare('SELECT data FROM entities WHERE kind = ? AND deleted = 0').all(['workCycle']).map(r => JSON.parse(r.data));
  const cycleMap = new Map(cycles.map(c => [c.id, c]));

  if (statusFilter) {
    // Resolve status per task against that task's own work cycle statuses
    const filteredTasks = [];
    for (const task of tasks) {
      const cycle = cycleMap.get(task.workCycleId);
      const statuses = getStatusesForTask(task);
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

// Agent API: Get task by ID
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

// Agent API: Create task
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

  // Load cycle once before status handling
  const cycleRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['workCycle', workCycleId]);
  const cycle = cycleRow ? JSON.parse(cycleRow.data) : null;
  const statuses = getStatusesForTask({ workCycleId, statusId: null });

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
  db.prepare('INSERT INTO entities (kind, id, data, updatedAt, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)')
    .run(['task', task.id, JSON.stringify(task), nowIso, 0, seq]);

  res.status(201).json({
    ...task,
    statusName: statusId ? getStatusName(statusId, cycle) : null,
    sprintName: sprint.name,
    workCycleName: cycle?.name || null,
  });
});

// Agent API: Patch task
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
  const statuses = getStatusesForTask(task);

  // Determine if using default statuses
  const usesDefaultStatuses = !cycle?.useCustomStatuses;

  const completedStatus = usesDefaultStatuses ? findCompletedStatus(statuses) : null;

  // Mirrors toggleTaskCompletion in src/state/WorkspaceContext.tsx
  function setCompleted(next) {
    if (next) {
      if (completedStatus && task.statusId !== completedStatus.id) {
        task.previousStatusId = task.statusId;
        task.statusId = completedStatus.id;
      }
      if (!task.completed) task.completedAt = nowIso;
      task.completed = true;
    } else {
      if (completedStatus && task.statusId === completedStatus.id) {
        task.statusId = task.previousStatusId ?? null;
      }
      task.previousStatusId = null;
      task.completed = false;
      task.completedAt = null;
    }
  }

  if (updates.status !== undefined && updates.status !== null) {
    const resolved = resolveStatus(String(updates.status), statuses);
    if (!resolved) {
      return res.status(400).json({
        error: 'Unknown status',
        validStatuses: statuses.map(s => s.name),
      });
    }
    if (completedStatus && resolved.id === completedStatus.id) {
      setCompleted(true);
    } else {
      task.statusId = resolved.id;
      if (completedStatus && task.completed) {
        task.completed = false;
        task.completedAt = null;
        task.previousStatusId = null;
      }
    }
  }

  if (updates.completed !== undefined && updates.status === undefined) {
    setCompleted(!!updates.completed);
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
  db.prepare('UPDATE entities SET data = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
    .run([JSON.stringify(task), nowIso, seq, 'task', id]);

  res.json({
    ...task,
    statusName: task.statusId ? getStatusName(task.statusId, cycle) : null,
  });
});

// Agent API: Delete task (tombstone)
app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const taskRow = db.prepare('SELECT data FROM entities WHERE kind = ? AND id = ? AND deleted = 0').get(['task', id]);
  if (!taskRow) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const task = JSON.parse(taskRow.data);
  const nowIso = new Date().toISOString();
  const seq = nextSeq();
  db.prepare('UPDATE entities SET deleted = ?, updatedAt = ?, seq = ? WHERE kind = ? AND id = ?')
    .run([1, nowIso, seq, 'task', id]);

  res.json({ message: 'Task tombstoned' });
});

// Agent API: Get changes since ISO timestamp
app.get('/api/changes', (req, res) => {
  const since = req.query.since;
  if (!since) {
    return res.status(400).json({ error: 'since query parameter is required' });
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return res.status(400).json({ error: 'Invalid ISO date format for since parameter' });
  }

  const rows = db.prepare(`
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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database path: ${dbPath}`);
});

export default app;
