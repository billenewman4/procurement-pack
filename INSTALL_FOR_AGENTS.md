# INSTALL_FOR_AGENTS.md

You are a Claude agent setting up the procurement pack for your user. Read
this entire file, then follow the steps in order. Target: under 5 minutes.
Ask the user ONLY the questions marked [ASK]. If a step fails, follow its
failure branch and keep going — never abandon setup silently.

## Step 0 — Detect your surface

- **Claude Code, persistent machine** (shell, git, and a `~` that survives
  the session): follow path A in each step.
- **Cowork / claude.ai** (granted workspace folder, no home dir): path B.
- **Ephemeral cloud session** (you have a shell but the home dir dies with
  the session): path C — use the workspace store like path B, and instead of
  symlinking, package each skill directory as a `.skill` file and present it
  for the user to **Save skill** to their Claude account. Account-saved
  skills auto-trigger in future sessions — this is the durable install on
  this surface. Tell the user to click Save on each card.

## Step 1 — Get the pack

**A (Claude Code):**
```bash
git clone --depth 1 https://github.com/billenewman4/procurement-pack.git ~/procurement-pack
mkdir -p ~/.claude/skills
ln -sfn ~/procurement-pack/skills/part-search  ~/.claude/skills/part-search
ln -sfn ~/procurement-pack/skills/gmail-orders ~/.claude/skills/gmail-orders
ls ~/.claude/skills/part-search/SKILL.md ~/.claude/skills/gmail-orders/SKILL.md  # verify: both print
```
Failure branch: no `git` → download the GitHub zip via web fetch and unzip to
`~/procurement-pack`, then make the symlinks. Skills load at session start —
tell the user new sessions will have them.

**B (Cowork):** fetch
`https://github.com/billenewman4/procurement-pack/archive/refs/heads/main.zip`
into the workspace folder and extract it there. Skills are used by reading
`skills/<name>/SKILL.md` from the folder; tell the user that adding them as
uploaded claude.ai Skills later makes them auto-trigger.

## Step 2 — Initialize the store

[ASK] "What should we call your first project?" (one short name, e.g.
"robot-v1").

Always create a **brand-new, empty** store for the user. Never copy, seed
from, or reuse any `bom.json` you find in the pack repo — `evals/fixtures/`
contains fake test data for grading the skills, not user data. Path per
surface (A: `~/.procurement-pack/<slug>/bom.json`, B: `./bom.json` in the
workspace):

```json
{
  "project": { "id": "p1", "name": "<slug>", "created_at": "<today>" },
  "specs": [], "line_items": [], "order_events": [],
  "last_email_sync": "<now, ISO-8601 UTC>"
}
```

Then [ASK]: "Describe your project's key specs — voltages, connectors,
materials, constraints like country-of-origin. A couple of sentences is
plenty; this is what makes part search accurate." Store each as a
`specs` entry. If the user declines, continue — search will ask as it goes.

Verify: read the file back and confirm valid JSON.

## Step 3 — Gmail (optional but recommended)

Check whether Gmail MCP tools are available to you (tool names containing
`Gmail`). If yes, run the cheapest read (list labels) to confirm auth.

- Available + authed → tell the user order tracking from email is on.
- Not available → say: "Connect Gmail at claude.ai/customize/connectors to
  enable automatic order tracking — everything else works without it," and
  continue. Do NOT block setup on this.

## Step 4 — Verify end-to-end

Run one real search using skills/part-search/SKILL.md: "M3x10 socket head
cap screws, stainless, 25+". Confirm you produce the options table with real
links, then offer to add it to the BOM. If the user says yes, verify the
line item landed in the store file. This is the setup success signal —
show the user the report and where the store lives.

## Step 5 — Teach the user (30 seconds, verbatim-ish)

Tell them:
- "Ask me to find any part — I'll check it against your project specs and
  real datasheets before recommending."
- "Say 'catch me up on my orders' anytime — I'll sweep your email and update
  the BOM: what shipped, what's late, what's missing."
- "Everything lives in <store path> — it's yours, plain JSON, take it
  anywhere."

**A only:** offer to append a two-line routing note to the project's
CLAUDE.md so future sessions know these skills exist. Skip if declined.

## Known limitations to state honestly if asked

- Scheduled background email sync is proven on Claude Code cloud routines;
  on claude.ai scheduled tasks it's untested — the catch-up-on-open sweep
  covers the gap.
- The hosted/shared database (bomdb) is not shipped yet; the local JSON
  store is the current backend and migrates forward automatically later.
