---
name: dashboard-upgrade
description: Use in Claude Code when the user pastes the deluxe-dashboard line or asks for the live / clickable / bookmarkable BOM dashboard — publishes their personal live dashboard page (real write-back buttons) through their Lora connector.
---

# Dashboard Upgrade — publish the deluxe dashboard (Claude Code only)

## Overview

One job: publish the user's personal live dashboard — a bookmarkable page
with real buttons that write to their BOM through their own `Lora`
connector — then hand them the URL in plain words. This playbook runs in
Claude Code (terminal, the desktop app's Code tab, or claude.ai/code).

It is a **publish protocol, not a design doc**. The page already exists as
a maintained file in the source repo; never design, hand-write, or
"improve" dashboard HTML here. The bom-dashboard skill is for in-chat
renders — it is NOT used by this playbook.

The user likely arrived by pasting one line from onboarding. Assume zero
technical vocabulary: never say MCP, artifact, capability, manifest,
bridge, or publish pipeline. "Your dashboard" and "your link" — that
register throughout.

Not in Claude Code (no Artifact/publish tool in your tool list)? Fetch
nothing and build nothing — say the paste line belongs in the Code tab
(claude.ai/code on the web) and stop.

## Step 1 — Prove Lora is reachable

Call the Lora connector's `get_dashboard_data` tool once. In Claude Code
the tools appear under a prefix (e.g. `mcp__Lora__get_dashboard_data`) —
note the segment between `mcp__` and the next `__`; Step 3 needs it.
Don't narrate the data; this call is only proof of connection.

No Lora tools in this session → say this and stop: "I can't see your
Lora connection from here. It gets added once at claude.ai → Settings →
Connectors (your setup card has the link) and reaches me automatically —
add it there, then paste the same message again." Never register a
connector yourself and never invent an alternative path.

## Step 2 — Fetch the page (never rebuild it)

The dashboard is one maintained file: `dashboard/vendor-crm-live.html`.
It contains zero data and zero secrets — every number flows through the
viewer's own connector when the page is open, so the same file serves
every user. Download the current copy with shell curl (the GitHub
contents API serves the current commit — do NOT use a web-fetch tool,
which serves stale cached copies):

```bash
curl -fsSL -H 'Accept: application/vnd.github.raw+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  https://api.github.com/repos/billenewman4/procurement-pack/contents/dashboard/vendor-crm-live.html \
  -o vendor-crm-live.html
# fallback if that fails:
# curl -fsSL https://raw.githubusercontent.com/billenewman4/procurement-pack/main/dashboard/vendor-crm-live.html -o vendor-crm-live.html
```

Sanity-check the download: non-empty and contains `window.claude`. Then
leave it byte-for-byte alone.

## Step 3 — Publish

Publish the downloaded file with the Artifact tool:

- title: **BOM Dashboard** · favicon: 🔩
- capabilities: `{"mcp": {"servers": [{"server": "Lora",
  "tools": ["get_dashboard_data", "update_status", "select_option"]}]}}` — exactly ONE
  server, never two. If your session's tool prefix segment differs from
  `Lora` (e.g. `claude_ai_BOM_Manager`), use that segment as the
  `server` value; it resolves to the display name at publish.
- Republishing: if the user already has a dashboard link and wants it
  refreshed, pass their existing URL so the link stays the same.
  Otherwise a fresh publish mints their permanent URL.

## Step 4 — Hand it over, plain words

Tell them, in this order, and nothing more:

1. "Here's your dashboard: <URL> — bookmark it; it's yours for good."
2. "The first open asks once to let the page use Lora — allow it. If
   you decline, the page stays blank until you reload."
3. "The buttons are real: click 'Mark delivered' and it saves straight
   to your list."
4. "It keeps itself current — you never need to rebuild it."
5. "It's private to your account — the link won't work for anyone else."

CANNED TRUTHS for questions this flow will get — use these, never
improvise:

- "Can I send it to my teammate?" → "The link is private to you.
  Teammates get their own the same way you just did."
- "Do I need to come back to Code?" → "No — bookmark the page and
  you're done. Only if a new layout ships would you paste the same
  message here again."
- "The page is blank" → "Reload it and allow Lora when it asks."
- "It says to add a connector" → the claude.ai connector must be named
  exactly `Lora` — any other name and the page can't find it.

## Verify before delivering — all four, every run

1. The Step-1 smoke call succeeded in THIS session — never publish
   against an unverified connection.
2. The published file is the downloaded repo copy, unedited.
3. The capability grant names exactly one server.
4. The URL you hand over is the one the publish returned — never a
   remembered or constructed link.

## Anti-patterns

- **Building dashboard HTML from memory or from the bom-dashboard
  skill.** That skill renders in-chat snapshots; this playbook only
  publishes the maintained live file.
- **Explaining mechanics.** Artifact types, capability grants, bridges,
  Cowork-vs-Code differences — never. The user asked for a dashboard,
  not a lecture.
- **Running anywhere but Claude Code.** Chat and Cowork cannot publish
  live-button pages; if that's where you are, point to the Code tab and
  stop.
