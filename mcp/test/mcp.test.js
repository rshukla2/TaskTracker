import { spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import assert from 'node:assert';

// Sync server config
const SYNC_KEY = 'mcp-test-key-1234567890';
let PORT; // Random port assigned at runtime
const DB_PATH = '/tmp/task-tracker-mcp-test-' + Date.now() + '.db';

// MCP server config
const MCP_SERVER_PATH = new URL('../index.js', import.meta.url).pathname;
let TASKTRACKER_URL; // Set in before()

// Spawn the sync server
let syncServerProcess;
let syncServerReady = false;

before(async () => {
  // Clean up any existing test DB (just in case)
  const { spawnSync } = await import('node:child_process');
  spawnSync('rm', ['-f', '/tmp/task-tracker-mcp-test-*.db']);

  // Find a free port
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, () => {
      PORT = server.address().port;
      TASKTRACKER_URL = `http://localhost:${PORT}`;
      server.close(resolve);
    });
    server.on('error', reject);
  });

  // Start sync server
  const serverPath = new URL('../../server/index.js', import.meta.url).pathname;
  syncServerProcess = spawn('node', [serverPath], {
    env: { ...process.env, SYNC_KEY, PORT: String(PORT), DB_PATH },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for server to be ready
  syncServerProcess.stdout.on('data', (data) => {
    if (data.toString().includes('Server running')) {
      syncServerReady = true;
    }
  });

  // Wait a bit for server to start
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!syncServerReady) {
    // Try one more time with output
    const response = await fetch(`${TASKTRACKER_URL}/health`);
    if (!response?.ok) {
      throw new Error('Sync server failed to start');
    }
  }
});

after(async () => {
  if (syncServerProcess) {
    syncServerProcess.kill();
  }
  // Clean up test DB
  const { spawnSync } = await import('node:child_process');
  spawnSync('rm', ['-f', '/tmp/task-tracker-mcp-test-*.db']);
});

