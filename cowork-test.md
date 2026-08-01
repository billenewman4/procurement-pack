# Cowork compatibility test — 10 minutes

Goal: verify the pack runs in Claude Cowork (desktop) before demoing to users
who live there. Run on an account like the demo users' (individual, not
org-restricted).

## Setup (2 min)

1. Clone or copy this repo into a folder, open Cowork, grant it that folder.
2. Copy `evals/fixtures/seed-bom.json` to `<folder>/bom.json`.
3. Confirm the Gmail connector is enabled for the session.

## Test 1 — Skill + store + Gmail (5 min)

Paste into Cowork:

> Read skills/gmail-orders/SKILL.md and follow it exactly. The active project
> is arduino-dogfood and the store is ./bom.json in this folder (no Postgres
> MCP). Catch me up on my orders.

PASS = it searches Gmail itself, produces the updated/unmatched/stale report,
and ./bom.json changes on disk.
Record: any tool it lacked, any permission prompt loop, whether PDF/web access
differed from Claude Code.

## Test 2 — Part search + datasheet loop (3 min)

Paste:

> Read skills/part-search/SKILL.md and follow it exactly. Store is ./bom.json.
> Find me a buck converter: 12V in, 5V out, 3A continuous, screw terminals,
> must have reverse-polarity protection, prototype tier, fast shipping.

PASS = it fetches and cites a real datasheet, outputs the spec-check table
with ✓ datasheet marks, offers to add to BOM.
Record: whether it could read datasheet PDFs directly (Cowork reads PDFs
natively — may beat Claude Code here) and whether store pages were bot-walled.

## Test 3 — Custom MCP visibility (when bomdb exists)

Register bomdb as a local MCP server in the desktop app config; check its
tools appear in a Cowork session. This is the "verified connector" risk from
planning — org-managed accounts may block custom connectors. Record account
type + result.

## Test 4 — Scheduled task reachability

From claude.ai, create a scheduled task that (a) searches Gmail, (b) calls any
bomdb tool. Record which of the two work headless. If (b) fails, gmail-orders
falls back to catch-up-on-open (already supported by the skill's window logic).

## Results

| test | pass? | notes |
|---|---|---|
| 1 gmail-orders | | |
| 2 part-search | | |
| 3 custom MCP | | |
| 4 scheduled | | |
