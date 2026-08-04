---
name: bom-dashboard
description: Use when the user asks to see their BOM, project status, dashboard, spending, order pipeline, or "show me where everything is" — renders their procurement data as a single self-contained HTML artifact from the BOM database.
---

# BOM Dashboard

## Overview

One consistent, glanceable artifact for "show me my BOM." Data comes from the
database — never from memory or the conversation. The layout and colors below
are fixed so every render looks like the same product; only the data changes.

## Step 1 — Load the data

Call the BOM connector's `get_dashboard_data` tool (pass `project_id` only if
the user asked about one project). It returns everything in one call —
aggregates, line items, and each item's vendor `options`. Every number shown
must come from this response — never compute totals yourself, never fill
gaps from conversation memory. No projects returned → don't render an empty
dashboard; offer to set one up instead.

## Step 2 — Render ONE self-contained HTML artifact

Single file, inline CSS, no external resources (fonts, CDNs, images) — the
artifact sandbox blocks all network access. Responsive: relative units,
`max-width: 100%`, and any wide table wrapped in its own
`overflow-x: auto` container so the page never scrolls horizontally.

**Theme-aware, both modes styled** via `@media (prefers-color-scheme: dark)`
plus `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides.
Surfaces: light `#fcfcfb`, dark `#1a1a19`. Text in neutral ink (near-black /
near-white), never in a data color.

### Layout, top to bottom

The organizing idea: **decision stages, left to right through time —
deciding → buying → waiting → done.** Each stage shows exactly as much
as the user needs there: many links while deciding, ONE link while
buying, tracking while waiting.

1. **Project tabs** — one tab per project, client-side toggle (inline JS
   is fine; only network is blocked); everything below scoped to the
   active tab. Single project → no tab row. Small muted "as of
   <timestamp>" beside the tabs — data is a snapshot.
2. **Stat tiles** (one row, wrap on narrow): Total committed `$X.YZ` ·
   Items delivered `n/total` · Open issues `n` · Stale orders `n`.
   Big number, small muted label under it. Issue/stale tiles: show the
   status color ONLY as a small dot/icon beside the number when n > 0 —
   the number itself stays in ink.
3. **Pipeline bar** — a single horizontal stacked bar of item counts
   through the lifecycle. Segment colors (an ordinal single-hue ramp —
   validated, do not substitute):
   - Light mode: needed `#86b6ef`, researching `#5598e7`, ordered
     `#2a78d6`, shipped `#1c5cab`, delivered `#104281`
   - Dark mode: needed `#9ec5f4`, researching `#6da7ec`, ordered
     `#3987e5`, shipped `#256abf`, delivered `#184f95`
   2px gaps between segments (surface-colored). Label each nonzero segment
   directly below the bar as "3 ordered" (ink text + a small color chip) —
   identity must never be color-alone. Items with status `issue` are NOT a
   pipeline segment — they appear only in the Issues section.
4. **⚠ Issues** (only when nonempty, pinned first): `issue` items in
   critical red `#d03b3b` — icon + label + description + vendor, color
   never alone. This red and the stale orange are reserved for exactly
   this; never reuse them decoratively.
5. **🔍 Researching** — items in `needed`/`researching` WITHOUT a chosen
   vendor. Each item row, then its **option cards** beneath: vendor name
   linked to `product_url`, price, availability, `fit_notes`, muted
   "option 1/2/3" labels the user can say in chat. No buttons, no fake
   interactivity (the page cannot write to the database) — one muted
   line under the cards: "to pick one, just tell me — e.g. 'go with the
   Mouser option'". Items with no options yet get one muted line: "no
   vendor options yet — ask me to research this or get quotes".
6. **🛒 Ready to buy** — `needed`/`researching` items WITH a vendor
   (selected option, or vendor set directly). One clean card per item:
   description, chosen vendor, qty × unit price = line total, and a
   prominent **"Buy at <vendor> →"** link to `product_url` — the execute
   affordance; the artifact cannot place orders. One muted line for the
   section: "after you order, tell me — or email tracking will catch it".
7. **📦 On order** — `ordered`/`shipped` items: description, vendor, ETA
   when known, last event. Stale ones (7+ days silent) flagged with the
   serious orange `#ec835a` + icon.
8. **✅ Delivered** — compact rows, most recent first.
9. **Recent activity** — up to 5 `recent_events` as one-liners:
   "shipped — Digi-Key — Aug 2".

The stage sections replace a separate items table — keep them
structurally table-like (real rows, consistent columns) so they remain
the accessible fallback for the graphics.

### Style rules

- Recessive chrome: hairline borders, muted axis/label text; the data is
  the loudest thing on the page.
- No pie charts, no dual axes, no rainbow palettes, no gradients.
- Currency with two decimals and a thousands separator.
- If everything is delivered and clean, say so plainly at the top —
  "All n items delivered ✓" — a good dashboard is allowed to be boring.

## Step 3 — After rendering

One line of commentary max, and only if something needs action ("two orders
look stale — want me to check your email?"). Don't narrate the layout or
repeat numbers already on screen.