describe('Task Tracker MCP Server', () => {
  let transport;
  let client;

  before(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: [MCP_SERVER_PATH],
      env: { ...process.env, TASKTRACKER_URL, TASKTRACKER_KEY: SYNC_KEY },
    });

    // Create client from transport
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
  });

  after(async () => {
    if (client) {
      await client.close();
    }
    if (transport) {
      await transport.close();
    }
  });

  it('should list tools and include all required tools', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    const requiredTools = [
      'list_statuses',
      'list_work_cycles',
      'list_sprints',
      'list_tasks',
      'get_task',
      'create_task',
      'update_task',
      'complete_task',
      'reopen_task',
      'delete_task',
      'changes_since',
    ];
    for (const tool of requiredTools) {
      assert.ok(toolNames.includes(tool), `Tool ${tool} should be registered`);
    }
  });

  it('should list work cycles', async () => {
    const result = await client.callTool({ name: 'list_work_cycles' });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(Array.isArray(data));
  });

  it('should push a work cycle via fetch', async () => {
    const response = await fetch(`${TASKTRACKER_URL}/api/sync/push`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SYNC_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{
          kind: 'workCycle',
          id: 'test-wc-1',
          data: {
            id: 'test-wc-1',
            name: 'Test Work Cycle',
            createdAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
          deleted: false,
        }],
      }),
    });
    assert.ok(response.ok);
  });

  it('should push a sprint via fetch', async () => {
    const response = await fetch(`${TASKTRACKER_URL}/api/sync/push`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SYNC_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{
          kind: 'sprint',
          id: 'test-sprint-1',
          data: {
            id: 'test-sprint-1',
            name: 'Test Sprint',
            workCycleId: 'test-wc-1',
            createdAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
          deleted: false,
        }],
      }),
    });
    assert.ok(response.ok);
  });

  it('should list sprints for the test work cycle', async () => {
    const result = await client.callTool({ name: 'list_sprints', arguments: { workCycleId: 'test-wc-1' } });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
    assert.equal(data[0].id, 'test-sprint-1');
  });

  it('should create a task via MCP', async () => {
    const result = await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Test Task',
        sprintId: 'test-sprint-1',
        description: 'A test task for MCP',
        estimatedHours: 4,
        effort: 'Medium',
      },
    });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(data.id);
    assert.equal(data.title, 'Test Task');
    assert.equal(data.sprintId, 'test-sprint-1');
  });

  it('should list tasks and find the created task', async () => {
    const result = await client.callTool({ name: 'list_tasks' });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(Array.isArray(data));
    const task = data.find((t) => t.title === 'Test Task');
    assert.ok(task);
    // statusName is null when no status is set, which is the default
    assert.equal(task.completed, false);
    // Check compact fields
    assert.ok('id' in task);
    assert.ok('title' in task);
    assert.ok('statusName' in task);
    assert.ok('completed' in task);
    assert.ok('deadline' in task);
    assert.ok('sprintName' in task);
    assert.ok('workCycleName' in task);
    assert.ok('effort' in task);
  });

  it('should get a specific task', async () => {
    // First get the task ID from list_tasks
    const listResult = await client.callTool({ name: 'list_tasks' });
    const listText = listResult.content[0].text || '';
    const listData = JSON.parse(listText);
    const task = listData.find((t) => t.title === 'Test Task');
    assert.ok(task);

    const result = await client.callTool({ name: 'get_task', arguments: { id: task.id } });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.equal(data.id, task.id);
    assert.equal(data.title, 'Test Task');
  });

  it('should complete a task', async () => {
    // First get the task ID
    const listResult = await client.callTool({ name: 'list_tasks' });
    const listText = listResult.content[0].text || '';
    const listData = JSON.parse(listText);
    const task = listData.find((t) => t.title === 'Test Task');
    assert.ok(task);

    const result = await client.callTool({ name: 'complete_task', arguments: { id: task.id } });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.equal(data.completed, true);
    assert.ok(data.completedAt);
  });

  it('should reopen a completed task', async () => {
    // First get the task ID (it should be completed now)
    const listResult = await client.callTool({ name: 'list_tasks' });
    const listText = listResult.content[0].text || '';
    const listData = JSON.parse(listText);
    const task = listData.find((t) => t.title === 'Test Task');
    assert.ok(task);
    assert.equal(task.completed, true);

    const result = await client.callTool({ name: 'reopen_task', arguments: { id: task.id } });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.equal(data.completed, false);
    assert.equal(data.completedAt, null);
  });

  it('should update a task', async () => {
    // First get the task ID
    const listResult = await client.callTool({ name: 'list_tasks' });
    const listText = listResult.content[0].text || '';
    const listData = JSON.parse(listText);
    const task = listData.find((t) => t.title === 'Test Task');
    assert.ok(task);

    const result = await client.callTool({
      name: 'update_task',
      arguments: {
        id: task.id,
        title: 'Updated Test Task',
        description: 'Updated description',
      },
    });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.equal(data.title, 'Updated Test Task');
    assert.equal(data.description, 'Updated description');
  });

  it('should delete a task', async () => {
    // First get the task ID
    const listResult = await client.callTool({ name: 'list_tasks' });
    const listText = listResult.content[0].text || '';
    const listData = JSON.parse(listText);
    const task = listData.find((t) => t.title === 'Updated Test Task');
    assert.ok(task);

    const result = await client.callTool({ name: 'delete_task', arguments: { id: task.id } });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(data.message);
  });

  it('should return error when getting deleted task', async () => {
    const result = await client.callTool({ name: 'get_task', arguments: { id: 'non-existent-id' } });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(data.error || data.isError);
  });

  it('should list changes since', async () => {
    const result = await client.callTool({
      name: 'changes_since',
      arguments: { since: '2024-01-01T00:00:00.000Z' },
    });
    assert.ok(result.content);
    const text = result.content[0].text || '';
    const data = JSON.parse(text);
    assert.ok(data.changes);
    assert.ok(Array.isArray(data.changes));
  });

  // Note: env var validation is done at MCP server startup in index.js
  // This test would require spawning a new MCP server without env vars
  // For now, we just verify the server works when env vars are present
});
