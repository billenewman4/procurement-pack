---
name: bom-dashboard
description: Use when the user asks to see their BOM, project status, dashboard, spending, order pipeline, vendors, or "show me where everything is" — renders their procurement data as a single self-contained HTML artifact from the BOM database.
---

# BOM Dashboard

## Overview

One consistent, glanceable artifact for "show me my BOM." Data comes from the
database — never from memory or the conversation. Layout and colors are fixed
so every render looks like the same product; only the data changes.

The organizing idea: **what am I still deciding, what's on its way, what's on
my bench** — three lifecycle tabs — plus **who I buy from** — a Vendors tab.
One on screen at a time, so no tab fights the others for attention.

## Step 1 — Load the data

Call `get_dashboard_data` (pass `project_id` only if the user asked about one
project). It returns the projects, the `vendors` CRM rollup, and `one_offs`
in a single call — don't also call `list_vendors`. Every number shown must
come from this response. No projects and no vendors → don't render an empty
dashboard; offer to set things up instead.

**Then call `list_options` for each item landing in the Researching tab.**
`get_dashboard_data` silently drops `rejected` options; `list_options` returns
all of them. The rejected ones are the record of what was weighed and why —
fetch them. Don't call it for Ordered or Delivered items; those decisions are
settled.

## Step 2 — Map the data onto four tabs

| Tab | Contents |
|---|---|
| **Researching** | `researching` + `rfq` — not ordered yet; the working list. An `rfq` item shows a pending-quote placeholder tile. |
| **Ordered** | `po_placed` — money spent, part not here. `shipped: true` (event-derived) is a badge on the row, never a tab. |
| **Delivered** | `delivered` — on the bench. |
| **Vendors** | The vendor CRM rollup + one-off purchase history. Not a lifecycle stage. |

`shipped` and `issue` are order events, not statuses. Each item carries
`open_issue` (an issue event with no later shipped/delivered) — that's the
only issue signal; expect it on Ordered rows, since delivered items can't
have one. Inactive items and vendors are already excluded upstream. Never
invent a fifth tab.

## Step 3 — Render ONE self-contained HTML artifact

Single file, inline CSS/JS, no external resources — the sandbox blocks all
network. Tabs are **CSS-only**: hidden radio inputs plus `:checked ~` sibling
selectors. JavaScript exists for exactly one reason — the action buttons
below — and the page must read complete with scripting off or the bridge
absent.

Responsive: relative units, `max-width: 100%`, every table in its own
`overflow-x: auto` container so the page never scrolls horizontally.

**Theme-aware, both modes styled** via `@media (prefers-color-scheme: dark)`
plus `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides.
Surfaces: light `#fcfcfb`, dark `#1a1a19`. Text in neutral ink, never a data
color.

### Colors

Three-step ordinal ramp, one per lifecycle tab — validated, do not substitute:

- Light: researching `#5598e7`, ordered `#2a78d6`, delivered `#104281`
- Dark: researching `#6da7ec`, ordered `#3987e5`, delivered `#184f95`

Vendors is not a lifecycle stage: no swatch, no fourth ramp step.

Critical red `#d03b3b` is reserved for open issues — the issue tile dot and
the `issue` chip. Nowhere else, ever, including decoration and buttons. There
is no orange in this design.

### Layout, top to bottom

1. **Header** — project name (or "All projects"), then a muted line: part
   count and "as of <timestamp>". Data is a snapshot; say when it was taken.

2. **Stat tiles** — exactly three, one row, wrapping on narrow:
   Committed `$X.YZ` · In hand `n/total` · Open issues `n`.
   Big number, small uppercase muted label. The issue tile gets a small red
   dot beside the number when `n > 0`; the number stays in ink. Tiles count
   project items only — purchase history is history, not build state.

3. **Tab strip** — four labels, each with a count pill; the three lifecycle
   labels get their color swatch. Researching is the default checked tab.
   Active tab: ink text, 2px bottom border; the rest muted.

4. **Tab panels** — each opens with one muted sentence of context. Rendering
   all projects: group rows/cards by project with a muted project heading.

Nothing after the panels — no pipeline bar, no activity feed.

### The Researching panel — cards, not rows

One card per item:

- **Title**: short part name + `· qty n`
- **Why line**: one muted sentence — what it's for, or what turns on the choice
- **Lead line**: extended price bold, then `n × $unit · Vendor` muted
- **Options block** after a hairline rule: heading `3 options` (`· decided`
  when one is `selected`), then one small tile per option, wrapping.

Each option tile:

- Vendor + part number as an anchor to `product_url` with a `↗` affordance
  (links can't open in the sandbox's own tab rules — keep them anyway; they
  copy/drag fine).
- Price line: `$unit ea` + availability, muted, tabular numerals. Derived
  units where they aid comparison ($/ft for wire).
- One-line `fit_notes` — the tradeoff, not a spec dump.
- `selected`: border in the researching blue + `chosen` tag; nothing selected
  → tag the best fit `leading`.
- `rejected`: ~62% opacity + `ruled out` tag. Dimmed, not deleted — "what we
  didn't buy and why" is the whole argument for a database over a spreadsheet.

An `rfq` item gets one placeholder tile — quote id, start time, what was
asked — priced "not yet priced", with a plain note that Committed understates
the build.

### The Ordered and Delivered panels — tables

- **Ordered**: Part · Vendor · Qty · Total · Status.
  Status cell = uppercase chip: `po placed`, or `shipped` with a 🚚 when
  `shipped: true`; then ETA. Items in `stale_items` add a muted
  "no update in 7+ days". `open_issue` → red-outlined `issue` chip first.
