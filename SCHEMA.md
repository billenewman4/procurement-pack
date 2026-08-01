# Schema Contract — DRAFT (lock with Eshan before building)

This is the interface between all workstreams. Both skills emit records shaped
like this; the DB tables mirror it. Change it here first, everywhere else second.

## projects
| col | type | notes |
|---|---|---|
| id | uuid | |
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
| project_id | uuid | |
| description | text | human name: "step-down converter 12V→5V 3A" |
| part_number | text | nullable — bespoke items may not have one |
| vendor | text | nullable until sourced |
| product_url | text | nullable |
| qty | int | |
| unit_price | numeric(10,2) | nullable |
| status | enum | `needed` → `researching` → `ordered` → `shipped` → `delivered` → `issue` |
| source | enum | `manual` \| `search` \| `email` |
| ordered_at | timestamptz | nullable |
| eta | date | nullable |
| notes | text | spec-match caveats, alternates considered |

## order_events (audit trail; gmail-orders appends here)
| col | type | notes |
|---|---|---|
| id | uuid | |
| line_item_id | uuid | nullable — unmatched events kept for manual reconcile |
| project_id | uuid | |
| vendor | text | |
| order_number | text | |
| event | enum | `confirmed` \| `shipped` \| `delivered` \| `backordered` \| `issue` |
| event_at | timestamptz | |
| tracking_url | text | nullable |
| email_ref | text | Gmail message id, for "show me the email" |
| raw_summary | text | one-line extract, no full email bodies stored |

## decisions (append-only — the compounding asset)
One row per part-search that presented options. This is what turns usage into
a substitution graph: not what got bought, but what was on screen and what won.
| col | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid | |
| ts | timestamptz | |
| need | text | one-line summary of what was being sourced |
| phase | enum | `before_choice` \| `after_choice` — was a part already picked when search was invoked? (the pull metric) |
| options | jsonb | array of {mpn, vendor, spec_verdicts, price} as presented |
| chosen | text | MPN chosen, or null if declined/deferred |
| rejected | jsonb | array of {mpn, reason} — includes candidates the skill itself rejected |

## misses (append-only — the coverage map)
| col | type | notes |
|---|---|---|
| id | uuid | |
| project_id | uuid | |
| ts | timestamptz | |
| need | text | what was being looked for |
| kind | enum | `not_found` \| `no_datasheet` \| `spec_unverifiable` \| `spec_unmet` \| `bot_walled` |
| detail | text | one line |

## Open questions for the schema lock
- Per-user isolation: separate databases vs one DB with schemas + RLS?
- Does `project_specs` need structure (key/value) or is freeform text enough for v0?
- Status transitions: who may move a line backward (e.g. `delivered` → `issue`)?
