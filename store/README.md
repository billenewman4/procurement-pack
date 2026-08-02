# Store protocol — works with or without the hosted database

Skills never talk to "the database" directly; they talk to **the store**, resolved
in this order:

1. **bomdb MCP** (`bomdb/` in this repo) — if the connector is available.
   Local-first: a real Postgres via PGLite at `~/.bomdb/data`, no server to run;
   setting `DATABASE_URL` flips the same server to hosted Postgres.
2. **Local store** — `~/.procurement-pack/<project-slug>/bom.json` (this spec)
3. Neither → ask the user for context, operate read-only, warn that nothing persists

Both backends hold identical shapes (see ../SCHEMA.md), so migration is
mechanical: read `bom.json`, INSERT rows, done. Build everything against the
local store now; nothing about the skills changes when the MCP lands.

## bom.json structure

```json
{
  "project": { "id": "p1", "name": "arduino-dogfood", "created_at": "2026-07-31" },
  "specs": [
    { "id": "s1", "category": "power", "spec": "12V rail, max 3A; barrel jack in",
      "updated_at": "2026-07-31" }
  ],
  "line_items": [
    { "id": "li1", "description": "step-down converter 12V→5V 3A",
      "part_number": null, "vendor": "Amazon", "product_url": null,
      "qty": 2, "unit_price": 11.99, "status": "ordered", "source": "search",
      "ordered_at": "2026-07-31", "eta": "2026-08-02", "notes": null }
  ],
  "order_events": [
    { "id": "oe1", "line_item_id": "li1", "vendor": "Amazon",
      "order_number": "112-4477", "event": "confirmed",
      "event_at": "2026-07-31T18:04:00Z", "tracking_url": null,
      "email_ref": null, "raw_summary": "Amazon order 112-4477 confirmed" }
  ],
  "last_email_sync": "2026-07-31T18:00:00Z"
}
```

## Rules (same as the hosted DB)

- Claude is the only writer. Read the whole file, modify, write the whole file.
- IDs: short unique strings; never reuse.
- Status moves forward only (`needed → researching → ordered → shipped →
  delivered`); anything backward or to `issue` needs user confirmation.
- `last_email_sync` replaces the SQL `max(order_events.event_at)` lookup.

## Why JSON and not SQLite/PGLite for the fallback

A BOM is tens of rows; every query the skills need ("stale orders", "vendors in
play") is trivial at that scale, and JSON keeps end-user install friction at
zero. If the local mode ever needs real SQL, PGLite (Postgres-in-process, no
server — the gbrain approach) is the upgrade path, not SQLite, so the schema
stays Postgres-identical.