- **Delivered**: Part · Vendor · Qty · Total · Note.
  Note shows `outcome` + `outcome_notes` when set, else `notes`.

Part cell: bold description, muted sub-line with part number and the one-line
reason chosen. Vendor links to `product_url`. Each table ends with a `tfoot`
subtotal — "In flight" / "In hand".

### The Vendors panel — the CRM

Table: Vendor · Parts bought · Open · Last activity. Vendor cell: bold name
(anchor to `website` when present), muted sub-line naming up to three recent
parts. `part_count`, `open_items`, `last_activity` come straight off the
rollup.

Below it, a **Purchase history** group for `one_offs` — project-less
master-list parts, mostly swept from email: Part · Vendor · Qty · Total ·
When (`ordered_at`). A rare undelivered one-off gets its status chip.

### Action buttons — the MCP bridge

Published artifacts can call the viewer's connectors via `window.claude.mcp`
(per-viewer consent, viewer's own credentials). Buttons are recessive:
hairline border, muted ink, no data colors. Feature-detect — write-back
buttons are hidden unless the bridge exists; copy buttons always work. Never
a broken button.

| Button | Where | Call |
|---|---|---|
| Choose | option tile | `select_option {option_id, project_id}` |
| Ordered it | researching card | `update_status {line_item_id, status:'po_placed'}` |
| Source this part | researching card | clipboard — sourcing prompt (below) |
| Remove | researching card | `set_item_active {line_item_id, active:false}` |
| Mark delivered | ordered row | `update_status {line_item_id, status:'delivered'}` |
| Record issue | ordered row | `record_order_event` — reveal an inline one-line input first |

```js
const MCP = () => window.claude?.mcp;              // member check only — never probe with a call
if (MCP()) document.documentElement.classList.add('live');  // CSS: .act hidden unless .live

async function act(btn, tool, input) {             // every write-back button funnels here
  btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
  try {
    await MCP().callTool('BOM Manager', tool, input);
    await MCP().invalidate('BOM Manager', 'get_dashboard_data').catch(() => {});
    btn.textContent = 'done ✓';
  } catch (e) {
    btn.textContent = old; btn.disabled = false;
    note(btn, e.code === 'needs_reauth' || e.code === 'server_not_connected'
      ? 'Reconnect BOM Manager in claude.ai Settings → Connectors'
      : (e.message || e.code));                    // note() = one muted line under the button row
  }
}
// Record issue: act(btn, 'record_order_event', { project_id, line_item_id, vendor,
//   event: 'issue', event_at: new Date().toISOString(), raw_summary: inputValue })
```

Stay current: stamp `data-item="<id>"` on rows/cards and `data-opt="<id>"` on
option tiles, then watch the dashboard data and **patch** — tiles, count
pills, chips/badges, moved or dimmed rows. A slim patch function, not a
client-side re-render; the artifact is a rendered snapshot with live buttons,
not an app.

```js
if (MCP()) MCP().watchTool('BOM Manager', 'get_dashboard_data',
  PROJECT_ID ? { project_id: PROJECT_ID } : null,
  ev => { if (ev.type === 'data') patch(ev.result.payload); });  // errors: keep last-good page
// watch registration failed? fall back after each write:
// callTool('BOM Manager','get_dashboard_data', input, {cache:{refresh:true}}) → patch
```

**Source this part** needs a fresh Claude session, which an artifact cannot
launch (no popups, no links out, no `claude://`) — so it copies a ready
prompt and hints "paste into a new Claude chat". Published artifacts are
denied `navigator.clipboard`, hence the cascade:

```js
function copyPrompt(btn, text) {                   // writeText → execCommand → select-text
  const ok = () => { btn.textContent = 'copied ✓'; setTimeout(() => btn.textContent = 'copy prompt', 1500); };
  (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(ok).catch(() => {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select();
    const done = document.execCommand('copy'); ta.remove();
    if (done) return ok();
    const pre = btn.closest('[data-item]').querySelector('.prompt');  // reveal; user presses ⌘C
    pre.hidden = false; getSelection().selectAllChildren(pre);
  });
}
```

Prompt template (one per card, in the hidden `.prompt`):
`Source this part: <description> (qty n) for project "<name>"
(project_id <pid>, line_item_id <id>). Spec: <why line>. Use part-search and
store the top 2–3 options with add_line_item_option.`

### Style rules

- Recessive chrome: hairline borders, muted labels; the data is the loudest
  thing on the page.
- No pie charts, no dual axes, no rainbow palettes, no gradients.
- Currency with two decimals and a thousands separator; tabular numerals on
  every stacking figure.
- Everything delivered and clean → say so at the top: "All n items
  delivered ✓". A good dashboard is allowed to be boring.

## Step 4 — Deliver

One line of commentary max, only if something needs action. Don't narrate the
layout or repeat numbers on screen.

Deliver with SendUserFile, persist with `create_artifact`; later renders of
the same project `update_artifact` in place. Where those tools don't exist,
save the HTML file and tell the user where it is. If the publish surface takes
a capability manifest, declare the minimal grant:
`mcp: {servers: [{server: 'BOM Manager', tools: ['get_dashboard_data',
'update_status', 'record_order_event', 'select_option', 'set_item_active']}]}`.

Tell the user two things, once:

- First open shows a one-time "this artifact uses BOM Manager" consent;
  declining blanks the page until reload — expected, not broken.
- The artifact can't be shared by public link — every viewer needs the
  connector.
