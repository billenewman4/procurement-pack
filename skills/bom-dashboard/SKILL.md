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
the user asked about one project). Every number shown must come from this
response — never compute totals yourself, never fill gaps from conversation
memory. No projects returned → don't render an empty dashboard; offer to set
one up instead.

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

1. **Header row** — project name(s) + "as of <timestamp>" (small, muted).
   Data is a snapshot; say when it was taken.
2. **Stat tiles** (one row, wrap on narrow): Total committed `$X.YZ` ·
   Items delivered `n/total` · Open issues `n` · Stale orders `n`.
   Big number, small muted label under it. Issue/stale tiles: show the
   status color ONLY as a small dot/icon beside the number when n > 0 —
   the number itself stays in ink.
3. **Pipeline bar, one per project** — a single horizontal stacked bar of
   item counts through the lifecycle. Segment colors (an ordinal
   single-hue ramp — validated, do not substitute):
   - Light mode: needed `#86b6ef`, researching `#5598e7`, ordered
     `#2a78d6`, shipped `#1c5cab`, delivered `#104281`
   - Dark mode: needed `#9ec5f4`, researching `#6da7ec`, ordered
     `#3987e5`, shipped `#256abf`, delivered `#184f95`
   2px gaps between segments (surface-colored). Label each nonzero segment
   directly below the bar as "3 ordered" (ink text + a small color chip) —
   identity must never be color-alone. Items with status `issue` are NOT a
   pipeline segment — they appear only in the callout section.
4. **Callouts** (only when nonempty): items flagged `issue` (critical red
   `#d03b3b`) and stale orders — ordered, silent 7+ days (serious orange
   `#ec835a`). Each callout = icon + label + item description + vendor,
   color never alone. These two colors are reserved for exactly this;
   never reuse them in the pipeline or anywhere decorative.
5. **Items table** — grouped by status in lifecycle order (needed →
   researching → ordered → shipped → delivered → issue): description,
   vendor, qty, unit price, line total, ETA/notes where present. Vendor
   name links to `product_url` when present. This table doubles as the
   accessible fallback for everything the graphics show.
6. **Recent activity** — up to 5 `recent_events` as one-liners:
   "shipped — Digi-Key — Aug 2".

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
