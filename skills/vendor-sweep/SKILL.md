---
name: vendor-sweep
description: Use when building or refreshing the user's vendor list from purchase history in email — "set up my vendors", "scan my email for vendors", "who do I buy from" — or when invoked by the bomdb onboarding flow. Confident findings write immediately; ambiguous ones stay out.
---

# Vendor Sweep

## Overview

One sweep of the user's Gmail to build their vendor CRM: every supplier
they've bought from, with the parts bought from each. Starting the sweep is
the consent: confident findings write immediately (the email is the
evidence), ambiguous ones stay out, and the user edits conversationally
afterward — the dashboard is where they review, not an approval table.

**Privacy contract:** classification may surface non-purchase emails as
candidates — read no more than sender/subject/snippet before discarding
them, and never store, summarize, quote, or reference any email outside
classified purchase emails.

**Window:** 2 weeks by default. Say so up front, and offer to sweep deeper
(months, or everything) on request.

## Step 1 — Retrieve broadly, classify precisely

Three passes, cheap fields only (sender/subject/snippet):

1. `category:purchases newer_than:14d` — Gmail's own purchase classifier is
   the best single source; start here. Known quirk: combining `category:`
   with date operators can return empty — if it does, run
   `category:purchases` bare and filter to the window by each result's date.
2. Targeted sweeps for the domains of any vendors already in `list_vendors`.
3. Broad pass over the window — `invoice OR quote OR "purchase order" OR
   "your order" OR RFQ` — forwarded and oddly-routed vendor emails only
   show up here.

Classify each candidate yourself from sender/subject/snippet: is this a
purchase of physical goods from a supplier? SaaS receipts, subscriptions,
and marketing are not. Fetch the full body (`plaintextBody` only — never
HTML) ONLY for emails classified as purchase-related; discard everything
else immediately.

## Step 2 — Extract per email

- Vendor name and sender email domain(s).
- Parts/descriptions, order dates, amounts — ONLY when explicitly stated.
  Use `null` for anything not literally in the email; never infer.
- One exact quote per extracted row as evidence, e.g. "Your order 1234ABCD
  has shipped: M3x10 SHCS, 100-pack — $8.42".

Confidence gate: any row you are not certain about goes on a "not sure"
list for the user to judge — never silently included, never silently
dropped. Dedup vendors by email domain and case-insensitive name
(mcmaster.com + "McMaster-Carr" + "mcmaster carr" = one vendor).

## Step 3 — Write immediately, report simply

The user already consented to the sweep (starting it IS the consent —
the email evidence speaks for itself). No proposal table, no approval
pause:

1. **Write every confident row now.** Ambiguous rows stay OUT — never
   silently included. Physical goods only, strictly: software/SaaS
   receipts, subscriptions, memberships, and personal shopping NEVER
   become vendors, no matter how invoice-shaped the email looks.
2. **Report in one short, plain beat:** "I found 4 vendors and 8 parts
   in your email and added them to your list." One extra line if
   anything was left out: "I skipped a few I wasn't sure about — ask
   and I'll show you." No tables, no technical language (never say
   dedupe, one-off, line item, confidence).
3. **Then show, don't tell:** go straight to the dashboard so they see
   their vendor list, and invite corrections — "spot anything wrong?
   Just tell me and I'll fix it." Edits happen after, conversationally
   (remove a vendor, rename, add something missed).

## Step 4 — How to write

Per vendor: `upsert_vendor` with source `email_sweep` and the domains
array. Then per part: `upsert_line_item` with the vendor NAME
(auto-links to the CRM), NO project_id (historical purchases are
one-offs), source `email`, and the evidence quote in `notes`.

Status must match what the email trail actually shows:
- Arrived (or old enough that arrival is obvious): `delivered`.
- Shipped / in transit / ETA in the future: `ordered`, then
  `record_order_event` (event `shipped`, the item's line_item_id, no
  project_id, event_at from the email) so the dashboard shows it in
  Ordered with a shipped badge — never flatten an in-flight order to
  delivered.
- Ordered but no shipping notice yet: `ordered`.
- A quote with no purchase: vendor only — no line item unless the user
  asks to track it (then status `quoting`).

## Common mistakes

- Pausing for approval before writing — starting the sweep was the consent; the dashboard is the review surface.
- Inferring amounts, dates, or part names not literally in the email.
- Reading full bodies before classification — snippet-only until then.
- Counting SaaS receipts, subscriptions, or personal shopping as vendors.
- Duplicate vendors that differ only by casing or domain.
- Skipping the not-sure list — silently included and silently dropped are
  both wrong.
