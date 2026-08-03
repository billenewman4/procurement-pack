# TEAM_SETUP.md — hosted-mode setup

You are a Claude agent setting up the procurement pack for a user who has been
given a personal database connection string (starts with `postgresql://`).
Read this entire file, then follow the steps in order. You are running in
their **terminal**; the app they will actually use afterward is the **Claude
Desktop app**. Setup isn't done until Desktop works (Step 4) and they've run
their first search there (Step 7). Target: under 5 minutes of the user's
attention. Ask the user ONLY the questions marked [ASK] — there are two. If a
step fails, follow its failure branch — never abandon setup silently, and
never continue past a dead database connection.

Assume the user is not technical. Say "your terminal" and "the Claude Desktop
app"; never say Claude Code, MCP, server, connector, local vs cloud, or
symlink. Don't narrate the steps you're doing — report only what changed for
them and what they need to do next.

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

## Step 4 — Wire up Claude Desktop (THE step that matters)

You are running in the user's **terminal**. That is the setup surface, not
the destination — day to day they will work in the **Claude Desktop app**.
Getting Desktop working is the point of this install; treat a terminal-only
success as an incomplete install.

Language to use with the user throughout: "your terminal" and "the Claude
Desktop app". Never say Claude Code, MCP server, local vs cloud session, or
connector — those are our words, not theirs.

If `~/Library/Application Support/Claude/claude_desktop_config.json` exists,
ADD this under `mcpServers` — merge carefully, never overwrite other entries,
back the file up first, validate the JSON afterward:

```json
"bomdb": {
  "command": "<absolute path from `which node`>",
  "args": ["<home>/procurement-pack/bomdb/src/server.ts"],
  "env": { "DATABASE_URL": "<value>" }
}
```

The absolute node path is REQUIRED (Desktop launches servers without the
user's shell PATH). If the config file does NOT exist, Desktop isn't
installed — tell them to install it from claude.ai/download and finish this
step before moving on; do not quietly skip it.

Then tell them, in these words: "Quit the Claude Desktop app completely —
click on Claude and press Cmd-Q. Closing the window isn't enough. Then open
it again." Do not continue until they confirm they've done it.

## Step 5 — Install the skills

```bash
mkdir -p ~/.claude/skills
ln -sfn ~/procurement-pack/skills/part-search  ~/.claude/skills/part-search
ln -sfn ~/procurement-pack/skills/gmail-orders ~/.claude/skills/gmail-orders
ls ~/.claude/skills/part-search/SKILL.md ~/.claude/skills/gmail-orders/SKILL.md
```

Both paths must print. This covers the terminal and the Desktop app's coding
surface — say "part search and order tracking are installed" and continue.

## Step 5.5 — Make the skills reach Cowork chats

The symlinks above do NOT reach Cowork: Cowork sessions run sandboxed and
don't read the machine's `~/.claude/skills`. If the user will work in Cowork
(ask only if they mention it, or they've asked where the skills are), give
them the account-saved path — it makes the skills available in Cowork, web,
and Desktop chats alike:

1. Tell them: "One click makes these available everywhere you use Claude,
   not just this computer." Then guide them to save both skills to their
   Claude account — via Claude's skills/capabilities settings (upload), or
   by having a claude.ai chat package the two folders under
   `~/procurement-pack/skills/` as saveable skill cards and clicking **Save**
   on each. The click is theirs; never claim it's done until they confirm.
2. Remind them: skills load at session start — a Cowork chat opened before
   the save won't see them; start a fresh one.

TO VERIFY (maintainers, not users): whether Cowork honors
`<workspace-folder>/.claude/skills/` like Claude Code project skills. If yes,
a zero-click alternative is dropping the skills into the folder the user
opens Cowork on — test it and replace this note with the instruction.

Known gap, state honestly if the user asks: the database (bomdb) may not be
reachable from Cowork sessions even once skills are — the server registered
in Steps 3–4 serves the terminal and Desktop chats. If their Cowork search
can't reach the BOM, that's expected for now; the hosted-connector work
tracks the fix.

## Step 6 — Create their first project

[ASK] "What are you building? One line is plenty." Then create the project
via the bomdb `create_project` tool and interview them ONCE for specs —
power, connectors/interface, materials, constraints (budget, shipping
priority, country-of-origin) — storing each with `upsert_spec`. If they
defer, pick sensible beginner defaults, store them, and TELL them what you
chose. Read the stored specs back when done.

## Step 7 — Hand off to the Desktop app

The install is not finished until they have seen it work in the app they'll
actually use. Do NOT run the first part search yourself in the terminal —
send them to Desktop to run it, so their first real result happens where
they'll be working from now on.

1. Check Gmail: if Gmail tools are available, run the cheapest read to
   confirm auth and tell them order tracking is on. If not: "connect Gmail in
   your Claude settings to turn on order tracking — everything else works
   without it." Never block on this.
2. Tell them, in these words: "Setup's done. Open the Claude Desktop app,
   start a new chat, and paste this:" — then give them a real first prompt
   built from the specs they just gave you, e.g. "Find me <a part their
   project actually needs>. Check it against my project specs and show me the
   options."
3. Tell them what to expect: a table of real parts with links and prices, and
   a note on how each one fits their build. Then: "say 'add the first one to
   my BOM' to save it."
4. Teach the rest (verbatim-ish): "Just talk to me — 'catch me up on my
   orders', 'what's still not ordered', 'I just ordered X from McMaster'. I
   remember between chats, so you never re-explain your project. Your data is
   yours: only you (and the team operating the database) can see it."
5. Last line: "If the search comes back saying it can't find your project,
   the app didn't fully restart — quit it with Cmd-Q and open it again."

## Known limitations to state honestly if asked

- Your projects are reachable from your terminal and the Claude Desktop app
  on this computer. Claude in a web browser can't see them.
- Scheduled background email sync is untested; the catch-up sweep when you
  open a chat covers the gap.
- No delete operation by design; statuses only move backward with explicit
  confirmation.
