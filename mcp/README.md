# Task Tracker MCP Server

A Model Context Protocol (MCP) server for the Task Tracker API. This server wraps the Task Tracker Agent API endpoints to provide tools that can be used by AI agents (like Claude Code).

Version: 0.2.0

## Setup

Set the following environment variables:

- `TASKTRACKER_URL` - The URL of your Task Tracker server (e.g., `https://tasks.example.com`)
- `TASKTRACKER_KEY` - Your Task Tracker API key (SYNC_KEY)

Full guide: https://rshukla2.github.io/TaskTracker/connect-ai/

## Installation (from source)

```bash
cd mcp
npm install
```

## Usage

Add to Claude Code:

```bash
claude mcp add tasktracker -e TASKTRACKER_URL=https://your-server -e TASKTRACKER_KEY=your-key -- node /absolute/path/to/mcp/index.js
```

Or with npx (no install needed):

```bash
claude mcp add tasktracker -e TASKTRACKER_URL=https://your-server -e TASKTRACKER_KEY=your-key -- npx -y @rishishukla2k/task-tracker-mcp
```

## Available Tools

### Read tools

| Tool | Description |
|------|-------------|
| `list_statuses` | List all available task statuses |
| `list_work_cycles` | List all work cycles |
| `list_sprints` | List sprints for a work cycle (requires `workCycleId`) |
| `list_tasks` | List tasks with optional filters |
| `get_task` | Get a specific task by ID |
| `changes_since` | Changes (tasks, work cycles, sprints) since an ISO timestamp |

### Tasks

| Tool | Description |
|------|-------------|
| `create_task` | Create a new task in a sprint (title, description, deadline, hours, effort, status, blocker reason) |
| `update_task` | Update any task field; all fields except title are optional (set to null to clear) |
| `complete_task` | Mark a task as completed |
| `reopen_task` | Reopen a completed task |
| `move_task_to_next_sprint` | Move task to next sprint and set deadline to that sprint's start date |
| `delete_task` | Delete (tombstone) a task |

### Work cycles

| Tool | Description |
|------|-------------|
| `create_work_cycle` | Create a work cycle with one or more sprints (dates derived from sprints) |
| `update_work_cycle` | Update name, description, or end goal (dates cannot be changed here) |

### Sprints

| Tool | Description |
|------|-------------|
| `create_sprint` | Add a sprint (specify length or end date; optional insert position) |
| `update_sprint` | Update name, end goal, or dates |
| `resize_sprints` | Give every sprint a new length (shorter: adds sprints to keep the cycle end date; longer: same number of sprints, cycle extends) |

## How dates work

Sprints are always back to back: each sprint starts the day after the previous one ends. Work cycle dates are derived from their sprints and cannot be set directly.

- **Adding a sprint** shifts all later sprints later; cycle end grows
- **Shrinking a sprint** shifts later sprints earlier; cycle end shrinks
- **Resizing** to shorter creates more sprints to keep the cycle end; resizing to longer extends the cycle
- **Default names** (Sprint 1, Sprint 2, etc.) are renumbered when a sprint is inserted
- **Task deadlines** are never moved automatically; use `move_task_to_next_sprint` to set a deadline to the next sprint's start date
- **No deletes** for work cycles or sprints
