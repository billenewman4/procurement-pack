# Hosted Connector & Zero-Terminal Onboarding — Design

**Date:** 2026-08-03
**Authors:** Eshan + Claude (brainstorm session)
**Status:** Approved design, pre-implementation

## Problem

Today bomdb is a stdio MCP server: it works only on the machine where setup
ran (terminal + Desktop app). claude.ai web, Cowork, mobile, and scheduled
tasks cannot reach the database. Setup requires a manually provisioned
connection string, Node, git, terminal use, a Desktop config edit, an app
restart, and two paste-batons — high friction, machine-bound, admin in the
loop for every user.

Target: a new user gets, out of the box and on every surface, (1) ongoing
DB context on their BOM/suppliers/specs, (2) conversations that get smarter
anywhere and keep updating the BOM, (3) artifact views of their data,
(4) scheduled jobs that read Gmail and update the BOM.

## Decisions made

- **Zero-terminal north star.** Onboarding happens entirely from
  claude.ai/Cowork. The terminal path survives as a power-user variant.
- **Hosted remote MCP connector** — bomdb over streamable HTTP. No
  Anthropic approval needed; custom connectors are self-serve by URL on all
  plans (Free limited to one connector; Team/Enterprise: only org Owners
  add connectors). Connections originate from Anthropic's cloud, so the
  server must be public HTTPS — which is exactly what makes it reach every
  surface.
- **Host: GCP Cloud Run.** Team already lives on GCP. Source-based deploy,
  scale-to-zero, streaming supported (60-min request timeout). NOTE:
  Eshan's GCP account may be at its project quota — check before creating
  a new project; deploying into an existing project is an acceptable
  fallback.
- **Identity: OAuth with provision-on-first-sign-in.** Supabase Auth
  (Google sign-in / email magic link) behind an MCP-compliant OAuth
  authorization server (discovery metadata, dynamic client registration,
  PKCE — use an off-the-shelf kit). Unknown verified email → workspace
  auto-created. Optional allowlist gate ("ask Bill for access").
- **Supabase stays** as Postgres + Auth. Existing RLS scoping carries over;
  each MCP request opens a DB session scoped to the token's user.
- **Skills distribute via account-save** (Bill's verified fetch-and-package
  pattern), but triggered by the connector's concierge, not a user-pasted
  baton.
- **Canonical first prompt:** "set up my BOM". Tool descriptions key on it
  so routing is deterministic. Product naming (e.g. a persona name for the
  connector) is an open decision — strings only, can land later.

## Architecture

```
User on any surface ──▶ Anthropic cloud (claude.ai / Cowork / Desktop /
                        mobile / scheduled tasks; account-saved skills)
        │ MCP over HTTPS (OAuth per user)         │ Gmail connector
        ▼                                          ▼
  Cloud Run: bomdb-remote                     Google APIs
  ── /mcp  StreamableHTTPServerTransport over existing
     engine.ts / operations.ts / tool-defs.ts (stateless;
     per-request user scoping)
  ── OAuth AS: discovery, DCR, PKCE → Supabase Auth upstream
  ── first-run concierge (see below)
        │ pg, RLS-scoped
        ▼
  Supabase: Postgres + Auth (identity, workspaces, BOM/specs/orders)
```

The local stdio server remains in-repo, sharing the same operations code.
Claude stays the only DB writer; artifacts remain render-only.

## The first-run concierge (not a skill)

Users never see tools; Claude reads tool descriptions and responses. The
concierge is deliberate use of that channel:

1. **`get_started` tool** — description tells Claude to call it first (and
   on "set up my BOM"). Server inspects the user's true state (projects?
   specs? Gmail seen?) and returns a tailored script: welcome, one-time
   spec interview, then progressive offers.
2. **Hints on normal tool responses** — e.g. empty `list_projects` carries
   "new user — offer setup"; guidance is state-aware, never stale.
3. `get_started` doubles as the **context loader** on every new chat:
   compact briefing of projects, open orders, recent changes, constraints.

Why not a skill: skills must be saved before they help (bootstrap dead
end); tool text arrives the moment the connector is added, and updates on
redeploy.

## Onboarding UX (the whole user journey)

1. **Add connector** — paste URL in Settings → Connectors → Connect →
   Google sign-in → workspace auto-provisioned. ~90 seconds.
