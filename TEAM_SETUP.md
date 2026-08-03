# TEAM_SETUP.md — onboarding users (operator guide)

As of 2026-08-03 the default onboarding is the **hosted connector** — no
terminal, no Node, nothing installed on the user's machine. This file is
for the *operator* (Eshan/Bill) doing the 5-minute provisioning side, plus
a power-user appendix for a local machine install.

The historical agent-driven machine install (and the Cowork "baton"
prompts that patched its gaps — thanks, Bill, they found the account-save
path the concierge now uses) is retired; the appendix keeps the essentials.

## Onboard a new user (operator, ~5 minutes)

1. **Provision their database role** (prints direct + pooler connection
   strings — you want the POOLER one):

   ```bash
   DATABASE_URL=<master, from bomdb/.env> \
     node bomdb/scripts/provision-user.ts <role> "<Name>" <email>
   ```

2. **Mint their token:** `openssl rand -hex 24`

3. **Add them to the token map:** in `bomdb-remote/env.yaml` (gitignored,
   the local canonical copy), add `"<token>": "<their pooler string>"` to
   the `TOKEN_MAP` JSON. Then push to Secret Manager and redeploy:

   ```bash
   bomdb-remote/scripts/sync-secrets.sh
   gcloud run deploy bomdb-remote --source . --region us-central1 \
     --allow-unauthenticated --project carbonella \
     --clear-env-vars --set-secrets TOKEN_MAP=bomdb-token-map:latest \
     --quiet
   ```

   (Add `,SOURCING_AGENT_URL=bomdb-sourcing-url:latest` to `--set-secrets`
   once that secret exists.)

4. **Send them the card** (privately — the URL is their password):

   > **Get set up (60 seconds):**
   > 1. On claude.ai: Settings → Connectors → Add custom connector → paste:
   >    `https://bomdb-remote-869731474645.us-central1.run.app/mcp/<their-token>`
   > 2. New chat, say: **set up my BOM**
   >
   > Claude takes it from there. Works on web, the Desktop app, your phone,
   > and Cowork. If you're on a Team plan, an org Owner has to add the
   > connector for you.

The in-chat concierge handles everything the old setup doc used to:
project creation, the one-time spec interview, the three skill save-cards
(part-search, gmail-orders, bom-dashboard), the Gmail nudge, and the
morning-digest scheduled task. You don't walk them through anything.

**Rotate a leaked token:** replace it in TOKEN_MAP, redeploy, send the new
URL. **Revoke:** remove the entry, redeploy. **Reset a workspace** (fresh
onboarding tests): `DATABASE_URL=<master> node bomdb/scripts/reset-user.ts <role>`.

## Rules (unchanged)

- Their workspace is scoped to them by Postgres RLS; empty-for-new is
  correct, never an error.
- **No user token ever maps to the master connection** — master bypasses
  RLS and is for the admin scripts above only.
- No delete operation by design; statuses only move backward with explicit
  user confirmation.

## Known limitations (state honestly if asked)

- The connector URL is a bearer secret (interim until OAuth): anyone
  holding the full URL is that user. It lives in their connector settings
  and our request logs. Rotation is cheap (above).
- Deep-sourcing tools (`source_quote`/`get_quote`) appear only when the
  deployment has `SOURCING_AGENT_URL` configured.
- Artifacts are snapshots — fresh each time they ask, not live.

## Appendix — local power-user install (optional, for development)

The stdio server still works for offline/dev use on a machine with the
repo:

```bash
git clone https://github.com/billenewman4/procurement-pack.git ~/procurement-pack
cd ~/procurement-pack/bomdb && npm install   # Node 23.6+
claude mcp add --scope user bomdb \
  -e DATABASE_URL="<their POOLER connection string>" \
  -- node ~/procurement-pack/bomdb/src/server.ts
```

Notes hard-won from the field:
- Use the **pooler** form of the connection string
  (`<role>.<project-ref>@aws-0-us-west-1.pooler.supabase.com`) — the direct
  Supabase host is IPv6-only and unreachable from many networks (and from
  Cloud Run).
- For the Desktop app, add the same server to `~/Library/Application
  Support/Claude/claude_desktop_config.json` under `mcpServers` with an
  ABSOLUTE node path (`which node`), then fully quit (Cmd-Q) and reopen.
- Don't run the local server and the hosted connector on the same surface —
  identical toolsets confuse tool selection. Hosted wins; disable one.
- Skills for local Claude Code: `ln -sfn ~/procurement-pack/skills/<name>
  ~/.claude/skills/<name>` (account-saved skills from the concierge cover
  every other surface).
