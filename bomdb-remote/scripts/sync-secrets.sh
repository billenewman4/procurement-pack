#!/usr/bin/env bash
# Push local env.yaml values to GCP Secret Manager as new versions.
# env.yaml stays the canonical copy you edit; this ships it. After pushing,
# redeploy (secrets resolve at instance start; a redeploy makes it immediate).
set -euo pipefail
cd "$(dirname "$0")/.."

node -e "
const l = require('fs').readFileSync('env.yaml','utf8').split('\n').find(x => x.startsWith('TOKEN_MAP: '));
if (!l) { console.error('no TOKEN_MAP in env.yaml'); process.exit(1); }
process.stdout.write(JSON.parse(l.slice('TOKEN_MAP: '.length)));
" | gcloud secrets versions add bomdb-token-map --data-file=- --project carbonella

if grep -q '^SOURCING_AGENT_URL: ' env.yaml; then
  node -e "
const l = require('fs').readFileSync('env.yaml','utf8').split('\n').find(x => x.startsWith('SOURCING_AGENT_URL: '));
process.stdout.write(JSON.parse(l.slice('SOURCING_AGENT_URL: '.length)));
" | gcloud secrets versions add bomdb-sourcing-url --data-file=- --project carbonella 2>/dev/null \
    || node -e "
const l = require('fs').readFileSync('env.yaml','utf8').split('\n').find(x => x.startsWith('SOURCING_AGENT_URL: '));
process.stdout.write(JSON.parse(l.slice('SOURCING_AGENT_URL: '.length)));
" | gcloud secrets create bomdb-sourcing-url --data-file=- --replication-policy=automatic --project carbonella
fi

if grep -q '^MASTER_DATABASE_URL: ' env.yaml; then
  node -e "
const l = require('fs').readFileSync('env.yaml','utf8').split('\n').find(x => x.startsWith('MASTER_DATABASE_URL: '));
process.stdout.write(JSON.parse(l.slice('MASTER_DATABASE_URL: '.length)));
" | gcloud secrets versions add bomdb-master-url --data-file=- --project carbonella 2>/dev/null \
    || node -e "
const l = require('fs').readFileSync('env.yaml','utf8').split('\n').find(x => x.startsWith('MASTER_DATABASE_URL: '));
process.stdout.write(JSON.parse(l.slice('MASTER_DATABASE_URL: '.length)));
" | gcloud secrets create bomdb-master-url --data-file=- --replication-policy=automatic --project carbonella
fi

echo "secrets pushed — redeploy to apply immediately"
