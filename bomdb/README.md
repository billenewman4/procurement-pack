# bomdb — the BOM store engine

The shared engine behind both deployment shapes: this directory's **stdio
server** (local dev/offline use) and `../bomdb-remote` (the **hosted
connector** every normal user is on — see its README). Same
`operations.ts`/`engine.ts` either way; the schema is `../SCHEMA.md`.
Local-first by default — a real Postgres via PGLite at `~/.bomdb/data`, no
server process to manage; set `DATABASE_URL` and the identical code runs
against hosted Postgres.

## The 12 ops

- `create_project`, `list_projects` — projects
- `upsert_spec` — one spec row per (project, category), replace on conflict
- `get_project_context` — project + specs + line items in one call (read this
  before searching for parts)
- `upsert_line_item` — create or update; status changes are refused here
- `update_status` — forward moves (`needed → researching → ordered → shipped →
  delivered`) are automatic; backward moves and any move to or from `issue`
  require `confirmed: true`
- `set_outcome` — worked / failed / returned, with notes
- `record_order_event` — email-derived events; auto-advances the matched line
  item forward only, flags anomalies (backward or cross-project) instead
- `stale_orders` — ordered items with no event in N days
- `get_dashboard_data` — per-project aggregates (status counts, committed
  spend, spec coverage, stale items, recent events) for the bom-dashboard
  artifact
- `export_json`, `import_json` — `bom.json` round-trip with the local store

Errors come back as `{ "error": "..." }` with `isError` set — never a throw.

## Local vs hosted

- Default: PGLite at `~/.bomdb/data` (override with `BOMDB_DATA_DIR`)
- Set `DATABASE_URL` and the same server runs against hosted Postgres instead

## Register with Claude Code (local dev only)

Normal users don't do this — they use the hosted connector
(`../TEAM_SETUP.md`). For local development on this machine:

```bash
claude mcp add --scope user bomdb -- node /absolute/path/to/procurement-pack/bomdb/src/server.ts
claude mcp list   # expect: bomdb ... Connected
```

Don't run this alongside the hosted connector on the same surface —
duplicate toolsets confuse tool selection.

## Tests

```bash
npm test            # node --test, in-memory PGLite
npm run typecheck   # tsc
```

Requires Node >= 23.6 (runs TypeScript directly, no build step).
