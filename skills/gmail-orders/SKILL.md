---
name: gmail-orders
description: Use when checking email for purchase/order updates — order confirmations, shipping notices, delivery notices, backorders — or when the user asks "what's the status of my orders", "did everything ship", or wants the BOM/order tracker reconciled with their inbox.
---

# Gmail Order Sync

## Overview

Read-only sweep of the user's Gmail for vendor order emails; emit structured
order events; reconcile against the BOM. The documented pain this solves:
"keeping track of what you have versus have not ordered so nothing is missed."

**Privacy contract:** search only with vendor/order-scoped queries; never
summarize, quote, or reference any email outside the matched set. Store only
the one-line `raw_summary` per event — never full bodies.

## Step 1 — Scoped search

Resolve the store first: (1) Postgres MCP if connected, (2) local store at
`~/.procurement-pack/<project-slug>/bom.json` (spec: store/README.md in the
pack repo). Window: since last sync (`last_email_sync` in the local store, or
`max(order_events.event_at)` in SQL), default 7 days. Query the Gmail connector
with vendor-scoped searches, e.g.:

```
from:(mcmaster.com OR digikey.com OR amazon.com OR mouser.com) newer_than:7d
subject:(order OR shipped OR delivered OR confirmation OR backorder) newer_than:7d
```

Vendor allowlist comes from distinct `line_items.vendor` values in the DB plus
a default list (McMaster, Digi-Key, Amazon, Mouser). If the user has excluded
any vendor from tracking, never query or mention it.

## Step 2 — Extract structured events

Per matched email, emit one record shaped exactly like `order_events` in
SCHEMA.md:

```json
{
  "vendor": "McMaster-Carr",
  "order_number": "1234ABCD",
  "event": "shipped",
  "event_at": "2026-08-01T14:03:00Z",
  "items": [{"description": "M3x10 SHCS, 100-pack", "qty": 1, "unit_price": 8.42}],
  "tracking_url": "https://...",
  "email_ref": "<gmail message id>",
  "raw_summary": "McMaster order 1234ABCD shipped via UPS, ETA Aug 4"
}
```

Rules: quote order numbers and prices exactly; use `null` for anything not in
the email — never infer. One email can yield multiple events (partial shipments).

## Step 3 — Reconcile and report

1. Match events to `line_items` by order number, then part number, then fuzzy
   description match. Confidence < certain → mark `line_item_id: null` and list
   under "unmatched" for the user to resolve — never auto-attach a guess.
2. Propose status transitions (`ordered` → `shipped` → `delivered`); apply only
   forward transitions automatically, confirm anything unusual (e.g. a
   `delivered` item reported backordered).
3. Report: **updated** (item, old → new status, ETA) / **unmatched events** /
   **stale** — items `ordered` > 7 days with no event, flagged for follow-up.
4. Write updates to the store (MCP if connected, else `bom.json`; update
   `last_email_sync`). Claude is the only writer either way.

## Common mistakes

- Broad searches ("read my inbox") — always vendor/order-scoped queries.
- Inferring prices, ETAs, or order numbers not literally present in the email.
- Auto-matching a low-confidence event to a BOM line — unmatched is a safe
  state, a wrong match silently corrupts the tracker.
- Forgetting the **stale orders** section — "nothing missed" is the product.
- Assuming the scheduled-task path works: if running unscheduled ("catch-up on
  open"), widen the window to cover the gap since last sync.
