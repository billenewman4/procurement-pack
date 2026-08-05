# INSTALL_FOR_AGENTS.md — procurement pack via Claude Code

You are an AI agent setting up the procurement pack for your user inside
Claude Code. Read this entire file before acting, then follow the steps in
order. Target: under 2 minutes. There is nothing to clone or install — the
server is hosted; you only register it and let it drive.

**If you are a human reading this:** you probably want the README's
connector card instead — 60 seconds, no terminal, and it covers claude.ai,
Desktop, mobile, and Cowork. This file is only the Claude Code path.

## Step 1: Get the user's personal connector URL

Each user has a personal URL of the form:

```
https://bomdb-remote-869731474645.us-central1.run.app/mcp/<TOKEN>
```

If the user's message already included their full URL, use it. Otherwise
ask them for it. If they don't have one, whoever operates their team's BOM
database must provision it (see `TEAM_SETUP.md`); you cannot mint one —
stop and tell them so plainly.

**The URL is a bearer secret — anyone holding it is this user.** Never
commit it, never write it into any file (scripts, notes, docs, memory),
never echo it anywhere beyond the one command below.

## Step 2: Register the server

```bash
claude mcp add --transport http bomdb https://bomdb-remote-869731474645.us-central1.run.app/mcp/<TOKEN>
```

Substitute the user's real URL. Default scope is this project only; add
`--scope user` if they want it in every project.

## Step 3: Verify the connection

Call the `ping` tool on the `bomdb` server and confirm it returns `pong`.

- Tools not visible → check `/mcp` shows `bomdb` connected; restart the
  session if it was just added.
- Connection or auth error → the URL is wrong or the token was revoked.
  Re-confirm the URL with the user; a dead token means their operator must
  rotate it — you can't fix that from here.

## Step 4: Onboard

Call the `get_started` tool and follow what it returns. It is state-aware
(new user vs. returning) and is the single source of truth for onboarding.
Do not improvise setup steps or replicate old ones from memory — this file
deliberately doesn't contain them.

## Step 5: Verification checklist

Confirm all of these before declaring success:

- [ ] `/mcp` shows `bomdb` connected
- [ ] `ping` returned `pong`
- [ ] `get_started` returned instructions and you followed them through
- [ ] The token exists nowhere except the MCP registration — no files, no
      commits, no pasted output

One thing to tell the user: servers added via Claude Code's CLI do **not**
appear on claude.ai or Cowork. If they also chat there, they should add
the same URL as a connector per the README card.
