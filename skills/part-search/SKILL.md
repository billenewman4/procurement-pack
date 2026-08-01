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
`~/.procurement-pack/<project-slug>/bom.json`, or `./bom.json` in the current
workspace folder when the home path isn't accessible (e.g. Cowork) — spec:
store/README.md in the pack repo, (3) neither → ask the user for their setup
description and warn that nothing will persist.

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

One round of questions, then search. Don't interrogate. Fold the Step 1
setup request (when no store exists) and these questions into a single message.
If the right solution might be a different *kind* of part than the user asked
for (e.g. a transformer rather than an adapter), say so and ask — that's a
system-level question, not a spec.

## Step 3 — Search, in this order

1. **Amazon** — default for prototype-tier, cheap, next-day (expect bad search;
   translate specs into multiple query phrasings)
2. **McMaster-Carr** — mechanical breadth, odd sizes, quality; pricier
3. **Digi-Key / Mouser** — electronics with real datasheets and parametric search
4. **Manufacturer direct / niche vendors** — only when the above fail; flag
   unfamiliar vendors as unverified

## Step 3.5 — Verify against the DATASHEET, not the listing

This is the core of the skill. Retail listings are marketing; the datasheet is
the contract. For every candidate part:

1. Identify the **manufacturer part number (MPN)** from the listing.
2. Find the actual datasheet — manufacturer site, or the datasheet PDF links on
   Digi-Key/Mouser (direct PDFs usually fetch fine even when store pages are
   bot-walled). Fetch tools often can't parse PDFs inline: download the PDF to
   a temp file and read it from disk. If the part has no PDF, the
   manufacturer's own product page is the next-best spec source — label
   verification `✓ listing-only` in that case.
3. Check each user spec against the datasheet — including the failure-mode
   specs nobody lists in titles: polarity/reverse-current protection, max
   ratings vs continuous ratings, connector pinout, derating.
4. A part with **no findable MPN or datasheet** (typical for generic
   marketplace clones) is capped at `? unverified` with an explicit risk note —
   this is the exploded-board class of part. It may still be the right cheap
   choice for prototyping, but the user decides that knowingly.

Price and lead time matter, but spec correctness is the product: a cheap wrong
part costs a build week. When bot walls block a store page, take price/lead
time from the search snippet and mark what you couldn't see as `?` — never
guess or reconstruct a number.

## Step 4 — Output contract

Every recommendation MUST contain, per option (2–4 options):

| field | |
|---|---|
| Part + MPN | exact, quoted from listing/datasheet |
| Vendor + direct link | real URL you found, never constructed |
| Datasheet | link to the PDF you actually read, or "none found" |
| Price + quantity | as listed (`?` if bot-walled) |
| Lead time | as listed |
| Spec check | each user spec: ✓ datasheet / ✓ listing-only / ? unverified / ✗ miss |
| Risk notes | no datasheet, unfamiliar vendor, ambiguous listing, spec gaps |

End with: **"Want me to add one of these to the BOM?"** — on yes, write the
`line_items` record (status `researching` or `ordered`) to the store (MCP if
connected, else the local `bom.json`).

## Common mistakes

- Verifying against the retail listing when a datasheet exists — the listing
  is marketing copy; the datasheet is the contract. `✓ listing-only` is a
  weaker claim and must be labeled as such.
- Recommending from the listing *title* instead of its spec table → wrong-spec
  parts. Read the details.
- Guessing an unstated spec instead of asking → the exploded-converter failure.
- Constructing plausible-looking URLs or part numbers. Every link must come
  from an actual search result.
- Treating "found something" as done. A part that matches 5 of 6 specs is a
  **✗ miss** to surface, not a rounding error.
- Forgetting the BOM offer — untracked purchases are how orders get lost.
