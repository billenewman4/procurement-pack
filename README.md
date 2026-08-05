# Procurement Pack

Claude extension pack for hardware procurement: a BOM database that follows
your account everywhere, context-aware part search, Gmail-driven order
tracking, dashboard artifacts, and (when enabled) deep sourcing quotes from
live vendor catalogs.

## Get started (60 seconds, no terminal)

1. Get your personal connector link from whoever runs your team's database
   (it looks like `https://…run.app/mcp/<your-token>` — treat it like a
   password).
2. On claude.ai: **Settings → Connectors → Add custom connector** → paste
   the link → Add. *(Team/Enterprise plans: an org Owner must do this step.)*
3. Open a new chat and say: **set up my BOM**

That's the whole install. Claude walks you through the rest in the chat —
your project, its specs, optional skill upgrades, Gmail order tracking, and
a weekday-morning digest. The connector works on claude.ai web, the Desktop
app, mobile, Cowork, and scheduled tasks.

## Using Claude Code?

Send Claude Code this one message, with your personal link on the end:

```
Fetch https://raw.githubusercontent.com/billenewman4/procurement-pack/main/INSTALL_FOR_AGENTS.md and follow it exactly. My connector URL is: https://bomdb-remote-869731474645.us-central1.run.app/mcp/<your-token>
```

One asymmetry to know: connectors added on claude.ai sync into Claude Code
automatically, but servers added via Claude Code's CLI do **not** appear on
claude.ai or Cowork — so if you live in chat, use the connector card above
(it covers Claude Code too).

## What you get

- **A BOM that remembers.** Projects, specs, line items, and order history
  in your own row-level-isolated Postgres workspace. Interview once; every
  future chat on every device starts warm.
- **Part search that respects your build.** The search skill loads your
  specs and current BOM before searching, so suggestions fit your system,
  not just your sentence.
- **Order tracking from email.** Gmail order emails become status updates
  on the right line items — in-chat on demand, or unattended via the
  morning digest scheduled task.
- **Dashboards on demand.** "Show me my BOM" renders a consistent artifact:
  spend, pipeline, stalls, issues.
- **Deep sourcing (when enabled).** "Get me real quotes for X" dispatches a
  sourcing agent over live vendor catalogs; priced, in-stock options come
  back in minutes, ready to add to the BOM.

## Architecture

```
 Any Claude surface (web / Desktop / mobile / Cowork / scheduled tasks)
   │  account-saved skills: part-search, gmail-orders, bom-dashboard
   │
   ├── MCP over HTTPS (per-user secret URL) ──▶ Cloud Run: bomdb-remote
   │                                             ├─ bomdb ops (shared with local)
   │                                             ├─ get_started concierge
   │                                             └─ sourcing relay ──▶ sourcing-agent
   │                                             │                     (hosted separately)
   │                                             ▼
   │                                           Supabase Postgres (RLS per user)
   └── Gmail connector (user's own OAuth) ──▶ Google
```

Rules that keep it sane:
- **Claude is the only writer.** Gmail and search produce structured text;
  Claude reconciles and writes through bomdb tools.
- **The database is the context store**, not just an order log — search
  reads specs first; that's the differentiator.
- **Artifacts are snapshots** regenerated from DB data (the artifact
  sandbox has no network). Statuses never move backward without explicit
  confirmation; there is no delete operation.
- **No user token ever maps to the master DB connection.** Master is for
  admin scripts only.

## For operators

- **Onboard a user / rotate / revoke:** `bomdb-remote/README.md` (the
  runbook: provision role → mint token → TOKEN_MAP → redeploy → send link).
- **Reset a workspace for onboarding tests:** `bomdb/scripts/reset-user.ts`.
- **Local/power-user install (terminal + Desktop stdio server):**
  `TEAM_SETUP.md`.
- **Design history and decisions:**
  `docs/plans/2026-08-03-hosted-connector-onboarding-design.md`.
