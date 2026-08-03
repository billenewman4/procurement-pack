# INSTALL_FOR_AGENTS.md

You are a Claude agent asked to set up the procurement pack for your user.
As of 2026-08-03 setup is a hosted connector — there is nothing for you to
install on this machine, and most of what this file used to do now happens
automatically in the user's first chat.

Do exactly this:

1. Ask whether they already have their **personal connector link** (a URL
   like `https://…run.app/mcp/<token>`, sent privately by whoever operates
   their team's BOM database). If they don't have one, that operator must
   provision it first — see `TEAM_SETUP.md`; you cannot mint one.

2. Tell them, in plain words: "Open claude.ai → Settings → Connectors →
   Add custom connector → paste your link → Add. Treat the link like a
   password. If your workspace is on a Team plan, an org Owner has to add
   it." You cannot click this for them — connector setup is theirs.

3. Then: "Start a new chat and say **set up my BOM**." The connector's
   built-in concierge takes over from there: project creation, the spec
   interview, skill save-cards, Gmail, the morning digest. Do not attempt
   to replicate those steps yourself; the concierge's version is
   state-aware and current.

That's the entire install. Only two situations call for anything more:

- **Developer/offline machine install** of the local stdio server: follow
  the appendix in `TEAM_SETUP.md`.
- **They can't reach the operator:** stop and tell them plainly there is
  no self-serve signup yet.
