---
name: bom-dashboard
description: Use when the user asks to see their BOM, project status, dashboard, spending, order pipeline, vendors, or "show me where everything is" — renders their procurement data as a single self-contained HTML artifact from the BOM database.
---

# BOM Dashboard

## Overview

One consistent, glanceable artifact for "show me my BOM." Data comes from the
database — never from memory or the conversation. Layout and colors are fixed
so every render looks like the same product; only the data changes.

The organizing idea, in two tabs: **Active BOM** — every part, grouped by
project and broken down by lifecycle stage — and **Vendors** — who they buy
from. The page renders instantly from a baked-in snapshot, then upgrades
itself to live data and working buttons wherever the artifact MCP bridge
exists.

## Step 1 — Load the data

Call `get_dashboard_data` (pass `project_id` only if the user asked about one
project). It returns the projects, the `vendors` CRM rollup, and `one_offs`
in a single call — don't also call `list_vendors`. Every number shown must
come from this response. No projects and no vendors → don't render an empty
dashboard; offer to set things up instead.

**Then call `list_options` for each `researching`/`rfq` item.**
`get_dashboard_data` silently drops `rejected` options; `list_options` returns
all of them. The rejected ones are the record of what was weighed and why —
fetch them. Don't call it for ordered or delivered items; those decisions are
settled.

## Step 2 — Shape of the page

| Tab | Contents |
|---|---|
| **Active BOM** | One section per project. Inside each section, three status groups in order: Researching (`researching` + `rfq`), Ordered (`po_placed`), Delivered (`delivered`). After the last project, a **Purchase history** section holds `one_offs`, grouped the same way. |
| **Vendors** | The vendor CRM rollup table. Not a lifecycle stage — no swatch. |

A group that would be empty isn't rendered. Tab count pills: Active BOM =
all items including one-offs; Vendors = vendor count. A user whose whole
workspace came from the email sweep must see a full page and live tiles —
never zeros with a header claiming "6 parts".

`shipped` and `issue` are order events, not statuses. Each item carries
`shipped` and `open_issue` flags (event-derived) — badges on the row, never
groups or tabs. Inactive items and vendors are excluded upstream. Never
invent a third tab.

## Step 3 — Render ONE self-contained HTML artifact

Single file, inline CSS/JS, no external resources — the sandbox blocks all
network. Bake the Step-1 data into the page as `const SNAPSHOT = {...}` and
render from it immediately; the live bridge (below) then keeps it fresh where
available. The page must read complete with scripting off or the bridge
absent.

Responsive: relative units, `max-width: 100%`, every table in its own
`overflow-x: auto` container so the page never scrolls horizontally.

**Theme-aware, both modes styled**, token-level: define custom properties on
`:root`, redefine under `@media (prefers-color-scheme: dark)`, then again
under `:root[data-theme="dark"]` and `:root[data-theme="light"]` so the
viewer's toggle wins both ways. Style components only through the tokens.

### Tokens

Grounds — light: page `#fafbfc`, card `#ffffff`, border `#e3e8ee`, ink
`#16202b`, muted `#5a6b7d` / `#8b98a8`. Dark: page `#10161d`, card
`#1a222c`, border `#2a3542`, ink `#e8edf3`, muted `#a7b4c2` / `#6e7d8d`.
Text always in ink tokens, never a data color.

Status ramp, one hue light→dark — validated, do not substitute:

- Light: researching `#5598e7`, ordered `#2a78d6`, delivered `#104281`
- Dark: researching `#6da7ec`, ordered `#3987e5`, delivered `#8fb4e2`

Every status use carries a text label (group heading, chip text) — the ramp
steps are close by design and color is never the only signal. The light
researching blue never sets text.

Critical red `#d03b3b` (dark `#e05d5d`) is reserved for open issues — the
issue tile dot and the `issue` chip. Nowhere else, ever, including buttons.
No orange in this design.

Type: system UI stack; monospace (system mono) for numbers, part numbers,
timestamps, count pills — with `font-variant-numeric: tabular-nums`.

### Layout, top to bottom

1. **Header** — "Vendor CRM" (or the project name), plus a small connection
   line: a dot + "live · updated HH:MM" when the bridge is feeding data,
   "snapshot · as of <timestamp>" otherwise. Data always says when it's from.

2. **Stat tiles** — exactly three, one row, wrapping on narrow:
   Committed `$X.YZ` · In hand `n/total` · Open issues `n`.
   Big mono number, small uppercase muted label. The issue tile gets a small
   red dot beside the number when `n > 0`; the number stays in ink. Tiles
   count ALL items — projects and one-offs alike: Committed = po_placed +
   delivered spend, In hand = delivered / all.

