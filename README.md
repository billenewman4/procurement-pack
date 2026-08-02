# Procurement Pack

Claude extension pack for hardware procurement: context-aware part search, BOM/order
tracking in a shared Postgres, and Gmail-driven order status updates.

## Install (paste this into Claude Code or Cowork)

> Fetch https://raw.githubusercontent.com/billenewman4/procurement-pack/main/INSTALL_FOR_AGENTS.md
> and follow it to set up the procurement pack for me.

That's the entire setup — your Claude does the rest (~5 minutes, two questions).

## Architecture

```
                    ┌────────────┐
   Gmail (skill +   │            │   Search (skill)
   sched. task) ───▶│   Claude   │◀─── reads project specs
        reads only  │    Code    │     from DB first
                    │  (hub, the │
                    │only writer)│──── all writes ──▶ Postgres (MCP, only connector)
                    │            │
                    │            │──── generates ──▶ Artifact (render target only —
                    └────────────┘                    artifacts cannot reach the DB)
```

Rules:
- Claude is the **only writer** to the database. Gmail and search return structured
  text; Claude reconciles and writes.
- The database is the **project context store**, not just an order log. The search
  skill reads specs/BOM from it before searching — that's the differentiator.
- Artifacts are snapshots regenerated from DB data (CSP blocks artifact→network).

## Work split

- **Bill:** `skills/part-search/`, `skills/gmail-orders/`
- **Eshan:** Postgres + MCP connector — **built** (`bomdb/`, registered via
  `claude mcp add`), artifact/dashboard skill, DB write flows
- **Shared contract:** `SCHEMA.md` — lock this together BEFORE building. Both
  skills' output formats are pinned to it.

## Day-one smoke tests (do before building anything)

1. **Scheduled task → custom MCP**: create a throwaway scheduled task in claude.ai
   that calls the Gmail connector AND a custom MCP connector. If scheduled runs
   can't reach custom connectors, fall back to "catch-up on open" (skill sweeps
   last N days at session start). This decides the gmail-orders design.
2. **Gmail signal check**: search your own inbox for McMaster/Digi-Key/Amazon
   order emails. Confirm order #, items, and prices are actually extractable from
   the email bodies (some vendors send image-only or link-only confirmations).

Status: email-extraction smoke passed on real inbox samples (Wayfair/IKEA,
plaintext extractable); scheduled-task→custom-MCP test still open.

## Build order (Bill)

1. Run **baseline evals** (`evals/`) — vanilla Claude, no skill — on the real
   failure scenarios from the customer calls. Save transcripts.
2. Write/refine `part-search` against the observed failures. Re-run evals.
3. Same loop for `gmail-orders` on your own inbox.
4. Integrate DB read/write once the MCP is up (Sunday merge).
5. Dogfood: the Arduino project's real orders become live test data for both
   skills by Monday.

## Install (local iteration)

Symlink or copy skills into `~/.claude/skills/` (Claude Code) or upload to
claude.ai as skills. Keep this repo as the source of truth.
