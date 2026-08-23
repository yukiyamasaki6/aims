# Agent Guidelines

## 1. Project Context
- Read [README.md](README.md) for the product overview and [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow (structure, setup, branching, PR process).
- Check `package.json` (root and `apps/web/`) for available scripts and the package manager (`pnpm`) — don't assume a command exists without checking.

## 2. Mandatory Rules & Quality Gates
- **Validation before completion:**
  - `pnpm validate` (lint + typecheck) must pass with zero errors before you consider a change done.
  - Run `pnpm check:write` to fix formatting/lint issues automatically rather than hand-formatting.
- **Strict typing:** avoid `any`; `pnpm typecheck` must compile clean.
- **Database & secrets safety:**
  - NEVER output, hardcode, or request `service_role` keys or production credentials. Only the local `anon`/publishable key belongs in code or `.env.example`.
  - All schema changes are versioned SQL files under `supabase/migrations/`, applied locally via `pnpm db:reset`. Never make ad-hoc schema changes, and never run migrations against a production database directly.
  - After adding or changing a table: run `pnpm db:types` and commit the regenerated `apps/web/src/types/supabase.ts`, and update [docs/erd.md](docs/erd.md).
  - A new table needs **both** an RLS policy **and** an explicit `grant select, insert, update, delete on <table> to anon, authenticated;` (or relevant roles). This project's local config does not auto-expose new tables (`auto_expose_new_tables` is unset in `supabase/config.toml`), so a policy alone leaves PostgREST returning "permission denied."
- **Frontend practices:**
  - Use Tailwind CSS and reuse `shadcn/ui` components from `apps/web/src/components/ui/` instead of one-off components.
  - Default to React Server Components; add `"use client"` only when state, browser APIs, or lifecycle hooks require it.

## 3. Framework & Tooling Notes
- `apps/web` runs a version of Next.js that may differ from your training data — check the bundled docs at `apps/web/node_modules/next/dist/docs/` before writing App Router code, and heed deprecation notices.
- If a `pnpm <script>` fails with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, the environment's Node.js is older than `.node-version` requires. Fall back to the underlying CLI directly (`npx supabase ...`, `npx next ...`, `npx biome ...`) instead of the pnpm wrapper.
- `supabase gen types ... > file` can prepend a stray `Connecting to db ...` log line to the output file — check the first line of generated types before committing.

## 4. Issue → PR Workflow
- Check `gh` is on `PATH` before using it (`where.exe gh`); if a new shell can't find it, prefix the command with `$env:Path += ";C:\Program Files\GitHub CLI"` (or the actual install path) rather than assuming it needs reinstalling.
- Before branching/committing for an issue, run `git status` and read every entry — a session can inherit unrelated uncommitted work (from an earlier turn, or from the user editing files directly). Stage and commit **only** the files that actually belong to the issue at hand; leave unrelated pending changes untouched rather than bundling them in "for convenience."
- A file you're about to create may already be tracked with matching content (e.g. from work merged earlier in the same session). Check `git status`/`git log -- <path>` before assuming it's new — don't recreate or re-describe work that's already committed.
- Only write "verified/confirmed X" in a PR description if X was actually run in that turn. If you claim a check passed, go run it before (or immediately after) opening the PR, and correct the PR body if it turns out to be wrong.
- **Never run `gh pr create` unless the user explicitly asks for a PR in that turn.** Committing and pushing a branch is fine; opening the PR is a separate, explicit step each time — the user may want to review or discuss the diff first.
- Once the user says a PR is approved, confirm it's actually merged (`gh pr view <n> --json state,mergedAt`) before touching branches, then: `git checkout main`, `git pull`, `git branch -d <branch>`. Do this every time a PR lands — don't leave merged local branches lying around.