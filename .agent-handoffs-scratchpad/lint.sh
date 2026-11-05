#!/bin/bash
cd /root/worktrees/aims-batch1-simplify
pnpm exec biome check apps scripts supabase docs agents biome.json package.json .github 2>&1 | tail -15 && pnpm --filter web lint:text 2>&1 | tail -5 && pnpm --filter web lint:messages 2>&1 | tail -5
