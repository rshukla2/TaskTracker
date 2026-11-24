# TaskSync Server

A lightweight Node.js API server for syncing task data across devices. Uses Express + better-sqlite3.

## Features

- **Auth**: Bearer token authentication with `SYNC_KEY` env var
- **Sync**: Push/pull changes with last-write-wins conflict resolution
- **Snapshot**: Full workspace export for first-time sync
- **Agent API**: Human-friendly CRUD for work cycles, sprints, and tasks
- **SQL storage**: SQLite with sequential seq numbers for reliable delta sync

## Setup

1. Copy `.env.example` to `.env` and set your `SYNC_KEY`:
   ```bash
   cp .env.example .env
   # Edit .env and set SYNC_KEY to a random 32+ char string
   ```

2. Run with Docker:
   ```bash
   docker-compose up -d
   ```

Or run directly:
```bash
npm install
PORT=8787 SYNC_KEY=your-key node index.js
```

## API Endpoints

### Public
- `GET /health` - Health check

### Sync (app)
All require `Authorization: Bearer <SYNC_KEY>` header.

- `POST /api/sync/push` - Push changes (last-write-wins)
- `GET /api/sync/pull?since=<seq>` - Pull changes since seq
- `GET /api/sync/snapshot` - Full non-deleted workspace + seq
- `DELETE /api/sync/all` - Delete all data

### Agent (AI/n8n)
- `GET /api/statuses` - Default + custom statuses
- `GET /api/work-cycles` - List work cycles
- `GET /api/sprints?workCycleId=<id>` - Sprints for cycle
- `GET /api/tasks?status=&workCycleId=&sprintId=&completed=&due_before=` - Tasks with filters
- `GET /api/tasks/:id` - Get task by ID
- `POST /api/tasks` - Create task (needs `title`, `sprintId`)
- `PATCH /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Tombstone task
- `GET /api/changes?since=<ISO>` - Changes since time

## Examples

```bash
# Health check (no auth)
curl http://localhost:8787/health

# Push changes
curl -X POST http://localhost:8787/api/sync/push \
  -H "Authorization: Bearer your-sync-key" \
  -H "Content-Type: application/json" \
  -d '{
    "changes": [
      {
        "kind": "task",
        "id": "abc123",
        "data": {"title": "My task", "sprintId": "sprint1", "workCycleId": "cycle1"},
        "updatedAt": "2025-01-01T00:00:00.000Z",
        "deleted": 0
      }
    ]
  }'

# Pull changes since seq 5
curl http://localhost:8787/api/sync/pull?since=5 \
  -H "Authorization: Bearer your-sync-key"

# Create a task
curl -X POST http://localhost:8787/api/tasks \
  -H "Authorization: Bearer your-sync-key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Do the thing",
    "sprintId": "sprint-abc123"
  }'

# Update task status (marks completed if status is "Completed")
curl -X PATCH http://localhost:8787/api/tasks/task-xyz \
  -H "Authorization: Bearer your-sync-key" \
  -H "Content-Type: application/json" \
  -d '{"status": "Completed"}'
```

## Data Model

SQLite table `entities`:
- `kind` - 'settings'|'workCycle'|'sprint'|'task'
- `id` - UUID string
- `data` - JSON text
- `updatedAt` - ISO 8601 string
- `deleted` - 0/1
- `seq` - Auto-increment integer

Clients use `seq` for delta sync (`pull?since=<last-seq>`).
