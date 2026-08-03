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
- Config: `env.yaml` (gitignored) — `TOKEN_MAP` JSON of `{token: database_url}`,
  or single-user `TOKEN` + `DATABASE_URL`
- All `database_url`s MUST be the Supabase **pooler** form
  (`<role>.<project-ref>@aws-0-us-west-1.pooler.supabase.com`) — Cloud Run
  egress is IPv4-only and the direct host is IPv6-only.

## Deploy (from repo root; Eshan runs this)

```bash
gcloud run deploy bomdb-remote --source . --region us-central1 \
  --allow-unauthenticated --project carbonella \
  --env-vars-file bomdb-remote/env.yaml --quiet
```

`--allow-unauthenticated` is correct: auth is the secret URL path.

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
