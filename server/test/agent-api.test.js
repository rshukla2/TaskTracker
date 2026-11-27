// Acceptance tests for the agent API (work cycles, sprints, task moves).
// Spawns the REAL server/index.js against a temp DB. Do not replace with an inline copy.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = 'agent-api-test-key';
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-agent-api-'));
let proc;

before(async () => {
  proc = spawn('node', [path.resolve(__dirname, '..', 'index.js')], {
    env: { ...process.env, SYNC_KEY: KEY, PORT: String(PORT), DB_PATH: path.join(tmpDir, 'test.db') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  proc?.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
}

function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// n back-to-back sprints of len days starting at start
function chain(start, n, len, named = false) {
  const out = [];
  let s = start;
  for (let i = 0; i < n; i++) {
    const e = addDays(s, len - 1);
    out.push(named ? { name: `Phase ${String.fromCharCode(65 + i)}`, startDate: s, endDate: e } : { startDate: s, endDate: e });
    s = addDays(e, 1);
  }
  return out;
}

async function newCycle(name, sprints) {
  const r = await api('POST', '/api/work-cycles', { name, sprints });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

function assertContiguous(res) {
  const { workCycle, sprints } = res;
  for (let i = 0; i < sprints.length; i++) {
    assert.strictEqual(sprints[i].order, i, 'orders are 0..n-1');
    assert.ok(sprints[i].endDate >= sprints[i].startDate);
    if (i > 0) assert.strictEqual(sprints[i].startDate, addDays(sprints[i - 1].endDate, 1), `sprint ${i} back to back`);
  }
  assert.strictEqual(workCycle.startDate, sprints[0].startDate, 'cycle start = first sprint');
  assert.strictEqual(workCycle.endDate, sprints[sprints.length - 1].endDate, 'cycle end = last sprint');
}

test('create work cycle derives dates and default names', async () => {
  const res = await newCycle('Launch', chain('2026-12-01', 3, 7));
  assertContiguous(res);
  assert.strictEqual(res.workCycle.startDate, '2026-12-01');
  assert.strictEqual(res.workCycle.endDate, '2026-12-21');
  assert.strictEqual(res.workCycle.sprintLengthDays, 7);
  assert.deepStrictEqual(res.sprints.map((s) => s.name), ['Sprint 1', 'Sprint 2', 'Sprint 3']);
  // visible through existing read endpoints (what the apps sync from)
  const list = await api('GET', `/api/sprints?workCycleId=${res.workCycle.id}`);
  assert.strictEqual(list.body.length, 3);
});

test('create work cycle rejects gaps, overlaps and missing name', async () => {
  const gap = [{ startDate: '2026-12-01', endDate: '2026-12-07' }, { startDate: '2026-12-09', endDate: '2026-12-15' }];
  assert.strictEqual((await api('POST', '/api/work-cycles', { name: 'Gap', sprints: gap })).status, 400);
  const overlap = [{ startDate: '2026-12-01', endDate: '2026-12-07' }, { startDate: '2026-12-07', endDate: '2026-12-15' }];
  assert.strictEqual((await api('POST', '/api/work-cycles', { name: 'Ov', sprints: overlap })).status, 400);
  assert.strictEqual((await api('POST', '/api/work-cycles', { sprints: chain('2026-12-01', 1, 7) })).status, 400);
  assert.strictEqual((await api('POST', '/api/work-cycles', { name: 'NoSprints', sprints: [] })).status, 400);
});

test('PATCH work cycle edits text, rejects dates', async () => {
  const res = await newCycle('Edit me', chain('2026-12-01', 2, 7));
  const id = res.workCycle.id;
  const ok = await api('PATCH', `/api/work-cycles/${id}`, { name: 'Edited', description: 'd', endGoal: 'g' });
  assert.strictEqual(ok.status, 200);
  const wc = ok.body.workCycle ?? ok.body;
  assert.strictEqual(wc.name, 'Edited');
  assert.strictEqual(wc.endGoal, 'g');
  assert.strictEqual((await api('PATCH', `/api/work-cycles/${id}`, { endDate: '2027-01-30' })).status, 400);
  assert.strictEqual((await api('PATCH', `/api/work-cycles/${id}`, { startDate: '2026-11-01' })).status, 400);
  assert.strictEqual((await api('PATCH', `/api/work-cycles/${id}`, { name: '' })).status, 400);
  assert.strictEqual((await api('PATCH', `/api/work-cycles/nope`, { name: 'x' })).status, 404);
});

test('insert sprint in the middle shifts later sprints, renumbers default names, extends cycle', async () => {
  const res = await newCycle('Insert', chain('2026-12-01', 3, 7));
  const r = await api('POST', '/api/sprints', { workCycleId: res.workCycle.id, lengthDays: 3, afterSprintId: res.sprints[0].id });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assertContiguous(r.body);
  assert.strictEqual(r.body.sprints.length, 4);
  assert.deepStrictEqual(r.body.sprints.map((s) => s.name), ['Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4']);
  assert.strictEqual(r.body.sprints[1].startDate, '2026-12-08');
  assert.strictEqual(r.body.sprints[1].endDate, '2026-12-10');
  assert.strictEqual(r.body.sprints[2].id, res.sprints[1].id, 'old Sprint 2 is now third');
  assert.strictEqual(r.body.workCycle.endDate, '2026-12-24');
  assert.ok(r.body.cycleDatesChanged);
});

test('append sprint at end defaults to cycle sprint length', async () => {
  const res = await newCycle('Append', chain('2026-12-01', 2, 7));
  const r = await api('POST', '/api/sprints', { workCycleId: res.workCycle.id });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assertContiguous(r.body);
  assert.strictEqual(r.body.sprints[2].name, 'Sprint 3');
  assert.strictEqual(r.body.workCycle.endDate, '2026-12-21');
});

test('insert with custom names keeps existing names', async () => {
  const res = await newCycle('Custom', chain('2026-12-01', 2, 7, true));
  const r = await api('POST', '/api/sprints', { workCycleId: res.workCycle.id, lengthDays: 7, afterSprintId: res.sprints[0].id, name: 'Buffer' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.sprints.map((s) => s.name), ['Phase A', 'Buffer', 'Phase B']);
});

test('lengthening second-last sprint pushes last sprint and cycle end; shrinking pulls them in', async () => {
  const res = await newCycle('Stretch', chain('2026-12-01', 3, 7));
  const s2 = res.sprints[1];
  const longer = await api('PATCH', `/api/sprints/${s2.id}`, { endDate: '2026-12-17' });
  assert.strictEqual(longer.status, 200, JSON.stringify(longer.body));
  assertContiguous(longer.body);
  assert.strictEqual(longer.body.sprints[2].startDate, '2026-12-18');
  assert.strictEqual(longer.body.sprints[2].endDate, '2026-12-24', 'last sprint keeps its 7 days');
  assert.strictEqual(longer.body.workCycle.endDate, '2026-12-24');

  const shorter = await api('PATCH', `/api/sprints/${s2.id}`, { endDate: '2026-12-10' });
  assert.strictEqual(shorter.status, 200, JSON.stringify(shorter.body));
  assertContiguous(shorter.body);
  assert.strictEqual(shorter.body.workCycle.endDate, '2026-12-17', 'cycle end moves earlier');
});

test('only first sprint start date can change; name and goal editable', async () => {
  const res = await newCycle('Starts', chain('2026-12-01', 2, 7));
  assert.strictEqual((await api('PATCH', `/api/sprints/${res.sprints[1].id}`, { startDate: '2026-12-09' })).status, 400);
  const first = await api('PATCH', `/api/sprints/${res.sprints[0].id}`, { startDate: '2026-11-28', name: 'Kickoff', endGoal: 'Ship v1' });
  assert.strictEqual(first.status, 200, JSON.stringify(first.body));
  assertContiguous(first.body);
  assert.strictEqual(first.body.workCycle.startDate, '2026-11-28');
  assert.strictEqual(first.body.sprints[0].name, 'Kickoff');
  assert.strictEqual(first.body.sprints[0].endGoal, 'Ship v1');
  assert.strictEqual((await api('PATCH', `/api/sprints/${res.sprints[0].id}`, { endDate: '2026-11-01' })).status, 400, 'end before start');
  assert.strictEqual((await api('PATCH', `/api/sprints/${res.sprints[0].id}`, { name: '' })).status, 400);
});

test('resize shorter keeps end date and adds sprints; tasks stay put', async () => {
  const res = await newCycle('Resize short', chain('2026-12-01', 4, 7)); // 28 days, ends 12-28
  const t = await api('POST', '/api/tasks', { title: 'In sprint 4', sprintId: res.sprints[3].id, deadline: '2026-12-27' });
  assert.strictEqual(t.status, 201);
  const r = await api('POST', `/api/work-cycles/${res.workCycle.id}/resize-sprints`, { lengthDays: 5 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assertContiguous(r.body);
  assert.strictEqual(r.body.sprints.length, 6);
  assert.strictEqual(r.body.workCycle.endDate, '2026-12-28');
  assert.strictEqual(r.body.sprints[5].startDate, '2026-12-26');
  assert.strictEqual(r.body.sprints[5].endDate, '2026-12-28', 'last sprint is the 3-day remainder');
  assert.strictEqual(r.body.workCycle.sprintLengthDays, 5);
  assert.deepStrictEqual(r.body.sprints.slice(0, 4).map((s) => s.id), res.sprints.map((s) => s.id), 'existing sprint ids kept in order');
  const task = await api('GET', `/api/tasks/${t.body.id}`);
  assert.strictEqual(task.body.sprintId, res.sprints[3].id, 'task stays in its sprint');
  assert.strictEqual(task.body.deadline, '2026-12-27', 'deadline untouched');
  assert.strictEqual(r.body.tasksWithDeadlineOutsideSprint, 1, 'sprint 4 is now 12-16..12-20');
});

test('resize longer keeps sprint count and extends cycle', async () => {
  const res = await newCycle('Resize long', chain('2026-12-01', 4, 7));
  const r = await api('POST', `/api/work-cycles/${res.workCycle.id}/resize-sprints`, { lengthDays: 10 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assertContiguous(r.body);
  assert.strictEqual(r.body.sprints.length, 4);
  assert.strictEqual(r.body.workCycle.endDate, '2027-01-09');
  assert.strictEqual((await api('POST', `/api/work-cycles/${res.workCycle.id}/resize-sprints`, { lengthDays: 0 })).status, 400);
});

test('move task to next sprint and via sprintId', async () => {
  const a = await newCycle('Move A', chain('2026-12-01', 2, 7));
  const b = await newCycle('Move B', chain('2026-12-01', 1, 7));
  const t = await api('POST', '/api/tasks', { title: 'Carry over', sprintId: a.sprints[0].id, deadline: '2026-12-05' });
  const moved = await api('POST', `/api/tasks/${t.body.id}/move-to-next-sprint`);
  assert.strictEqual(moved.status, 200, JSON.stringify(moved.body));
  assert.strictEqual(moved.body.sprintId, a.sprints[1].id);
  assert.strictEqual(moved.body.deadline, '2026-12-08');
  assert.strictEqual((await api('POST', `/api/tasks/${t.body.id}/move-to-next-sprint`)).status, 400, 'already last');
  assert.strictEqual((await api('PATCH', `/api/tasks/${t.body.id}`, { sprintId: b.sprints[0].id })).status, 400, 'other cycle');
  const back = await api('PATCH', `/api/tasks/${t.body.id}`, { sprintId: a.sprints[0].id });
  assert.strictEqual(back.status, 200);
  assert.strictEqual(back.body.sprintId, a.sprints[0].id);
  assert.strictEqual(back.body.deadline, '2026-12-08', 'plain sprintId move keeps deadline');
});

test('task optional fields can be set and cleared', async () => {
  const a = await newCycle('Fields', chain('2026-12-01', 1, 7));
  const t = await api('POST', '/api/tasks', {
    title: 'Full', sprintId: a.sprints[0].id, description: 'x', deadline: '2026-12-03',
    estimatedHours: 2, effort: 'High', status: 'Blocked', blockerReason: 'waiting',
  });
  assert.strictEqual(t.status, 201);
  assert.strictEqual(t.body.blockerReason, 'waiting');
  const c = await api('PATCH', `/api/tasks/${t.body.id}`, { deadline: null, estimatedHours: null, effort: null, status: null });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  assert.strictEqual(c.body.deadline, null);
  assert.strictEqual(c.body.estimatedHours, null);
  assert.strictEqual(c.body.effort, null);
  assert.strictEqual(c.body.statusId, null);
});
