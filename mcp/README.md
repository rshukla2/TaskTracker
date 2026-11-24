# Task Tracker MCP Server

A Model Context Protocol (MCP) server for the Task Tracker API. This server wraps the Task Tracker Agent API endpoints to provide tools that can be used by AI agents (like Claude Code).

## Setup

Set the following environment variables:

- `TASKTRACKER_URL` - The URL of your Task Tracker server (e.g., `https://tasks.example.com`)
- `TASKTRACKER_KEY` - Your Task Tracker API key (SYNC_KEY)

## Installation

```bash
cd mcp
npm install
```

## Usage

Add to Claude Code:

```bash
claude mcp add tasktracker -e TASKTRACKER_URL=https://your-server -e TASKTRACKER_KEY=your-key -- node /absolute/path/to/mcp/index.js
```

Or with npx (once published):

```bash
claude mcp add tasktracker -e TASKTRACKER_URL=https://your-server -e TASKTRACKER_KEY=your-key -- npx task-tracker-mcp
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_statuses` | List all available task statuses |
| `list_work_cycles` | List all work cycles |
| `list_sprints` | List sprints for a work cycle (requires `workCycleId`) |
| `list_tasks` | List tasks with optional filters |
| `get_task` | Get a specific task by ID |
| `create_task` | Create a new task in a sprint |
| `update_task` | Update a task with any combination of fields |
| `complete_task` | Mark a task as completed |
| `reopen_task` | Reopen a completed task |
| `delete_task` | Delete (tombstone) a task |
| `changes_since` | Get changes since an ISO timestamp |
