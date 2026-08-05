---
name: vendor-sweep
description: Use when building or refreshing the user's vendor list from purchase history in email — "set up my vendors", "scan my email for vendors", "who do I buy from" — or when invoked by the bomdb onboarding flow. Read-only until the user confirms.
---

# Vendor Sweep

## Overview

One read-only sweep of the user's Gmail to build their vendor CRM: every
supplier they've bought from, with the parts bought from each. The output is
a proposal — NOTHING is written until the user confirms it in this
conversation.

**Privacy contract:** classification may surface non-purchase emails as
candidates — read no more than sender/subject/snippet before discarding
them, and never store, summarize, quote, or reference any email outside
classified purchase emails.

**Window:** 6 months by default. Say so up front, and offer to sweep deeper
on request.

## Step 1 — Retrieve broadly, classify precisely

Three passes, cheap fields only (sender/subject/snippet):

1. `category:purchases newer_than:6m` — Gmail's own purchase classifier is
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

## Step 3 — Propose, then STOP

Present compactly:

1. **Vendors table** — name, domain(s), purchases seen, last seen.
2. **Parts table** — description, vendor, date, amount, evidence quote.
3. **Not-sure list** — rows below the confidence gate, one line each.

Then stop and ask what to keep. NEVER auto-write — edits and removals
happen here, before anything touches the database.

## Step 4 — Write on confirmation only

Per confirmed vendor: `upsert_vendor` with source `email_sweep` and the
domains array. Then per confirmed part: `upsert_line_item` with the vendor
NAME (auto-links to the CRM), NO project_id (historical purchases are
one-offs), status `delivered`, source `email`, and the evidence quote in
`notes`.

## Common mistakes

- Writing before the user confirms — the proposal step is the product.
- Inferring amounts, dates, or part names not literally in the email.
- Reading full bodies before classification — snippet-only until then.
- Counting SaaS receipts, subscriptions, or personal shopping as vendors.
- Duplicate vendors that differ only by casing or domain.
- Skipping the not-sure list — silently included and silently dropped are
  both wrong.
