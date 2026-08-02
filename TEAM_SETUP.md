# TEAM_SETUP.md — hosted-mode setup

You are a Claude agent setting up the procurement pack for a user who has been
given a personal database connection string (starts with `postgresql://`).
Read this entire file, then follow the steps in order. Surface: a terminal
running Claude Code. Target: under 5 minutes of the user's attention. Ask the
user ONLY the questions marked [ASK]. If a step fails, follow its failure
branch — never abandon setup silently, and never continue past a dead
database connection.

Their connection string is scoped to THEM: they see and touch only their own
projects. Do not promise them visibility into anyone else's data, and do not
treat an empty project list as an error — for a new user, empty is correct.

## Step 1 — Prerequisite: Node 23.6+

```bash
node --version
```

Failure branch (missing or < 23.6): offer to install it before anything else
— `brew install node` on macOS if Homebrew exists, otherwise guide them to
nodejs.org. Do not proceed without it; bomdb runs TypeScript natively on
modern Node and there is no build step.

## Step 2 — Get the pack

If `~/procurement-pack` exists: `git -C ~/procurement-pack pull`. Otherwise:

```bash
git clone --depth 1 https://github.com/billenewman4/procurement-pack.git ~/procurement-pack
cd ~/procurement-pack/bomdb && npm install
```

Failure branch (no git): download and extract
`https://github.com/billenewman4/procurement-pack/archive/refs/heads/main.zip`
to `~/procurement-pack`, then `npm install` in `bomdb/`.

## Step 3 — Connect to their database

[ASK] "Paste the connection string you were sent (starts with
`postgresql://`)." Then:

1. Save it to `~/procurement-pack/bomdb/.env` as `DATABASE_URL=<value>` and
   verify the file is gitignored (`git check-ignore bomdb/.env` prints a path).
2. Register the MCP server:

```bash
claude mcp remove bomdb -s user 2>/dev/null || true
claude mcp add --scope user bomdb -e DATABASE_URL="<value>" -- node ~/procurement-pack/bomdb/src/server.ts
claude mcp list   # verify: bomdb ✔ Connected
```

3. Prove the connection with a real read — run a short node script against
   `src/engine.ts` + `src/operations.ts` calling `list_projects` with their
   DATABASE_URL. A NEW user correctly sees `[]` — tell them "connected; your
   workspace is empty and private, we'll create your first project in a
   minute." An existing user sees their own projects.

Failure branch (connection refused/timeout): some networks can't reach
Supabase's direct IPv6 host. Retry with the IPv4 session-pooler form of the
same string — swap host to the pooler host and username to
`<role>.<project-ref>` per Supabase docs — and if that connects, use the
pooler string everywhere below. If both fail, stop and have the user contact
whoever sent the string.

## Step 4 — Wire up Claude Desktop (if installed)

If `~/Library/Application Support/Claude/claude_desktop_config.json` exists,
ADD this under `mcpServers` — merge carefully, never overwrite other entries,
validate the JSON afterward:

```json
"bomdb": {
  "command": "<absolute path from `which node`>",
  "args": ["<home>/procurement-pack/bomdb/src/server.ts"],
  "env": { "DATABASE_URL": "<value>" }
}
```

The absolute node path is REQUIRED (Desktop launches servers without the
user's shell PATH). Tell the user: "fully quit Claude Desktop (Cmd-Q) and
reopen it; the database tools load at startup. Use LOCAL chats — cloud
sessions can't reach a local server."

## Step 5 — Install the skills

```bash
mkdir -p ~/.claude/skills
ln -sfn ~/procurement-pack/skills/part-search  ~/.claude/skills/part-search
ln -sfn ~/procurement-pack/skills/gmail-orders ~/.claude/skills/gmail-orders
```

These auto-load in Claude Code and local Desktop sessions. Then say: "If you
also use claude.ai or cloud chats, the skills need to be saved to your
account — I can package them as .skill cards now; you click Save on each."
If they want it, package both and WAIT for the user to confirm they clicked
Save before moving on — this click is the most-missed step in real installs.

## Step 6 — Create their first project

[ASK] "What are you building? One line is plenty." Then create the project
via the bomdb `create_project` tool and interview them ONCE for specs —
power, connectors/interface, materials, constraints (budget, shipping
priority, country-of-origin) — storing each with `upsert_spec`. If they
defer, pick sensible beginner defaults, store them, and TELL them what you
chose. Read the stored specs back when done.

## Step 7 — Verify end-to-end and teach

1. Check Gmail: if Gmail MCP tools are available, run the cheapest read to
   confirm auth and tell them order tracking is on. If not: "connect Gmail at
   claude.ai settings → connectors to enable order tracking — everything else
   works without it." Never block on this.
2. Run ONE real part search against their new specs using
   `skills/part-search/SKILL.md` and offer to add the result to their BOM.
   This is the success signal — they should see the spec-check.
3. Teach (verbatim-ish): "Just talk to me — 'find me a part', 'catch me up on
   my orders', 'what's still not ordered'. Your data is yours: only you (and
   the team operating the database) can see it."

## Known limitations to state honestly if asked

- bomdb is a locally-registered server: cloud sessions (claude.ai, cloud
  Desktop containers) can't reach it. Claude Code or local Desktop chats.
- Scheduled background email sync is untested on claude.ai scheduled tasks;
  the catch-up-on-open sweep covers the gap.
- No delete operation by design; statuses only move backward with explicit
  confirmation.
