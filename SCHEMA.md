# Schema Contract — LOCKED 2026-08-02 (Eshan; Bill to ack)

This is the interface between all workstreams. Both skills emit records shaped
like this; the DB tables mirror it. Change it here first, everywhere else second.

Lock resolutions are inline below (see "Locked decisions"). All changes vs. the
draft are additive or as-drafted — no skill output format changes.

**Amended 2026-08-04 (vendor-CRM redesign,
docs/plans/2026-08-04-vendor-crm-onboarding-redesign.md):** vendors table
added; line_items gains `vendor_id`, `user_id`, `active` and a nullable
`project_id` (NULL = one-off master-list part); statuses collapse to
`researching → rfq → po_placed → delivered` — `shipped`/`issue` are
order_events now, not statuses.

## vendors (the vendor CRM)
| col | type | notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | nullable in local mode; scopes the CRM per user in hosted mode |
| name | text | unique per user on lower(name) |
| domains | text[] | email domains seen for this vendor; merged on upsert |
| contact_email | text | nullable |
| website | text | nullable |
| notes | text | nullable |
| source | enum | `email_sweep` \| `manual` \| `sourcing_agent` |
| active | boolean | false hides a vendor without deleting it |
| created_at / updated_at | timestamptz | |

## users (hosted mode only)
| col | type | notes |
|---|---|---|
| id | uuid | |
| name | text | |
| email | text | |
| sharing | enum | `local` \| `hosted` \| `community` — the explicit data deal. `community` is a stub for the commodity-map tier; does nothing in v0 |
| created_at | timestamptz | |

## projects
| col | type | notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | nullable in local mode; set in hosted mode. Everything else scopes through project_id |
| name | text | e.g. "bark's robot v1" |
| created_at | timestamptz | |

## project_specs
The context store that makes search work (Clark's "saved prompts", persisted).
| col | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid | |
| category | text | e.g. `power`, `connectors`, `mechanical`, `constraints` |
| spec | text | freeform, e.g. "12V rail, max 3A; JST-XH connectors throughout; no China-origin parts" |
| updated_at | timestamptz | |

## line_items (the BOM)
| col | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid | nullable — NULL = one-off master-list part (e.g. swept purchase history) |
| user_id | uuid | nullable — owner scope for one-offs; backfilled from the project |
| vendor_id | uuid | nullable — link into the vendor CRM; canonical over the text column |
| description | text | human name: "step-down converter 12V→5V 3A" |
| part_number | text | nullable — bespoke items may not have one |
| vendor | text | nullable until sourced; back-compat display name |
| product_url | text | nullable |
| qty | int | |
| unit_price | numeric(10,2) | nullable |
| active | boolean | false = replaced/hidden, kept for history |
| status | enum | `researching` → `rfq` → `po_placed` → `delivered` (shipped/issue are order_events) |
| source | enum | `manual` \| `search` \| `email` |
| ordered_at | timestamptz | nullable |
| eta | date | nullable |
| notes | text | spec-match caveats, alternates considered |
| chosen_because | text | nullable — which spec constraints this part satisfied ("12V rail, 3A max, barrel jack in"). Commodity-map provenance; part-search fills it when it adds a line |
| outcome | enum | nullable — `worked` \| `failed` \| `returned`. Set later, usually via part-search's diagnose mode |
| outcome_notes | text | nullable — why it failed/was returned ("browned out under pump inrush") |

## order_events (audit trail; gmail-orders appends here)
| col | type | notes |
|---|---|---|
| id | uuid | |
| line_item_id | uuid | nullable — unmatched events kept for manual reconcile |
| project_id | uuid | nullable — NULL = event on a one-off master-list item (line_item_id required then) |
| user_id | uuid | nullable — owner scope for one-off events; backfilled from the project |
| vendor | text | |
| order_number | text | |
| event | enum | `confirmed` \| `shipped` \| `delivered` \| `backordered` \| `issue` |
| event_at | timestamptz | |
| tracking_url | text | nullable |
| email_ref | text | Gmail message id, for "show me the email" |
| raw_summary | text | one-line extract, no full email bodies stored |

## Locked decisions (2026-08-02)

1. **Per-user isolation → one DB, shared tables, `user_id` on `projects`,
   row-level security with per-user credentials.** Rationale: cross-user
   aggregation (demand signal, commodity map) is the point of hosted mode;
   separate DBs make it permanently painful. Reference implementation:
   gbrain's company-brain mode (scoped-by-login RLS, fuzz-tested zero leaks).
   Local mode (PGLite / bom.json) needs no isolation — it's physically the
   user's machine.

2. **`project_specs` stays freeform text + category tag, as drafted.**
   Engineers dictate specs conversationally; Claude parses freeform fine.
   Structured application tags are *derived later* for the commodity map,
   never typed by users.

3. **Status transitions: forward-only automatic.** Backward moves and moves
   to `issue` require explicit user confirmation. The scheduled gmail-orders
   task may NEVER move a status backward autonomously — it flags anomalies
   (e.g. a `delivered` item reported backordered) for the user. Every
   transition is recorded in `order_events`; history is never overwritten.

4. **Provenance columns added** (`chosen_because`, `outcome`, `outcome_notes`
   on `line_items`) so the commodity map is a future query, not a
   wish-we'd-collected-it dataset. All nullable — skills that don't know
   them write null. **`users` table added** with the explicit `sharing`
   consent tier (`local`/`hosted`/`community`); `community` is a stub in v0.

Bill: these are all additive or as-drafted — your two skills' output formats
are unchanged. Ack or object here.
