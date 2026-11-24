# Task Tracker Sync + Agent API — Spec (v1)

Decided 2026-11-24. Sync is for Rishi only, "bring your own server": the app ships with sync OFF;
a user turns it on by entering a server URL + key. The developer never receives anyone's data.

## Parts
1. `server/` — small Node API (Express + better-sqlite3), runs in Docker on Oracle `rishicloud`
   behind the existing Caddy at `https://tasks.rishishukla.ai`.
2. App sync client — `src/core/sync.ts` + Settings "Sync" section.
3. Privacy updates (policy page, review notes).
4. `mcp/` — MCP server (stdio, Node, `@modelcontextprotocol/sdk`) wrapping the Agent endpoints.
   Generic: reads `TASKTRACKER_URL` + `TASKTRACKER_KEY` from env, so anyone can point it at their
   own server. No changes to the server or app needed for it.

## MCP tools (part 4)
`list_statuses`, `list_work_cycles`, `list_sprints(workCycleId?)`,
`list_tasks(status?, workCycleId?, sprintId?, completed?, dueBefore?)`, `get_task(id)`,
`create_task(title, sprintId, description?, deadline?, estimatedHours?, effort?, status?)`,
`update_task(id, title?, description?, deadline?, estimatedHours?, effort?, status?, blockerReason?)`,
`complete_task(id)` (= update status to Completed), `delete_task(id)`, `changes_since(since)`.
Each tool calls the matching endpoint and returns compact JSON; API errors come back as tool
errors with the server's message. README shows how to add it to Claude Code
(`claude mcp add tasktracker -e TASKTRACKER_URL=... -e TASKTRACKER_KEY=... -- node <path>/mcp/index.js`).

## Auth
- Single secret `SYNC_KEY` (env var, 32+ random chars). Every request: `Authorization: Bearer <key>`.
  Compare in constant time. 401 otherwise. `/health` is public.
- CORS: allow origins `https://rshukla2.github.io`, `capacitor://localhost`, `http://localhost`,
  `https://localhost`, `http://localhost:3000`. Methods GET, POST, PATCH, DELETE, OPTIONS.

## Server data model (SQLite)
Table `entities`: `kind` ('settings'|'workCycle'|'sprint'|'task'), `id`, `data` (JSON text),
`updatedAt` (ISO), `deleted` (0/1), `seq` (integer, global, increases on every write).
Primary key (kind, id). `seq` comes from a single counter so clients can pull "everything after N"
without trusting clocks.

## Sync endpoints (used by the app)
- `POST /api/sync/push` body `{ changes: [{ kind, id, data|null, updatedAt, deleted }] }`
  For each: write only if incoming `updatedAt` > stored `updatedAt` (last write wins; tie = keep stored).
  Deleting a workCycle also tombstones its sprints and tasks. Returns `{ applied, skipped, seq }`.
- `GET /api/sync/pull?since=<seq>` → `{ changes: [...same shape, with seq], seq: <max seq> }`.
- `GET /api/sync/snapshot` → full non-deleted workspace + current seq (first-time sync).

## Agent endpoints (friendly, for AI agents / n8n)
- `GET /api/statuses` — default statuses + each work cycle's custom statuses.
- `GET /api/work-cycles`, `GET /api/sprints?workCycleId=`
- `GET /api/tasks?status=<name|id>&workCycleId=&sprintId=&completed=true|false&due_before=YYYY-MM-DD`
  Each task includes `statusName`, `sprintName`, `workCycleName`.
- `GET /api/tasks/:id`
- `POST /api/tasks` — needs `title`, `sprintId` (workCycleId taken from sprint); optional
  description, deadline, estimatedHours, effort (Low|Medium|High), status (name or id).
  Server generates id + timestamps (same id format as `createId` in src/core/scheduling.ts).
- `PATCH /api/tasks/:id` — any of title, description, deadline, estimatedHours, effort,
  status (name or id), blockerReason. Status rules must mirror the app (src/core/statuses.ts,
  src/state/WorkspaceContext.tsx): completed status = id `status-completed` or name "Completed"
  (findCompletedStatus) → set `completed=true`, `completedAt=now`; moving off it → `completed=false`,
  `completedAt=null`; keep `previousStatusId` the way the app does. Statuses resolved against the
  task's work cycle (custom statuses if `useCustomStatuses`, else defaults). Unknown status → 400
  listing valid names.
- `DELETE /api/tasks/:id` — tombstone.
- `GET /api/changes?since=<ISO>` — tasks updated since a time (for "what changed").
Every agent write bumps `updatedAt` and `seq` so the app pulls it.

## App sync client
- Settings → "Sync (optional)": Server URL, Sync key, On/Off toggle, "Sync now", last-synced time,
  "Delete cloud copy" (calls `DELETE /api/sync/all`). Stored locally (Capacitor Preferences or the
  existing native JSON / localStorage on web) — never in backups/exports.
- Local outbox: every save/delete in src/core/db.ts records `{kind,id}` as dirty (deletes as
  tombstones, incl. cascade deletes). Sync = push dirty items → clear on success → pull since
  `lastSeq` → apply with last-write-wins on `updatedAt` → reload WorkspaceContext state.
- First enable: if server empty → push everything; else pull snapshot and merge (LWW per item).
- Triggers: app start, return to foreground (`visibilitychange`), 3 s after any local change,
  every 60 s while visible, "Sync now". Offline/errors: keep outbox, show small status, retry later.
- When sync is off, app behaves exactly as today (no network calls).
- Web (GitHub Pages) uses the same code; same URL + key gives the same data.

## Deployment (Oracle)
- `~/tasksync` on rishicloud: docker compose, joins the existing n8n Docker network, volume for
  the SQLite file, `SYNC_KEY` in `.env`.
- Add `tasks.rishishukla.ai { reverse_proxy tasksync:8787 }` to the n8n Caddyfile; DNS A record.
- Add the SQLite file to the Sunday backup; add `/health` to UptimeRobot.

## Privacy / store
- Policy: replace "no backend" wording with: sync is optional and off by default; when the user
  turns it on, data is sent over HTTPS only to the server the user enters; the developer runs no
  sync service for users and receives no data; turning sync off / "Delete cloud copy".
- App Privacy labels can stay "Data Not Collected" (data goes only to a server the user controls,
  not to the developer). Review note: "Optional sync to a user-provided server; off by default; no
  account needed."
- Google Play Data safety: same reasoning; re-check the form.

## Tests
- server: node test for push/pull LWW, tombstone cascade, status → completed rules, auth 401.
- app: extend test/ with pure sync-merge tests (LWW apply, outbox).
