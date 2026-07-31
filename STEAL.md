# What to steal from gstack + gbrain

Findings from a teardown of both codebases (gbrain source: `/Users/bill/gbrain`;
gstack install: `~/.claude/skills/gstack`). Organized by who needs it and when.

---

## A. For Eshan — the database workstream (changes his plan)

**Verdict: don't build a hosted-Postgres MCP from scratch. Steal gbrain's
engine scaffolding into a tiny `bomdb` MCP server.** gbrain already solved
"local Postgres-semantics DB now, hosted Postgres later, same code":

| Take | From (in /Users/bill/gbrain) | ~Lines |
|---|---|---|
| Engine switch (PGLite ↔ Postgres) | `src/core/engine-factory.ts` | 26 |
| PGLite single-writer lock | `src/core/pglite-lock.ts` | 148 |
| Migration runner | `src/core/migrate.ts` (type + runner) | ~150 |
| MCP server + tool-def generator + dispatch | `src/mcp/server.ts`, `tool-defs.ts`, `dispatch.ts` | ~440 |
| Serve lifecycle (signals, stdin EOF, parent-PID watchdog) | `src/commands/serve.ts` | ~200 |
| Config resolution — `DATABASE_URL` always wins | `src/core/config.ts:378-469` | ~60 |

Plus our own: the 3 `CREATE TABLE`s from SCHEMA.md as a string constant, and
~10 ops (`create_project`, `upsert_line_item`, `record_order_event`,
`query_bom`, `stale_orders`, …) in gbrain's `Operation` registry style
(`src/core/operations.ts` top-of-file types) — one registry generates the MCP
tools AND a CLI for free.

Registration (from the hardened gstack-setup-gbrain pattern):
```bash
claude mcp remove bomdb -s user 2>/dev/null || true
claude mcp add --scope user bomdb -- /abs/path/to/bomdb serve
claude mcp list   # verify Connected; restart sessions to load tools
```

Why this wins:
- **Local-first now** (PGLite = real Postgres 17 in-process, `~/.bomdb/` datadir,
  no server), **hosted later** = `export DATABASE_URL=...` — one config line,
  same SQL, same ops. Kills the "must host a remote MCP endpoint per user"
  weekend problem AND answers Ben's data-sensitivity objection (local mode = we
  never see it) with the same codebase.
- MCP scaffolding is ~450 generic lines; ours would be ~300-600 lines of ops.

Cautions (gbrain's scar tissue):
- PGLite is WASM; gbrain carries platform-bug classifiers
  (`pglite-engine.ts:180-196`). Test on demo users' exact macOS versions.
- Make the MCP server the ONLY writer; don't copy gbrain's
  kill-the-server-before-CLI workaround, and drop the lock's
  "force-break after 5 min even if holder is alive" branch (`pglite-lock.ts:82-86`).
- Ship as a prebuilt binary (Bun `--compile`) or npx — do NOT require users to
  install Bun (gbrain's documented postinstall failure mode).

**Do NOT use gbrain itself as the BOM store.** Schema packs are a page-type
taxonomy over fixed tables (closed 5-primitive enum, no DDL, no relational
queries) — line items/order events would become markdown pages you can't
aggregate. Also 89 MCP tools of context pollution and a ~30-min install. The
one future exception: gbrain as a *second* store for semantic search over
datasheets/supplier emails, next to bomdb.

**Bill's JSON local store (`store/README.md`) stays** as the zero-install
fallback + human-readable interchange format; give bomdb
`export --json`/`import --json` against that exact shape.

---

## B. Distribution & install UX (the open-source play — post-weekend)

From gstack (`~/.claude/skills/gstack`):

1. **The repo IS the install.** One clone into `~/.claude/skills/<pack>`;
   `./setup` walks skill dirs and creates wrapper dirs with absolute SKILL.md
   symlinks (real dir + symlinked file — a symlinked dir breaks Claude's
   naming). `git pull` is the whole update mechanism. Model: `setup:539-585`.
   Windows: copy fallback, no raw `ln`.
2. **Paste-a-prompt install** (`README.md:51`): a natural-language instruction
   that clones, runs setup, and has Claude write a routing section into
   CLAUDE.md. Converts better than curl|sh for this audience — this is the
   "copy a prompt, paste it, it walks you through" UX from our meeting.
3. **Upgrade as a prompt-runbook skill**: `VERSION` file checked against
   raw.githubusercontent, ~1h throttle; AskUserQuestion with
   yes / always-auto / snooze (24h→48h→7d, resets on new version) / never;
   idempotent `migrations/v*.sh`; then the LLM diffs CHANGELOG and summarizes.
   Model: `gstack-upgrade/SKILL.md`, `bin/gstack-update-check`.
4. **One `<pack>-config` CLI over a self-documenting `~/.<pack>/config.yaml`**
   (file is 99% commented docs; skills call
   `config get <key> 2>/dev/null || echo default`, never parse YAML).
5. **Progressive one-time prompts** via zero-byte marker files
   (`~/.<pack>/.welcome-seen` etc.) — max one onboarding question per session,
   strictly sequenced. Our sequence: intro → Gmail consent → DB init → telemetry.
6. **State-dump preamble**: skills open with one bash block printing
   `KEY: value` lines, then prose rules "If KEY is X, do Y" — bash gathers
   state, English branches.

## C. Telemetry / usage visibility (answers the meeting's open question)

gstack's three-tier consent, wholesale (`bin/gstack-telemetry-log`,
`bin/gstack-telemetry-sync`, `supabase/config.sh`):

- `telemetry: off | anonymous | community` in config (invalid → off).
- Events = single-line JSON appended locally (`~/.<pack>/analytics/*.jsonl`);
  logger must never exit non-zero.
- Sync: backgrounded, ≥5-min rate limit, line cursor, batches ≤100 to a
  Supabase **edge function**; anon key committed in plaintext is safe because
  RLS denies everything (writes only via edge functions).
- Local-only fields are underscore-prefixed and sed-stripped before upload;
  anonymous tier also strips the device UUID.
- Consent prompt once, sequenced after the intro; on decline, offer anonymous
  before falling to off. Never prompt in spawned/headless sessions.

This gives us "did they turn it on / did they use it" without owning their data
— compatible with local-first bomdb.

## D. INSTALL_FOR_AGENTS.md pattern (for the GitHub repo)

From `/Users/bill/gbrain/INSTALL_FOR_AGENTS.md`: install docs addressed to the
*coding agent*, not the human. Elements to copy: opening instruction ("read
this entire file, then follow the steps; ask the user for keys when needed"),
per-step copy-pasteable block + explicit verification command, inline
known-failure branches with recovery commands, explicit stop-and-ask gates for
real decisions (with a recommendation and stakes), `--json` flags on every
command, and "if `claude` is not on PATH, note it and continue" degradation.
Our version is the entire onboarding story for Clark/Harry: they paste one
prompt, their Claude reads the doc and does the rest.
