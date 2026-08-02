# TEAM_SETUP.md — join the shared BOM database

You are a Claude agent setting up the procurement pack for a TEAM MEMBER who
was given a database connection string by a teammate. Read this entire file,
then follow the steps in order. Surface: Claude Code on a persistent machine
(this flow needs a shell). Target: under 5 minutes. Ask the user ONLY the
questions marked [ASK].

## Step 1 — Get the repo

If `~/procurement-pack` exists, `git -C ~/procurement-pack pull`; otherwise:

```bash
git clone https://github.com/billenewman4/procurement-pack.git ~/procurement-pack
```

(If the user already has a clone elsewhere — they may be a contributor — use
that path everywhere below instead.)

## Step 2 — Install the database server

```bash
cd ~/procurement-pack/bomdb && npm install
node --version   # must be >= 23.6; if older, stop and help the user upgrade Node first
```

## Step 3 — Connect to the shared database

[ASK] "Paste the DATABASE_URL your teammate sent you (starts with
`postgresql://`)." Then:

1. Write it to `~/procurement-pack/bomdb/.env` as `DATABASE_URL=<value>`
   (this file is gitignored — verify with `git check-ignore bomdb/.env`).
2. Register the MCP server:

```bash
claude mcp remove bomdb -s user 2>/dev/null || true
claude mcp add --scope user bomdb -e DATABASE_URL="<value>" -- node ~/procurement-pack/bomdb/src/server.ts
claude mcp list   # verify: bomdb ✔ Connected
```

3. Prove the shared data is visible — run a quick node script against
   `src/engine.ts` + `src/operations.ts` calling `list_projects`, and show
   the user the project names that come back. If the list is empty or the
   connection fails, STOP and debug (wrong URL and IPv6-only networks are
   the common causes) — do not continue on a dead connection.

## Step 4 — Wire up Claude Desktop (if installed)

Check for `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS). If present, ADD this entry under `mcpServers` — merge carefully,
never overwrite existing entries, and validate the JSON afterward:

```json
"bomdb": {
  "command": "<absolute path from `which node`>",
  "args": ["<absolute path to>/procurement-pack/bomdb/src/server.ts"],
  "env": { "DATABASE_URL": "<value>" }
}
```

The absolute node path is REQUIRED — Desktop launches servers without the
user's shell PATH. Tell the user: "fully quit Claude Desktop (⌘Q) and reopen
it — the database tools load at startup."

## Step 5 — Install the skills

```bash
mkdir -p ~/.claude/skills
ln -sfn ~/procurement-pack/skills/part-search  ~/.claude/skills/part-search
ln -sfn ~/procurement-pack/skills/gmail-orders ~/.claude/skills/gmail-orders
```

These auto-load in Claude Code and local Desktop sessions. Then tell the
user, verbatim-ish: "One manual step only you can do: cloud sessions can't
see locally-installed skills, so if you also work in claude.ai or cloud
Desktop chats, save the skills to your account — I can package them as
.skill cards right now; you click Save on each. Want that?" If yes, package
`skills/part-search` and `skills/gmail-orders` as `.skill` files and present
them. WAIT for the user to confirm they clicked Save before calling this
step done — this click is the most-missed step in real installs.

## Step 6 — Verify end-to-end and hand off

1. Ask bomdb for `get_project_context` on one existing project and show the
   user its specs — proof they're seeing the team's live data.
2. Tell the user their two entry points from here:
   - Join an existing project: just talk about it ("what's on the BOM for
     <project>?", "find me a part for it").
   - Start their own: say "I'm starting a new hardware project: <one line>.
     Set it up in my BOM database — create the project, interview me briefly
     for specs and store each one."
3. Remind them: everything is shared — every teammate sees every project,
   spec, and order. That's the point.
4. If the user is a repo maintainer, point them at the "Locked decisions"
   section at the bottom of SCHEMA.md and ask them to ack or object there.

## Known limitations to state honestly if asked

- bomdb is a locally-registered server: cloud sessions (claude.ai, cloud
  Desktop containers) cannot reach it. Work in Claude Code or local Desktop
  chats.
- No per-user isolation yet: concurrent edits to the SAME line item are
  last-write-wins. Fine for a small team; flag it if it ever bites.
