# Live dashboard — publish your own copy

`vendor-crm-live.html` is the interactive BOM dashboard: a hosted web page
that reads your BOM live through your `Lora` connector and writes
back (Mark ordered / Mark delivered) with real tool calls. It contains
**zero data and zero secrets** — all data flows through the viewer's own
connector at open time.

Connector-wired artifacts can't be shared between accounts, so there is no
communal URL: **each user publishes their own copy once**, from their own
Claude account, and bookmarks the resulting link forever. It never needs
regenerating — the page is code, not a snapshot.

**No terminal required:** Claude Code runs in the browser at
[claude.ai/code](https://claude.ai/code). A chat-only user opens it once,
pastes the publish message, bookmarks the URL it returns, and never comes
back.

Platform facts this design rests on (July 2026 artifacts-MCP release):
connector calls run through the *viewing* account's connections with
per-viewer approval; connector-calling artifacts can never get a public
link; on Pro/Max there is no other sharing, hence one publish per user.
On Team/Enterprise, inside-org sharing works — one org-shared dashboard
is viable there.

## Publish it (agent instructions)

In a Claude Code session (CLI or claude.ai/code) with the Artifact tool:

1. Publish `dashboard/vendor-crm-live.html` as an artifact with:
   - favicon: 🔩
   - capabilities: `{"mcp": {"servers": [{"server": "Lora",
     "tools": ["get_dashboard_data", "update_status"]}]}}`
   - If your session's BOM connector tool prefix differs (e.g.
     `mcp__claude_ai_BOM_Manager__*`), use that prefix segment as the
     `server` value — it resolves to the display name at publish.
2. Give the user the URL and tell them, once:
   - Their claude.ai connector must be named exactly **Lora**.
   - First open shows a one-time consent for Lora; declining
     blanks the page until reload — expected, not broken.
   - The page shows "live · Lora" in the header when connected;
     buttons write real statuses to their database.

## Requirements to view

- Logged into claude.ai as the publishing account.
- A custom connector named `Lora` (see the repo README's
  connector card). No connector → the page explains how to add one.

## Surface notes (verified 2026-08-05)

- Published (Claude Code) artifacts: full live reads + write-back buttons.
- Cowork "live artifacts": view-only — no author-JS connector bridge, no
  links; the bom-dashboard skill renders those as snapshot pages.
