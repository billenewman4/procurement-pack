---
name: bom-dashboard
description: Use when the user asks to see their BOM, project status, dashboard, spending, order pipeline, or "show me where everything is" — renders their procurement data as a single self-contained HTML artifact from the BOM database.
---

# BOM Dashboard

## Overview

One consistent, glanceable artifact for "show me my BOM." Data comes from the
database — never from memory or the conversation. The layout and colors below
are fixed so every render looks like the same product; only the data changes.

The organizing idea: a BOM has exactly three states a person cares about —
**what am I still deciding, what's on its way, what's on my bench.** The
dashboard is three tabs on that split. Only one is on screen at a time, so no
tab has to fight the others for attention.

## Step 1 — Load the data

Call `get_dashboard_data` (pass `project_id` only if the user asked about one
project). Every number shown must come from this response — never compute
totals yourself, never fill gaps from conversation memory. No projects
returned → don't render an empty dashboard; offer to set one up instead.

**Then call `list_options` for each item that will land in the Researching
tab.** This matters: `get_dashboard_data` returns only `selected` and
`candidate` options and silently drops `rejected` ones, so once a decision is
made the alternatives vanish from the payload. `list_options` returns all of
them regardless of status. The rejected ones are the most interesting thing on
the page — they're the record of what was weighed and why — so fetch them.

Don't call `list_options` for Ordered or Delivered items. Those decisions are
settled and the alternatives are noise.

## Step 2 — Map statuses onto three tabs

The database has six statuses. The dashboard shows three. Fold them:

| Tab | Includes | Why |
|---|---|---|
| **Researching** | `needed` + `researching` | Both mean "not ordered." The distinction is invisible to the user and splitting them fragments the one list they actually work from. |
| **Ordered** | `ordered` + `shipped` | Both mean "money spent, part not here." Shipped is a detail of an order, not a separate life stage — show it as a status chip on the row. |
| **Delivered** | `delivered` + `issue` | An item flagged `issue` is physically in hand; it just doesn't work. It belongs with the other parts on the bench, marked. |

Never invent a fourth tab, and never give `issue` its own tab for one row.

## Step 3 — Render ONE self-contained HTML artifact

Single file, inline CSS, no external resources (fonts, CDNs, images) — the
artifact sandbox blocks all network access. Tabs must be **CSS-only**: hidden
radio inputs plus `:checked ~` sibling selectors. No JavaScript; it isn't
needed and the artifact should survive with scripting off.

Responsive: relative units, `max-width: 100%`, and every table wrapped in its
own `overflow-x: auto` container so the page never scrolls horizontally.

**Theme-aware, both modes styled** via `@media (prefers-color-scheme: dark)`
plus `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides.
Surfaces: light `#fcfcfb`, dark `#1a1a19`. Text in neutral ink (near-black /
near-white), never in a data color.

### Colors

Three-step ordinal ramp, one per tab — validated, do not substitute:

- Light: researching `#5598e7`, ordered `#2a78d6`, delivered `#104281`
- Dark: researching `#6da7ec`, ordered `#3987e5`, delivered `#184f95`

Critical red `#d03b3b` is reserved for `issue` — the open-issue tile dot and
the `issue` chip on the delivered row. Nowhere else, ever, including
decoration. There is no orange in this design.

### Layout, top to bottom

1. **Header** — project name, then a muted line: what the project is, total
   part count, and "as of <timestamp>". Data is a snapshot; say when it was
   taken.

2. **Stat tiles** — exactly three, one row, wrapping on narrow:
   Committed `$X.YZ` · In hand `n/total` · Open issues `n`.
   Big number, small uppercase muted label beneath. The issue tile shows a
   small red dot beside the number when `n > 0`; the number itself stays in
   ink. Don't add a fourth tile — a tile reading "0" teaches nothing.

3. **Tab strip** — three labels, each with a color swatch and a count pill.
   Researching is the default checked tab: it's the only one with decisions
   left in it. Active tab gets ink text and a 2px bottom border; the others
   stay muted.

4. **Tab panels** — see below. Each opens with one muted sentence of context.

Nothing after the panels. No pipeline bar (the tab counts already carry it)
and no recent-activity feed (it repeats ETAs that are already on the rows).

### The Researching panel — cards, not rows

Options don't fit in a table cell, so this tab uses cards. One card per item:

- **Title**: short part name + `· qty n`
- **Why line**: one muted sentence — what it's for, or what turns on the
  choice ("the pick changes the 12V branch's fuse and wire sizing")
- **Lead line**: extended price in bold, then `n × $unit · Vendor` muted
- **Options block**, separated by a hairline rule: heading `3 options`
  (add `· decided` when one is already `selected`), then one small tile per
  option, wrapping.

Each option tile:

- Vendor + part number as an **anchor to `product_url`**, `target="_blank"`,
  with a `↗` affordance. Every option carries a URL — use it. When two options
  share a landing page (vendors that sell all variants off one page), say so
  in the note rather than letting it read as a broken link.
- Price line: `$unit ea` plus availability, muted, tabular numerals. Include
  a derived unit where it aids comparison ($/ft for wire).
- One-line `fit_notes` — the tradeoff, not a spec dump.
- The `selected` option gets a border in the researching blue and a `chosen`
  tag; if nothing is selected, tag the best-fit one `leading`.
- `rejected` options render at ~62% opacity with a `ruled out` tag. Keep them.
  Dimmed, not deleted — "here's what we didn't buy and why" is the whole
  argument for a BOM database over a spreadsheet.

An item awaiting a sourcing quote gets a single placeholder tile: quote id,
start time, and what was asked for. Show its price as "not yet priced" and say
plainly that the committed total understates the build.

### The Ordered and Delivered panels — tables

Both are plain tables, no options, no reasoning:

- **Ordered**: Part · Vendor · Qty · Total · Status.
  Status cell = a small uppercase chip (`ordered` / `shipped` / `backordered`)
  followed by the ETA or carrier.
- **Delivered**: Part · Vendor · Qty · Total · Note.
  An `issue` item gets a red-outlined `issue` chip before its description and
  a note saying what's wrong and what to check.

Part cell: bold description, muted sub-line with the part number and the
one-line reason it was chosen. Vendor links to `product_url`.

Each table ends with a `tfoot` subtotal — "In flight" / "In hand" — so each
tab answers "how much is this pile worth" without arithmetic. If an `issue`
item's cost isn't in `total_committed`, the in-hand subtotal will exceed the
committed figure; that's correct, don't reconcile it silently.

### Style rules

- Recessive chrome: hairline borders, muted labels; the data is the loudest
  thing on the page.
- No pie charts, no dual axes, no rainbow palettes, no gradients.
- Currency with two decimals and a thousands separator; tabular numerals on
  every figure that stacks in a column.
- If everything is delivered and clean, say so plainly at the top —
  "All n items delivered ✓" — a good dashboard is allowed to be boring.

## Step 4 — After rendering

One line of commentary max, and only if something needs action ("the gear
train is the only unpriced line — want me to source it?"). Don't narrate the
layout or repeat numbers already on screen.

If the output is something the user will come back to, deliver it with
SendUserFile and then persist it with `create_artifact` so it survives the
conversation. On later renders of the same project, `update_artifact` in place
rather than creating a second one.
