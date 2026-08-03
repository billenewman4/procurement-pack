# Phase 3+4: Concierge, Dashboard, Digest — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A brand-new user goes from "set up my BOM" to project + specs + skills + Gmail + digest with no docs; every returning conversation starts context-warm; "show me my BOM" renders a consistent dashboard artifact.

**Architecture (per the tools-vs-skills split agreed 2026-08-03):**
- `get_dashboard_data` — new SHARED op in `bomdb/src/operations.ts` (SQL aggregates; local + hosted both get it).
- `get_started` — HOSTED-ONLY concierge tool in `bomdb-remote/src/concierge.ts`: inspects real DB state, returns either the new-user onboarding script or a returning-user briefing. Tool description keys on "set up my BOM" and BOM-related asks (NOT every conversation — decided with Eshan).
- Empty-`list_projects` hint appended in `app.ts` (state-aware nudge).
- `skills/bom-dashboard/SKILL.md` — NEW skill: artifact layout template that renders `get_dashboard_data` output. (Load the dataviz skill before authoring.)
- Digest = self-contained scheduled-task prompt embedded in concierge text (does NOT depend on skills loading in scheduled runs — untested; self-containment moots it).
- Onboarding state is INFERRED (0 projects = new; missing specs = interview pending). No schema change — scoped roles can't ALTER, and inference suffices for V1.

**Test loop:** provision a throwaway `testnoob` user (master URL is in `bomdb/.env`; script prints pooler string), add a second token to `TOKEN_MAP`, and Eshan adds a second connector — that's the "sign up as a fresh user" loop without touching his real workspace.

---

### Task 1: `get_dashboard_data` (TDD, shared op)

Failing test in `bomdb/test/operations.test.ts` style: seed a project with
specs + line items in several statuses + an order event, call
`runOp(engine, 'get_dashboard_data', {})`, assert shape:
`{ projects: [{ id, name, spec_categories, status_counts, total_committed,
open_issues, stale_items, recent_events }] }` where `total_committed` =
Σ qty·unit_price over ordered+ items; `stale_items` reuses the
`stale_orders` op's definition. Then implement as one op with a few
aggregate queries. All existing tests stay green.

### Task 2: Concierge (TDD, hosted)

`bomdb-remote/src/concierge.ts`: `GET_STARTED_TOOL` def +
`getStartedText(engine): Promise<string>`.
- 0 projects → new-user script: welcome; ask what they're building;
  `create_project`; ONE spec interview (power, connectors, mechanical,
  constraints — store via `upsert_spec`, read back); then skill save-cards
  (fetch raw GitHub URLs for part-search, gmail-orders, bom-dashboard;
  package; user clicks Save; "new chat" note); Gmail nudge (check tools,
  settings link, never block); digest offer with the FULL self-contained
  task prompt; closing usage lines.
- ≥1 project → briefing: per-project one-liners (status counts, spend,
  missing spec categories), recent order events, stale items, then AT MOST
  two nudges. Compact — it's context, not conversation.
Tests: new-user text contains the interview + skill URLs; seeded-project
text contains project name, status summary, and NO welcome script.
Wire into `app.ts`: tool listed, calls routed; `list_projects` returning
`[]` gets an appended hint. Test both.

### Task 3: `skills/bom-dashboard/SKILL.md`

Load the dataviz skill FIRST, then author: frontmatter (name,
description triggering on "show me my BOM / dashboard / status"), body:
call `get_dashboard_data`, render ONE self-contained HTML artifact —
header + per-project status tiles, committed-spend line, items table
grouped by status, stale/issue callouts. Theme-aware, no external
resources, wide tables scroll. Push to GitHub before save-cards can work.

### Task 4: Test user + config

`DATABASE_URL=<master from bomdb/.env> node bomdb/scripts/provision-user.ts
testnoob "Test Noob" testnoob@example.invalid` → take POOLER string.
`openssl rand -hex 24` → test token. Rewrite `env.yaml` as `TOKEN_MAP`
JSON: Eshan's EXISTING token → his pooler URL (unchanged — his connector
keeps working), test token → testnoob's pooler URL.

### Task 5: Deploy + verify (Eshan runs deploy)

Same `gcloud run deploy` as Phase 1. Curl checks: `get_started` with
Eshan's token → briefing containing real project names; with test token →
new-user script. Then UI: (a) Eshan adds second connector `BOM Fresh Test`
with the test-token URL, new chat, "set up my BOM" → full onboarding
happens conversationally incl. save cards; (b) on his real connector:
"show me my BOM dashboard" after saving the skill → artifact renders;
(c) recreate the digest scheduled task with the concierge-provided prompt
→ next weekday run writes statuses (report includes what it updated).

### Task 6: Results + push

Append Phase 3+4 results to the design doc; note the digest run as
pending-first-fire if not yet observed. Commit, push.
