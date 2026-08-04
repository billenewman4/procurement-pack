# Vendor CRM + Onboarding Redesign — Design Doc

**Date:** 2026-08-04
**Source:** Aug 4 product review (Eshan + Bill, Granola: "Getlora product design — vendor CRM, bill of materials, and sourcing workflow")
**Decisions confirmed by:** Eshan, 2026-08-04

## Context

The product review landed four verdicts:

1. Onboarding jumps into design/part-search too fast. The onboarding job is: **build the user's vendor CRM from their email**. Nobody asked us to construct their BOM; they asked us to manage supplier email chaos and find suppliers.
2. Vendors must be first-class: a known-vendors list with the parts historically bought from each. No approved/unapproved states — killed.
3. Skills must install at **step zero** (Bill's run never saved them because it was step three).
4. The dashboard artifact is "one I'd never click again." Stay in artifacts for 1–2 more iterations: Vendors tab + BOM tab, pithier, action buttons at the best level the platform allows (verify what artifacts can actually do before designing).

Explicitly out of scope (deferred or Bill's repo): email drafting/purchase execution, our own vendor repository (0.1), full website UI, per-vendor playbook agent + fan-out sourcing (Bill's sourcing agent; we only relay).

## Confirmed decisions

- **Lifecycle statuses (simple):** `researching` → `rfq` → `po_placed` → `delivered`. Four states.
  - `shipped` and `issue` are **no longer statuses** — they are derived from `order_events` (which already records these). Dashboard badges shipped items inside the Ordered tab; open issues derive from events.
  - Quote receipt is not a status: quotes land as `line_item_options` rows while the item stays `rfq`.
  - Migration mapping: `needed`→`researching`, `researching`→`researching`, `ordered`→`po_placed`, `shipped`→`po_placed` (ensure a `shipped` order_event exists), `delivered`→`delivered`, `issue`→`po_placed` + ensure an `issue` order_event exists.
- **Gmail sweep window:** 6 months by default; Claude offers to go deeper on request.
- **Empty-inbox fallback:** offer paste/upload of a parts list (Excel, messy text) or just start a project and add parts as you go. **No design interview.**
- **Bill sync:** build now; share this doc with Bill after. His agent integrates through our tool contract, not raw SQL.

## W1 — Data model & operations

### Schema (bomdb/src/schema.sql)

```sql
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',       -- email domains seen for this vendor
  contact_email text,
  website text,
  notes text,
  source text NOT NULL DEFAULT 'manual',      -- 'email_sweep' | 'manual' | 'sourcing_agent'
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- unique per user on lower(name); RLS policy vendors_own mirroring existing tables
```

- `line_items`: add `vendor_id uuid NULL REFERENCES vendors(id)`, add `active boolean NOT NULL DEFAULT true`, make `project_id` **nullable** (NULL = part-master-list one-off, e.g. swept purchase history). Keep the existing `vendor` text column for back-compat; new code prefers `vendor_id`.
- `line_item_options`: add `vendor_id uuid NULL REFERENCES vendors(id)`.
- Status CHECK/validation moves to the four new states (accept old values in migration only).

### Operations (bomdb/src/operations.ts)

New:
- `upsert_vendor` — by (user, name) or matching domain; merges domains; returns vendor row.
- `list_vendors` — vendors with rollup: parts bought (line items linked via vendor_id, incl. inactive/historical), open items, last activity.
- `set_item_active` — hide replaced parts without deleting.

Updated:
- `upsert_line_item` — accepts `vendor_id` (or vendor name → auto-upsert vendor), accepts NULL project (one-off), accepts `active`.
- `update_status` — new enum; shipped/issue requests get a clear error steering to `record_order_event`.
- `record_order_event` — unchanged mechanics; now the sole home of shipped/issue.
- `get_dashboard_data` — add `vendors` section; status buckets = Researching(researching+rfq) / Ordered(po_placed, with shipped badge from events) / Delivered(delivered); `open_issues` derived from order_events (issue event with no subsequent resolution/delivery).
- `select_option` — stamps `vendor_id` too.

### Migration (bomdb/scripts/migrate.ts)

Idempotent, safe to rerun, runs for all existing users (eshan, bill, testnoob):
1. DDL adds (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS; drop+recreate status CHECK).
2. Extract distinct non-empty `vendor` strings per user from line_items + line_item_options → `vendors` rows (source='manual'), link `vendor_id`.
3. Status remap per the table above, inserting compensating order_events where needed.
4. Regrant RLS-scoped privileges for all pg_role users incl. vendors table.

### bomdb-remote (src/app.ts)

Expose `upsert_vendor`, `list_vendors`, `set_item_active`; update tool descriptions for the new status enum and vendor concepts. Also add `rename_project` (small backlog item, cheap while we're here).

## W2 — Onboarding rework

### New-user script (bomdb-remote/src/concierge.ts)

Menu is replaced by a linear flow (returning-user briefing unchanged in shape, updated for vendors):

- **Step 0 — skills, immediately.** Fetch all skills from the GitHub repo (raw URLs) in one pass, save all cards, tell the user what got installed. Include repo URL so Claude sees the full skill set at once. Skills: `vendor-sweep` (new), `part-search`, `gmail-orders`, `bom-dashboard`.
- **Step 1 — vendor CRM from email.** Ask: "Can I scan your last 6 months of email to build your vendor list? I'll show you everything before saving." On consent → run vendor-sweep skill → present findings (vendors + parts bought) → **user confirms** → write via `upsert_vendor`/`upsert_line_item` (one-offs: project_id NULL, status delivered). Consent rule unchanged: nothing written without confirmation in this conversation.
  - No Gmail / empty results → offer: paste or upload your parts list (Excel, CSV, messy text) → parse → same confirm-then-write; or "start fresh — create a project when you're ready."
- **Step 2 — offers.** Dashboard ("show me my BOM") and morning digest (existing DIGEST_TASK_PROMPT, updated statuses). Pithy, two lines.
- **No part search, no design interview, no spec questions** during onboarding.

### vendor-sweep skill (skills/vendor-sweep/SKILL.md)

Modeled on the digest's three-pass sweep: (1) `category:purchases` / order confirmations, (2) known vendor-domain pass, (3) broad pass (invoices, quotes, POs, "your order"). 6-month window. Extract: vendor name, domain(s), parts/descriptions, dates, amounts where stated. Exact quotes for evidence; confidence gate before proposing a part row; snippet-only until classified. Output: proposed vendor list + parts table for user confirmation. Never auto-write.

## W3 — Artifact research → dashboard redesign

**Research first (blocking the dashboard design):** Can a claude.ai/Cowork chat artifact (a) make network calls to our Cloud Run MCP (write-back)? (b) trigger a new Claude session/prompt from a button? (c) only copy to clipboard? Evidence: official docs on artifact sandbox/CSP, hands-on test if possible. Deliverable: verdict + the highest rung on the ladder write-back > launch-session > copy-prompt.

**Then dashboard (skills/bom-dashboard/SKILL.md, preserving Eshan's design language):**
- Tab 1 **BOM** — per-project + one-offs; buckets Researching / Ordered / Delivered per new statuses; shipped badge; ruled-out options dimmed (existing behavior).
- Tab 2 **Vendors** — known vendors, parts bought from each, last activity; inactive vendors hidden.
- Pithier throughout; keep 3 stat tiles, keep validated ramps.
- Action buttons at the researched level; if copy-prompt: "Source this part" copies a ready prompt.

## W4 — Claude Code paste-path

- Rewrite `INSTALL_FOR_AGENTS.md` GBrain-style: an executable protocol for the agent (read entire file → steps → verification checkpoints → ask user only for their token). Registration: `claude mcp add --transport http bomdb <url-with-token>`; then call `get_started`.
- README gets the paste-block: "Using Claude Code? Paste this one message." alongside the existing 60-second connector card.
- Note the sync asymmetry honestly: Code-added servers don't appear in claude.ai/Cowork; the connector path covers chat surfaces.

## W5 — Test harness (after W1+W2)

1. **Sweep extraction test:** seed realistic fake vendor emails in Eshan's inbox (incl. one PDF-attachment invoice) → run vendor-sweep → assert vendors/parts extracted, exact quotes present, no hallucinated rows.
2. **Messy-import test:** messy Excel/text parts list → import flow → assert BOM rows.
3. **Spec-dimension checklist:** add per-category dimension checklists (fastener, connector, sensor, PCB, raw material) to part-search skill + "ask when a dimension is unknown."

## Execution plan

- **Wave 1 (parallel):** A = W1 (worktree), B = W4 (worktree), C = W3 research (read-only).
- **Wave 2 (after A merges; parallel):** D = W2 concierge + vendor-sweep skill, E = W3 dashboard update (needs C's verdict).
- **Wave 3:** W5 with Eshan's inbox; migration run against prod DB; deploy by Eshan via `!` (permission classifier).
- Integrator: main session (this one). Bill gets this doc after W1 lands.