3. **Tab strip** — two labels with mono count pills. Active tab: ink text,
   2px bottom border; the rest muted. Buttons with `role="tab"`, visible
   focus ring.

4. **Tab panels.** Nothing after them — no pipeline bar, no activity feed.

### Active BOM panel

Per project: an `h2` with the project name, a muted subline ("n parts ·
m open"), then the status groups. Group heading: 9px color swatch + uppercase
label + count ("RESEARCHING · 3"). Rows live in one bordered card per group,
hairline-separated:

- **Left rail**: 3px, full row height, in the row's status color.
- **Main**: bold description (anchor to `product_url` when present — links
  can't open in the sandbox, but they copy/drag fine); muted mono subline:
  part number · vendor · ETA (ordered rows) or date (delivered rows).
- **Right**: mono `qty × $unit`; then badges — `shipped` chip when shipped,
  red-outlined `issue` chip when `open_issue`; then the row's action button.

Researching rows additionally show their **options block** under the main
line, after a hairline rule: one small tile per option, wrapping. Each tile:
vendor + part number (anchor), `$unit ea` + availability muted, one-line
`fit_notes`. `selected` → border in the researching blue + `chosen` tag; none
selected → tag the best fit `leading`; `rejected` → ~62% opacity + `ruled
out` tag. Dimmed, not deleted — "what we didn't buy and why" is the whole
argument for a database over a spreadsheet. An `rfq` item gets one
placeholder tile — quote id, "not yet priced", and a plain note that
Committed understates the build.

The **Purchase history** section (one-offs) renders identically, subline
"One-off orders, not tied to a project".

### Vendors panel

Table: Vendor · Parts bought · Open · Last activity. Vendor cell: bold name
(anchor to `website` when present), muted mono sub-line with the vendor's
`domains`. Numeric columns right-aligned mono. `part_count`, `open_items`,
`last_activity` come straight off the rollup. One-offs do NOT get a duplicate
table here — the Vendors tab is the who, Active BOM is the what.

### Live bridge + action buttons

The single connector name is **`Lora`** — hardcode it; never declare
or address two names. There are TWO bridge runtimes; wrap them in one
adapter and feature-detect with member checks only, never a probing call:

- **Published artifacts** (claude.ai/Claude Code publishes) expose
  `window.claude.mcp` — `callTool`/`watchTool`/`invalidate`, per-viewer
  consent, exactly as coded below.
- **Cowork live artifacts — VERIFIED 2026-08-05: no author bridge.** The
  runtime exposes no connector-call global to artifact JS, the meta
  block's grant arrays are runtime-managed (author-written values are
  stripped to `[]` on save, with no UI to grant), and there is no publish
  link. Ship the adapter anyway (below — it future-proofs the page), but
  on Cowork the buttons WILL stay hidden: say so plainly — "buttons work
  on the published claude.ai version; here they're view-only" — and never
  imply otherwise.

```js
const bridge =
  window.claude?.mcp ? { call: (t, i) => window.claude.mcp.callTool(SERVER, t, i),
                         watch: true }
  : window.cowork?.callMcpTool ? { call: (t, i) => window.cowork.callMcpTool(SERVER, t, i),
                                   watch: false }   // poll ≥60s instead
  : null;
```

Without either bridge the page stays a readable snapshot: write-back
buttons hidden, copy buttons working. Never a broken button.

Boot:

```js
const SERVER = 'Lora', DASH = 'get_dashboard_data';
render(SNAPSHOT);                                   // instant, bridge or not
const MCP = () => window.claude?.mcp;
if (MCP()) {
  document.documentElement.classList.add('live');   // CSS reveals .act buttons
  MCP().listTools().then(r => {
    const ok = (r.servers || []).some(s => s.server === SERVER && s.tools?.length);
    if (!ok) return conn('Add "Lora" in claude.ai Settings → Connectors');
    MCP().watchTool(SERVER, DASH, INPUT, ev => {    // INPUT: {project_id} or {}
      if (ev.type === 'data') { patch(ev.result.payload); stamp(ev.result.cache?.storedAt); }
      else if (['needs_reauth','server_not_connected'].includes(ev.error.code))
        conn('Reconnect "Lora" in claude.ai Settings → Connectors');
      // other errors: keep last-good page, note "live refresh failing" once
    }, { cache: { staleTime: 30_000 }, refetchInterval: 60_000 });
  }).catch(() => {});                               // listTools failed → snapshot mode
}
```

Buttons are recessive: hairline border, muted ink, no data colors.

| Button | Where | Call |
|---|---|---|
| Choose | option tile | `select_option {option_id, project_id}` |
| Mark ordered | researching row | `update_status {line_item_id, status:'po_placed'}` |
| Source this part | researching row | clipboard — sourcing prompt (below) |
| Remove | researching row | `set_item_active {line_item_id, active:false}` |
| Mark delivered | ordered row | `update_status {line_item_id, status:'delivered'}` |
| Record issue | ordered row | `record_order_event` — reveal an inline one-line input first |

```js
async function act(btn, tool, input) {              // every write-back funnels here
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Saving…';
  try {
    await MCP().callTool(SERVER, tool, input);
    await MCP().invalidate(SERVER, DASH).catch(() => {});  // watch refetches + patches
    btn.textContent = 'Saved';
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    note(btn, e.code === 'tool_error' ? (e.message || 'Update rejected.')
      : ['server_unavailable','upstream_error'].includes(e.code)
        ? 'Couldn’t confirm the update reached the server — check after the next refresh before retrying.'
      : ['needs_reauth','server_not_connected'].includes(e.code)
        ? 'Reconnect "Lora" in claude.ai Settings → Connectors'
      : (e.message || e.code));                     // note(): one muted line under the row, auto-clears
  }
}
```

`patch()` stays slim: stamp `data-item="<id>"` on rows and `data-opt="<id>"`
on option tiles, then update tiles, count pills, chips/badges, and move or
dim rows. Not a client-side re-render — the artifact is a rendered document
with live corrections, not an app.

**Source this part** needs a fresh Claude session, which an artifact cannot
launch (no popups, no links out, no `claude://`) — so it copies a ready
prompt and hints "paste into a new Claude chat". Published artifacts are
denied `navigator.clipboard`, hence the cascade:

```js
function copyPrompt(btn, text) {                    // writeText → execCommand → select-text
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

Prompt template (one per researching row, in the hidden `.prompt`):
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

**In Cowork: create a LIVE artifact, not a chat artifact or a file.** Live
artifacts persist on their own, re-query connectors with the viewer's own
access, and are the whole point of the bridge code above — a one-off
document defeats it. Create it once per user; every later "show me my BOM"
means UPDATE the existing live artifact (`update_artifact`), never mint a
sibling. Only where live artifacts don't exist (chat-only surfaces), fall
back: SendUserFile / `create_artifact` snapshot, or save the HTML file and
say where it is.

A Cowork live artifact declares its connector access in the
`cowork-artifact-meta` JSON block at the top of the file. **Empty
`mcpTools`/`mcpServerNames` arrays make a dead page — no connector
access, no live refresh, no buttons.** Fill them, exactly:

```html
<script type="application/json" id="cowork-artifact-meta">
{ "name": "BOM Dashboard", "schemaVersion": 1,
  "description": "Live vendor CRM + BOM, reads and writes via Lora",
  "mcpServerNames": ["Lora"],
  "mcpTools": ["get_dashboard_data", "update_status", "record_order_event",
               "select_option", "set_item_active"] }
</script>
```

If the publish surface instead takes a capability manifest parameter,
declare the same minimal single-server grant — exactly one connector,
never two:
`mcp: {servers: [{server: 'Lora', tools: ['get_dashboard_data',
'update_status', 'record_order_event', 'select_option', 'set_item_active']}]}`.

**Before delivering, verify your own output — all six, every render:**

1. `cowork-artifact-meta` (when on Cowork): `mcpServerNames` and `mcpTools`
   arrays POPULATED per the template above — empty arrays are a build error.
2. Exactly two tabs — Active BOM and Vendors. No pipeline bars, no
   activity feed, no stale-orders tile: those are retired designs, and if
   you produced one you built from memory instead of this file.
3. Action-button elements present in the HTML with the bridge adapter and
   graceful hiding — even if the current surface leaves them dormant.
4. Statuses are researching/rfq/po_placed/delivered only; shipped and
   issue appear as badges. `needed` or `shipped` as a status group means
   stale knowledge — rebuild from this file.
5. No orange anywhere; red only on issue signals.
6. Report honestly which bridge the artifact runtime actually exposes and
   whether buttons are live or dormant there — never describe dormant
   buttons as working.

Tell the user two things, once:

- First open shows a one-time "this artifact uses Lora" consent;
  declining blanks the page until reload — expected, not broken. Their
  connector must be named exactly `Lora` for live mode; any other
  name falls back to the snapshot.
- The artifact can't be shared by public link — every viewer needs the
  connector.