2. **New chat: "set up my BOM"** — concierge welcomes, interviews once,
   creates project + specs. Functionalities 1–2 now work at baseline on
   every surface with no further setup.
3. **Skill hand-off** — concierge has Claude fetch the SKILL.md files from
   GitHub raw URLs and package them; user clicks **Save** on the cards
   (part-search, gmail-orders, bom-dashboard). Effective next chat.
4. **Gmail + digest (optional, prompted in-chat)** — deep-link to connect
   Gmail (OAuth consent is user-only), verify with a cheap read, then
   offer to create the weekday-morning digest scheduled task in-chat.

Lifetime mandatory friction: paste URL, Google sign-in, Save clicks,
Gmail consent — each an action only the user can perform, each surfaced
at the moment it's relevant.

## The four functionalities

1. **Context store** — existing schema/ops/RLS unchanged; reach extends to
   all surfaces.
2. **Smarter anywhere + writes back** — context-loader briefing on chat
   start; casual mentions ("ordered the SCD41 from Digi-Key") written back
   via the same tools. part-search still reads specs from DB before
   searching.
3. **Artifact views** — new `bom-dashboard` skill renders the standard
   BOM artifact (status board, spend, blockers). Regenerated per request;
   artifacts cannot reach the network. Deferred: live authenticated web
   dashboard served by the same Cloud Run service if demand appears.
4. **Scheduled Gmail → BOM sync** — the digest task reads Gmail, writes
   statuses through our connector, sends the digest. Hinges on smoke test
   #1 (below). Fallback if scheduled runs can't call custom connectors:
   catch-up sweep on chat-open does the writes; scheduled run stays
   report-only.

## Build order

- **Phase 0 — de-risk (a day):** GCP project-quota check (may need billing
  action; tell Eshan). Deploy a toy MCP server (one dummy tool, static
  token) to Cloud Run; add as custom connector; verify from web, Cowork,
  mobile. **Smoke test #1: can a scheduled task call the connector?**
- **Phase 1 — port bomdb to HTTP:** same ops code, new transport,
  per-request scoping, static test token. Exit: real BOM answers on
  claude.ai web + phone.
- **Phase 2 — OAuth + self-serve signup:** full flow, allowlist,
  `delete-workspace` admin op. Exit: wipe → re-add connector → fresh
  workspace via Google sign-in. Establishes the tweak→wipe→re-onboard
  iteration loop.
- **Phase 3 — concierge:** `get_started`, canonical prompt, hints, skill
  hand-off, Gmail nudge. Exit: fresh signup reaches project + specs +
  skills + Gmail with no docs.
- **Phase 4 — bom-dashboard skill + digest** (writes or fallback per
  Phase 0).
- **Phase 5 — docs flip:** README install card becomes two lines;
  TEAM_SETUP.md demoted to power-user path; baton sections retire.

## Open items

- Product/connector naming (persona? "Jason"-style) — strings only.
- ~~Scheduled-task → custom-connector support~~ — RESOLVED, see Phase 0
  results: supported. Functionality 4 proceeds as full sync.
- Team-plan users need an org Owner to add the connector — document.
- Live dashboard — deferred, YAGNI until asked for.

## Phase 0 results (2026-08-03)

All tests passed. Executed same-day as the design; plan at
`2026-08-03-phase0-derisk.md`.

**Deployment.** Toy server (`bomdb-remote/`, one unauthenticated `ping`
tool, stateless streamable HTTP) live at
`https://bomdb-remote-869731474645.us-central1.run.app/mcp`, Cloud Run
service `bomdb-remote`, **project `carbonella`**, us-central1, revision
`bomdb-remote-00001-ktm`.

**GCP quota resolution.** The remembered "max projects" limit is the
billing account's 5-project link quota (account `01CD63-5800C0-4522AF`,
exactly 5 linked). `lora-procurement-pack` exists but is unbilled; linking
it failed with `FAILED_PRECONDITION: Cloud billing quota exceeded`. Eshan
chose to deploy into billed project `carbonella`. Optional later: file the
billing quota-increase request and migrate; a custom domain would make the
move invisible to users.

**Surface reachability — connector added ONCE on claude.ai web:**

