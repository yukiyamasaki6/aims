#!/bin/bash
cd /root/worktrees/aims-batch1-simplify
(dockerd >/tmp/dockerd.log 2>&1 &); sleep 8
cp .env.example .env 2>/dev/null
pnpm exec supabase start 2>&1 | tail -1 | cut -c1-30
docker cp /root/.ccr/ca-bundle.crt supabase_auth_aims:/tmp/ccr.crt && docker exec -u root supabase_auth_aims sh -c 'cat /tmp/ccr.crt >> /etc/ssl/certs/ca-certificates.crt'; docker restart supabase_auth_aims >/dev/null; sleep 5
node scripts/setup-local-env.mjs 2>&1 | tail -1 | cut -c1-30
