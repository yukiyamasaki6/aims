# Agent Guidelines

## 1. Project Context
- Read [README.md](README.md) for the product overview and [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow (structure, setup, branching, PR process).
- Check `package.json` (root and `apps/web/`) for available scripts and the package manager (`pnpm`) — don't assume a command exists without checking.

## 2. Mandatory Rules & Quality Gates
- **Validation before completion:**
  - `pnpm validate` (lint + typecheck + SQL lint + unit tests) must pass with zero errors before you consider a change done.
  - When the change touches application code or E2E tests, also run `pnpm validate:all` (adds E2E tests; requires local Supabase running via `pnpm db:start`).
  - Run `pnpm check:write` to fix formatting/lint issues automatically rather than hand-formatting.
- **Strict typing:** avoid `any`; `pnpm typecheck` must compile clean.
- **Database & secrets safety:**
  - NEVER output, hardcode, or request `service_role` keys or production credentials. Only the local `anon`/publishable key belongs in code or `.env.example`.
  - All schema changes are versioned SQL files under `supabase/migrations/`, applied locally via `pnpm db:reset`. Never make ad-hoc schema changes, and never run migrations against a production database directly.
  - After adding or changing a table: run `pnpm db:types` and commit the regenerated `apps/web/src/types/supabase.ts`, and update [docs/erd.md](docs/erd.md).
  - A new table needs **both** an RLS policy **and** an explicit `grant select, insert, update, delete on <table> to anon, authenticated;` (or relevant roles). This project's local config does not auto-expose new tables (`auto_expose_new_tables` is unset in `supabase/config.toml`), so a policy alone leaves PostgREST returning "permission denied."
  - New/changed migrations are linted via `pnpm lint:sql` (Squawk, included in `pnpm validate`). Fix reported issues directly (e.g. add `if not exists`, wrap in `begin`/`commit` with `lock_timeout`/`statement_timeout`) rather than excluding rules.
- **Frontend practices:**
  - Use Tailwind CSS and reuse `shadcn/ui` components from `apps/web/src/components/ui/` instead of one-off components.
  - Default to React Server Components; add `"use client"` only when state, browser APIs, or lifecycle hooks require it.

## 3. Framework & Tooling Notes
- `apps/web` runs a version of Next.js that may differ from your training data — check the bundled docs at `apps/web/node_modules/next/dist/docs/` before writing App Router code, and heed deprecation notices.
- If a `pnpm <script>` fails with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, the environment's Node.js is older than `.node-version` requires. Fall back to the underlying CLI directly (`npx supabase ...`, `npx next ...`, `npx biome ...`) instead of the pnpm wrapper.
- `supabase gen types ... > file` can prepend a stray `Connecting to db ...` log line to the output file — check the first line of generated types before committing.

## 4. Test-Driven Implementation Workflow
- **Confirm intent before coding:** Restate what the user actually wants in your own words (or ask via AskUserQuestion if ambiguous) before writing any code or tests — don't infer intent solely from an issue title.
- **Write the test first:** Once intent is confirmed, write the test(s) that encode the expected behavior before implementing it. The test should assert the outcome the user wants, not the mechanics of whatever implementation you're about to write.
- **Implement to satisfy the test, then iterate:** Run the test, adjust the implementation, re-run — repeat until it passes.
- **When a test won't pass, don't force it green:** Stop and reconsider whether the test misencodes the intent or the implementation approach is wrong. Fix whichever side is actually incorrect — never loosen an assertion just to make it pass.
- **Keep dialoguing until both are right:** Continue revising the test and the implementation together (not just the implementation) until they both correctly reflect the confirmed intent, not merely until the first green run.

## 5. Issue → PR Workflow
- **Issue Hierarchy:** Always decompose a milestone into Epics by feature unit (each Epic is one coherent feature area, e.g. "実装する画面" or "実装するデータ基盤"). Always decompose an Epic into sub-issues by PR unit — each sub-issue must correspond to exactly one PR. Don't split work that would naturally land in a single PR into multiple sub-issues (e.g. a schema change and an unrelated-but-necessarily-bundled cleanup in the same migration belong in one sub-issue), and don't bundle work that requires genuinely separate PRs (e.g. local tooling introduction vs. its CI integration) into one sub-issue.
- **Environment & PATH:** If `gh` is not found, verify its location with `where.exe gh` or prepend `$env:Path += ";C:\Program Files\GitHub CLI"` in PowerShell sessions.
- **Clean Staging:** Before branching or committing, inspect `git status` thoroughly. Stage and commit **only** files relevant to the specific issue; never bundle unrelated pending changes.
- **Check Existing Files:** Check `git status` or `git log -- <path>` before creating files, to avoid recreating or overwriting already merged work.
- **Explicit Approval:** Never run `git commit` on your own initiative — prepare the change, show the diff, and commit only once the user explicitly asks for it in that turn. The same applies to `gh pr create`: even after committing, open the PR only when asked.
- **Honest Verification:** Only state "verified/confirmed X" in a PR description if X was explicitly executed in the current session. Run all verification checks before submitting the PR.
- **Post-Merge Cleanup:** Once a PR is confirmed merged (`gh pr view <n> --json state,mergedAt`), switch back to main and clean up: `git checkout main`, `git pull`, `git branch -d <branch>`.