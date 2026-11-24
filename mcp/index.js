#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Environment variables
const TASKTRACKER_URL = process.env.TASKTRACKER_URL;
const TASKTRACKER_KEY = process.env.TASKTRACKER_KEY;

// Create MCP server
const server = new McpServer(
  { name: 'task-tracker', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// Helper to make API calls to the Task Tracker server
async function api(method, path, body) {
  const url = `${TASKTRACKER_URL.replace(/\/+$/, '')}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TASKTRACKER_KEY}`,
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    return { isError: true, error: `Could not reach ${TASKTRACKER_URL}: ${err.message}` };
  }
  if (!response.ok) {
    const errorText = await response.text();
    return { isError: true, error: errorText || `HTTP ${response.status}` };
  }
  return await response.json();
}

// Helper to format tool result
function formatResult(data) {
  if (data && data.isError) {
    return { content: [{ type: 'text', text: String(data.error) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

// Check env vars on tool call (not at startup)
function checkEnvVars() {
  if (!TASKTRACKER_URL) {
    return { isError: true, error: 'TASKTRACKER_URL environment variable is not set. Set it to your Task Tracker server URL (e.g., https://tasks.example.com).' };
  }
  if (!TASKTRACKER_KEY) {
    return { isError: true, error: 'TASKTRACKER_KEY environment variable is not set. Set it to your Task Tracker API key.' };
  }
  return null;
}

// Tool: list_statuses - GET /api/statuses
server.registerTool(
  'list_statuses',
  {
    description: 'List all available task statuses (default and custom per work cycle)',
  },
  async () => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('GET', '/api/statuses');
    return formatResult(result);
  }
);

// Tool: list_work_cycles - GET /api/work-cycles
server.registerTool(
  'list_work_cycles',
  {
    description: 'List all work cycles',
  },
  async () => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('GET', '/api/work-cycles');
    return formatResult(result);
  }
);

// Tool: list_sprints - GET /api/sprints?workCycleId=
server.registerTool(
  'list_sprints',
  {
    description: 'List all sprints for a given work cycle',
    inputSchema: {
      workCycleId: z.string().describe('The ID of the work cycle'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('GET', `/api/sprints?workCycleId=${encodeURIComponent(args.workCycleId)}`);
    return formatResult(result);
  }
);

// Tool: list_tasks - GET /api/tasks with optional filters
server.registerTool(
  'list_tasks',
  {
    description: 'List tasks with optional filters (status, workCycleId, sprintId, completed, dueBefore)',
    inputSchema: {
      status: z.string().optional().describe('Filter by status name or ID'),
      workCycleId: z.string().optional().describe('Filter by work cycle ID'),
      sprintId: z.string().optional().describe('Filter by sprint ID'),
      completed: z.boolean().optional().describe('Filter by completion status'),
      dueBefore: z.string().optional().describe('Filter by due date (YYYY-MM-DD format)'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);

    const params = new URLSearchParams();
    if (args.status) params.append('status', args.status);
    if (args.workCycleId) params.append('workCycleId', args.workCycleId);
    if (args.sprintId) params.append('sprintId', args.sprintId);
    if (args.completed !== undefined) params.append('completed', String(args.completed));
    if (args.dueBefore) params.append('due_before', args.dueBefore);

    const url = `/api/tasks${params.toString() ? '?' + params.toString() : ''}`;
    const result = await api('GET', url);

    // Format result to include only specified fields
    if (!result.isError && Array.isArray(result)) {
      const compactResult = result.map(task => ({
        id: task.id,
        title: task.title,
        statusName: task.statusName,
        completed: task.completed,
        deadline: task.deadline,
        sprintName: task.sprintName,
        workCycleName: task.workCycleName,
        effort: task.effort,
      }));
      return formatResult(compactResult);
    }
    return formatResult(result);
  }
);

// Tool: get_task - GET /api/tasks/:id
server.registerTool(
  'get_task',
  {
    description: 'Get a specific task by ID',
    inputSchema: {
      id: z.string().describe('The task ID'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('GET', `/api/tasks/${encodeURIComponent(args.id)}`);
    return formatResult(result);
  }
);

// Tool: create_task - POST /api/tasks
server.registerTool(
  'create_task',
  {
    description: 'Create a new task in a sprint',
    inputSchema: {
      title: z.string().min(1).describe('The task title (required)'),
      sprintId: z.string().describe('The sprint ID to create the task in (required)'),
      description: z.string().optional().describe('Optional task description'),
      deadline: z.string().optional().describe('Optional deadline (YYYY-MM-DD or ISO string)'),
      estimatedHours: z.number().optional().describe('Optional estimated hours'),
      effort: z.enum(['Low', 'Medium', 'High']).optional().describe('Optional effort level'),
      status: z.string().optional().describe('Optional status name or ID'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const body = {
      title: args.title,
      sprintId: args.sprintId,
      description: args.description,
      deadline: args.deadline,
      estimatedHours: args.estimatedHours,
      effort: args.effort,
      status: args.status,
    };
    const result = await api('POST', '/api/tasks', body);
    return formatResult(result);
  }
);

// Tool: update_task - PATCH /api/tasks/:id
server.registerTool(
  'update_task',
  {
    description: 'Update a task (any combination of fields)',
    inputSchema: {
      id: z.string().describe('The task ID (required)'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      deadline: z.string().optional().describe('New deadline'),
      estimatedHours: z.number().optional().describe('New estimated hours'),
      effort: z.enum(['Low', 'Medium', 'High']).optional().describe('New effort level'),
      status: z.string().optional().describe('New status name or ID'),
      blockerReason: z.string().optional().describe('New blocker reason'),
      completed: z.boolean().optional().describe('Set completion status'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const body = {
      title: args.title,
      description: args.description,
      deadline: args.deadline,
      estimatedHours: args.estimatedHours,
      effort: args.effort,
      status: args.status,
      blockerReason: args.blockerReason,
      completed: args.completed,
    };
    const result = await api('PATCH', `/api/tasks/${encodeURIComponent(args.id)}`, body);
    return formatResult(result);
  }
);

// Tool: complete_task - PATCH /api/tasks/:id with completed:true
server.registerTool(
  'complete_task',
  {
    description: 'Mark a task as completed',
    inputSchema: {
      id: z.string().describe('The task ID'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('PATCH', `/api/tasks/${encodeURIComponent(args.id)}`, { completed: true });
    return formatResult(result);
  }
);

// Tool: reopen_task - PATCH /api/tasks/:id with completed:false
server.registerTool(
  'reopen_task',
  {
    description: 'Reopen a completed task',
    inputSchema: {
      id: z.string().describe('The task ID'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('PATCH', `/api/tasks/${encodeURIComponent(args.id)}`, { completed: false });
    return formatResult(result);
  }
);

// Tool: delete_task - DELETE /api/tasks/:id
server.registerTool(
  'delete_task',
  {
    description: 'Delete (tombstone) a task',
    inputSchema: {
      id: z.string().describe('The task ID'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('DELETE', `/api/tasks/${encodeURIComponent(args.id)}`);
    return formatResult(result);
  }
);

// Tool: changes_since - GET /api/changes?since=
server.registerTool(
  'changes_since',
  {
    description: 'Get changes (tasks, work cycles, sprints) since an ISO timestamp',
    inputSchema: {
      since: z.string().describe('ISO timestamp to get changes since'),
    },
  },
  async (args) => {
    const envError = checkEnvVars();
    if (envError) return formatResult(envError);
    const result = await api('GET', `/api/changes?since=${encodeURIComponent(args.since)}`);
    return formatResult(result);
  }
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
