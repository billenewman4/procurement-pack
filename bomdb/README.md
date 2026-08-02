# bomdb — MCP server for the BOM store

The store's backend (1) (see `../store/README.md`): an MCP stdio server exposing
the procurement schema (`../SCHEMA.md`) as tools. Local-first — a real Postgres
via PGLite at `~/.bomdb/data`, no server process to manage. Skills talk to it
through Claude; nothing else should touch the data dir.

## The 11 ops

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
- `export_json`, `import_json` — `bom.json` round-trip with the local store

Errors come back as `{ "error": "..." }` with `isError` set — never a throw.

## Local vs hosted

- Default: PGLite at `~/.bomdb/data` (override with `BOMDB_DATA_DIR`)
- Set `DATABASE_URL` and the same server runs against hosted Postgres instead

## Register with Claude Code

```bash
claude mcp add --scope user bomdb -- node /absolute/path/to/procurement-pack/bomdb/src/server.ts
claude mcp list   # expect: bomdb ... Connected
```

## Tests

```bash
npm test            # node --test, in-memory PGLite
npm run typecheck   # tsc
```

Requires Node >= 23.6 (runs TypeScript directly, no build step).