| Surface | Result |
|---|---|
| claude.ai web | ✅ pong 18:59:04Z (log line matches exactly) |
| Cowork desktop | ✅ pong 19:03:10Z — auto-synced after app restart, no re-add |
| Mobile app | ✅ pong — auto-synced |
| Claude Code terminal | ✅ bonus: account connector appears in `claude mcp list` as `claude.ai BOM DB test ✔ Connected` — hosted connector reaches even the terminal with zero local setup |

**Auth modes.** claude.ai accepted an unauthenticated custom connector
without warnings. OAuth remains the Phase 2 plan; no interim secrets.

**Smoke test #1 — scheduled task → custom connector: SUPPORTED.** A
one-off scheduled task created conversationally called `ping` and reported
a fresh pong (user-confirmed; verbatim task output not archived). Cloud
Run logs independently show initialize/list/call request clusters in the
19:05–19:08Z window matching the run. **Decision: functionality 4 is full
email→BOM sync from scheduled runs. The catch-up-on-open fallback is not
needed; Bill's report-only caveat can be retired when the real connector
ships.**

**Incidental findings.**
- `/healthz` is intercepted (404) by Google's frontend on `run.app`
  domains before reaching the container; renamed to `/health`
  (commit d89eabe). GETs otherwise reach the app fine — OAuth discovery
  endpoints in Phase 2 are unaffected.
- Mid-test, the *local* stdio bomdb began crashing: `EHOSTUNREACH` to
  Supabase's direct IPv6 host (network-dependent; worked the previous
  day). Fixed by switching all three registrations (bomdb/.env, Claude
  Desktop config, `claude mcp` user scope) to the IPv4 session pooler
  `aws-0-us-west-1.pooler.supabase.com` with user
  `postgres.<project-ref>`; authenticated test query returned all 3
  projects. This failure mode is exactly what the hosted connector
  eliminates.

**Cleared to proceed: Phase 1** (port real bomdb ops to the hosted
transport). Phase 1 exit checklist must include disabling/removing the
local bomdb registrations once tool names would collide on Desktop.

## Phase 1 + 1.5 results (2026-08-03, same day)

Shipped and verified — Eshan's real BOM now answers on every surface.
Plan: `2026-08-03-phase1-hosted-bomdb.md`.

**What shipped.**
- `bomdb-remote` serves the real ops (reusing `bomdb/src` verbatim) over
  streamable HTTP; revision `bomdb-remote-00002-cgp` on the same Cloud Run
  service/URL. Repo-root Docker build context (image needs both packages).
- **Interim auth = secret URL path** `/mcp/<48-hex-token>`: claude.ai
  custom connectors can't send custom headers, so until OAuth the URL is
  the credential. Untokened path 404s, wrong token 401s.
- **Phase 1.5 (pulled forward from discussion):** `TOKEN_MAP` env maps
  many tokens → per-user RLS-scoped `DATABASE_URL`s, engines lazily
  created and cached per token. This is the **team-scale V1**: teammates
  get personal tokened URLs, no OAuth needed until self-serve signup for
  strangers matters. Isolation is covered by test (token B cannot read
  token A's data). Runbook: `bomdb-remote/README.md`.
- `provision-user.ts` now prints both direct and pooler connection forms
  (`provision-lib.ts`, tested) — Cloud Run and many home networks need
  the IPv4 pooler.

**Exit tests (all passed).**
1. claude.ai web listed the 3 real projects through the connector.
2. Mobile listed the same.
3. Cross-surface write: line item added from a cloud surface appeared via
   the local stdio server too — both transports hit the same Postgres.
4. Guards verified by curl (404 untokened, 401 wrong token).

**Cleanup done.** Local bomdb removed from Claude Desktop config (backup
`claude_desktop_config.json.bak-phase1`) — Desktop now uses the account
connector like every other surface. The terminal `claude mcp` registration
stays for offline/dev work. `bomdb/.env` remains the canonical credential
copy.

**Token security posture (accepted interim):** the URL is a bearer
secret — it lives in connector settings and request logs; rotation =
new token + redeploy + user edits URL. Fine at known-team scale; OAuth
(Phase 2) remains the path for stranger-scale self-serve.

**Next:** onboard Bill with his own token as the first real Phase 1.5
user (runbook above), then Phase 3 concierge (`get_started`, "set up my
BOM", skill hand-off) — OAuth (Phase 2) can slot in after the concierge
since the team V1 doesn't need it.
