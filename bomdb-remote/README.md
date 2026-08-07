# bomdb-remote — the hosted BOM connector

The same bomdb operations as `../bomdb`, served over streamable HTTP from
Cloud Run so any claude.ai surface (web, Cowork, Desktop, mobile, scheduled
tasks) can reach the BOM database as a **custom connector**. Reuses
`../bomdb/src/{engine,operations,tool-defs}.ts` verbatim — one behavior,
two transports.

**Auth (interim until OAuth ships):** the connector URL's last path segment
is a per-user secret token — `https://<service>/mcp/<token>`. Treat the full
URL as a password. Each token maps to that user's RLS-scoped Postgres
credentials, so isolation is enforced by the database, not the router.

- Service: `bomdb-remote`, GCP project `carbonella`, region `us-central1`
- URL: `https://bomdb-remote-869731474645.us-central1.run.app`
- Config: `env.yaml` (gitignored, local canonical copy) — `TOKEN_MAP` JSON
  of `{token: database_url}` and optionally `SOURCING_AGENT_URL` and
  `MASTER_DATABASE_URL`. Shipped to GCP **Secret Manager**
  (`bomdb-token-map`, `bomdb-sourcing-url`) by `scripts/sync-secrets.sh`;
  Cloud Run mounts them as env vars via `--set-secrets`.
- All `database_url`s MUST be the Supabase **pooler** form
  (`<role>.<project-ref>@aws-0-us-west-1.pooler.supabase.com`) — Cloud Run
  egress is IPv4-only and the direct host is IPv6-only.

## Deploy (from repo root; Eshan runs this)

```bash
bomdb-remote/scripts/sync-secrets.sh   # if env.yaml changed
gcloud run deploy bomdb-remote --source . --region us-central1 \
  --allow-unauthenticated --project carbonella \
  --clear-env-vars --set-secrets TOKEN_MAP=bomdb-token-map:latest \
  --quiet
```

Add `,SOURCING_AGENT_URL=bomdb-sourcing-url:latest` to `--set-secrets`
once sourcing is activated. `--allow-unauthenticated` is correct: auth is
the secret URL path. Secret rotation = edit env.yaml → sync-secrets.sh →
redeploy.

**SOURCING_AGENT_URL** is the full upstream sourcing-agent MCP endpoint,
including its partner token (`https://host/mcp/<token>`) — this server
holds the only copy; users never see it. Once set, it enables five relayed
tools: `connect_vendor` and `get_job` (vendor recon), `list_sourcing_vendors`
(the sourcing service's own connector catalog — distinct from bomdb's own
`list_vendors`, the user's vendor CRM), and `source_quote`/`get_quote`
(catalog quoting). Leave it unset and a deployment degrades to plain bomdb
instead of shipping tools that always fail — the deploy MUST set it for
sourcing to appear at all.

## Password sign-in (`/auth/register`, `/auth/login`)

ProcurePro's email+password login proxies to these two endpoints
(`src/auth.ts`). Registration is whitelist-gated: only an email an admin
has already attached to a `users` row may create an account
(`node --env-file=.env bomdb/scripts/set-user-email.ts <role> <email>`).
Passwords are scrypt-hashed into the master-only `app_accounts` table;
success answers `{token, name}` where `token` is the user's **existing**
connector token, reverse-mapped from `TOKEN_MAP` by pg_role.

Requires `MASTER_DATABASE_URL` (the bomdb/.env master connection, pooler
form) in the deploy env — store it as a Secret Manager secret (e.g.
`bomdb-master-url`) and add `MASTER_DATABASE_URL=bomdb-master-url:latest`
to `--set-secrets`. Without it the endpoints answer 503 and everything
else works as before. It must NEVER appear as a `TOKEN_MAP` value (the
server refuses to boot if it does) — master bypasses RLS and is used by
the auth routes only.

## Onboard a teammate

1. Provision their scoped DB role (prints direct + pooler strings):
   `DATABASE_URL=<master> node bomdb/scripts/provision-user.ts bill "Bill" bill@example.com`
2. Mint their token: `openssl rand -hex 24`
3. Add to `TOKEN_MAP` in `env.yaml` (token → their **pooler** string), redeploy.
4. Send them privately: `https://<service>/mcp/<their-token>` and the
   instruction "claude.ai → Settings → Connectors → Add custom connector →
   paste this URL". That's their entire setup.

Rotate a leaked token: replace it in `TOKEN_MAP`, redeploy, send the new URL.
Revoke a user: remove their entry, redeploy.

## Develop & test

```bash
npm test        # transport + isolation tests on in-memory PGLite
```

Local run needs env: `TOKEN=dev DATABASE_URL=<pooler string> npm start`,
then point curl (or a connector) at `http://localhost:8080/mcp/dev`.
