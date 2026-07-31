---
name: part-search
description: Use when the user wants to find, source, compare, or buy a physical part or component — screws, fasteners, connectors, circuit boards, sensors, converters, raw material — or asks "where can I get X", mentions McMaster/Digi-Key/Amazon/Mouser, or is building a BOM.
---

# Part Search

## Overview

Search for real, purchasable parts that fit the user's *system*, not just their
sentence. The #1 documented failure of unassisted search: recommending a
plausible part that violates an unstated spec of the user's setup (wrong
connector, wrong current rating, no reverse-polarity protection → the board
explodes). Context first, search second.

## Step 1 — Load project context (before anything else)

Load `project_specs` and the current BOM (`line_items`) from the store, resolved
in order: (1) Postgres MCP if connected, (2) local store at
`~/.procurement-pack/<project-slug>/bom.json` (spec: store/README.md in the
pack repo), (3) neither → ask the user for their setup description and warn
that nothing will persist.

## Step 2 — Ask the right questions BEFORE searching

Only ask what the context didn't answer. Cover whichever apply:

- **Electrical:** input/output voltage, max current, connector type & pin count,
  polarity/directionality, protection needs (reverse current, fusing)
- **Mechanical:** dimensions with units, thread spec (e.g. M3×10), material,
  tolerance, load
- **Fit:** what does it attach/connect to in the existing BOM?
- **Tier:** prototype (cheap, next-day) or production (quality, traceability,
  country-of-origin constraints)?
- **Quantity and lead-time priority** — for prototypers, lead time usually
  beats price.

One round of questions, then search. Don't interrogate.

## Step 3 — Search, in this order

1. **Amazon** — default for prototype-tier, cheap, next-day (expect bad search;
   translate specs into multiple query phrasings)
2. **McMaster-Carr** — mechanical breadth, odd sizes, quality; pricier
3. **Digi-Key / Mouser** — electronics with real datasheets and parametric search
4. **Manufacturer direct / niche vendors** — only when the above fail; flag
   unfamiliar vendors as unverified

Verify against the datasheet or listing details — not the title — that every
stated spec is met. If a spec can't be confirmed from the listing, say so.

## Step 4 — Output contract

Every recommendation MUST contain, per option (2–4 options):

| field | |
|---|---|
| Part + part number | exact, quoted from listing |
| Vendor + direct link | real URL you found, never constructed |
| Price + quantity | as listed |
| Lead time | as listed |
| Spec check | each user spec: ✓ confirmed / ? unverified / ✗ miss |
| Risk notes | unfamiliar vendor, ambiguous listing, spec gaps |

End with: **"Want me to add one of these to the BOM?"** — on yes, write the
`line_items` record (status `researching` or `ordered`) to the store (MCP if
connected, else the local `bom.json`).

## Common mistakes

- Recommending from the listing *title* instead of its spec table → wrong-spec
  parts. Read the details.
- Guessing an unstated spec instead of asking → the exploded-converter failure.
- Constructing plausible-looking URLs or part numbers. Every link must come
  from an actual search result.
- Treating "found something" as done. A part that matches 5 of 6 specs is a
  **✗ miss** to surface, not a rounding error.
- Forgetting the BOM offer — untracked purchases are how orders get lost.
