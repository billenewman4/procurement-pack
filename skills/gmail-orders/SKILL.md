---
name: gmail-orders
description: Use when checking email for purchase/order updates — order confirmations, shipping notices, delivery notices, backorders — or when the user asks "what's the status of my orders", "did everything ship", or wants the BOM/order tracker reconciled with their inbox.
---

# Gmail Order Sync

## Overview

Read-only sweep of the user's Gmail for vendor order emails; emit structured
order events; reconcile against the BOM. The documented pain this solves:
"keeping track of what you have versus have not ordered so nothing is missed."

**Privacy contract:** classification may surface non-order emails as
candidates — read no more than sender/subject/snippet before discarding them,
and never store, summarize, quote, or reference any email outside classified
order events. Store only the one-line `raw_summary` per event — never full
bodies. Vendors the user has excluded are hard negative filters (`-from:...`)
on every query — never retrieved, never mentioned.

## Step 1 — Find order emails: retrieve broadly, classify precisely

Do NOT rely on hardcoded sender lists or subject keywords — vendor senders and
wording vary too much to enumerate. Resolve the store first: (1) Postgres MCP
if connected, (2) local store at `~/.procurement-pack/<project-slug>/bom.json`
(spec: store/README.md). Window: since last sync (`last_email_sync`, or
`max(order_events.event_at)` in SQL), default 7 days.

1. **Retrieve candidates** (high recall, cheap fields only):
   - `category:purchases newer_than:<window>` — Gmail's own purchase
     classifier is the best single source; start here. Known quirk: combining
     `category:` with date operators can return empty — if it does, run
     `category:purchases` bare and filter to the window by each result's date.
   - Targeted sweeps for vendors already known to the store: domains from
     `line_items.vendor` and prior `order_events` senders.
   - If the two above return nothing, one broad sweep of the window
     (`newer_than:<window>`) reading ONLY sender/subject/snippet.
2. **Classify each candidate yourself** from sender/subject/snippet: is this a
   lifecycle event (confirmation, shipment, delivery, backorder, problem) for
   a purchase of physical goods plausibly related to a tracked project? SaaS
   receipts, subscriptions, and marketing are not. Fetch the full body
   (`plaintextBody` only — never HTML) ONLY for emails classified as order
   events; discard everything else immediately.
3. **Learn vendors:** when the user confirms an order event from a new vendor,
   record its sender domain in the store so future runs can query it directly.

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
