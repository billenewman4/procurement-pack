# bomdb — the BOM store engine

The shared engine behind both deployment shapes: this directory's **stdio
server** (local dev/offline use) and `../bomdb-remote` (the **hosted
connector** every normal user is on — see its README). Same
`operations.ts`/`engine.ts` either way; the schema is `../SCHEMA.md`.
Local-first by default — a real Postgres via PGLite at `~/.bomdb/data`, no
server process to manage; set `DATABASE_URL` and the identical code runs
against hosted Postgres.

## The ops

- `create_project`, `list_projects`, `rename_project` — projects
- `upsert_spec` — one spec row per (project, category), replace on conflict
- `get_project_context` — project + specs + line items in one call (read this
  before searching for parts)
- `upsert_vendor`, `list_vendors` — the vendor CRM: match by name or email
  domain, merge domains; list with per-vendor parts (incl. historical), open
  items, last activity
- `upsert_line_item` — create or update; status changes are refused here; a
  vendor name auto-links the vendor CRM; omit `project_id` for a one-off
  master-list part
- `set_item_active` — hide a replaced part without deleting its history
- `update_status` — forward moves (`researching → rfq → po_placed →
  delivered`) are automatic; backward moves require `confirmed: true`.
  Shipping and issues are NOT statuses — they live in `order_events`
- `set_outcome` — worked / failed / returned, with notes
- `record_order_event` — email-derived events, the sole home of
  shipped/issue; auto-advances the matched line item forward only, flags
  anomalies (backward or cross-project) instead
- `stale_orders` — po_placed items with no event in N days
- `get_dashboard_data` — per-project aggregates (status buckets, committed
  spend, spec coverage, open issues derived from events, stale items, recent
  events) plus the vendor rollup and one-off parts, for the bom-dashboard
  artifact
- `export_json`, `import_json` — `bom.json` round-trip with the local store
  (legacy statuses remap on import)

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
