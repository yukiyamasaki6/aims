# Agent Guidelines

## 0. Communication
- **Match the user's language:** Respond in the language the user is using. Format responses with Markdown for clarity.

## 1. Project Context
- Read [README.md](README.md) for the product overview and [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow (structure, setup, branching, PR process).
- Inspect `package.json` (root and `apps/web/`) for available scripts and package manager (`pnpm`) before running any command.

## 2. Mandatory Rules & Quality Gates
- **Validation before completion:**
  - Pass `pnpm validate` (lint, typecheck, SQL lint, unit tests) with zero errors before considering any task done.
  - Run `pnpm validate:all` (adds pgTAP DB tests and Playwright E2E; requires `pnpm db:start`) when changes touch application code, migrations, or E2E tests.
  - Run `pnpm check:write` to resolve formatting and lint issues automatically.
  - Keep the feedback loop with the user fast: run a given test/suite once, not repeatedly for reassurance, and skip validation steps that the change cannot affect (e.g., skip E2E for a docs-only change or a pure file move with zero content diff).
- **Strict typing:** Never use `any`; ensure `pnpm typecheck` compiles cleanly.
- **Database & secrets safety:**
  - NEVER output, hardcode, or request `service_role` keys or production secrets. Use only local `anon`/publishable keys in code and `.env.example`.
  - Place all schema changes in versioned SQL files under `supabase/migrations/` and apply locally via `pnpm db:reset`. Never execute ad-hoc schema changes or run migrations against production directly.
  - Run `pnpm db:types`, commit the regenerated `apps/web/src/types/supabase.ts`, and update [docs/erd.md](docs/erd.md) immediately after modifying tables.
  - Apply **both** an RLS policy **and** an explicit `grant select, insert, update, delete on <table> to anon, authenticated;` to every new table (`auto_expose_new_tables` is unset in `supabase/config.toml`).
  - Fix issues reported by `pnpm lint:sql` (Squawk) directly (e.g., add `if not exists`, wrap in `begin`/`commit` with timeouts); do not exclude lint rules.
  - Verify tables, RLS policies, and triggers via pgTAP (`supabase/tests/`, executed via `pnpm test:db`). Write pgTAP tests before writing the corresponding migrations.
  - When auditing pgTAP coverage, check it against multiple axes rather than one pass: table constraints (UNIQUE/CHECK/NOT NULL/FK), cross-table effects (cascades, triggers, multi-table RPCs), and RLS policies per command (SELECT/INSERT/UPDATE/DELETE, including the `anon` role) — each axis tends to surface gaps the others miss.
- **Frontend practices:**
  - Use Tailwind CSS and reuse existing `shadcn/ui` components from `apps/web/src/components/ui/`.
  - Default to React Server Components; use `"use client"` only when state, browser APIs, or lifecycle hooks are strictly required.

## 3. Framework & Tooling Notes
- Check bundled Next.js docs at `apps/web/node_modules/next/dist/docs/` before writing App Router code, and heed deprecation notices.
- Fall back to underlying CLIs (`npx supabase ...`, `npx next ...`, `npx biome ...`) if a pnpm wrapper fails with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`.
- Inspect the first line of generated types after running `pnpm db:types`; remove any prepended `Connecting to db ...` log lines before committing.

## 4. Test-Driven Implementation Workflow
- **Confirm intent before coding:** Restate the user's objective in your own words (or ask clarifying questions if ambiguous) before writing any code or tests.
- **Ground shared understanding in docs:** Before implementing, read and, when needed, edit relevant docs (`docs/*.md`, `README.md`, this file) with the user to establish shared understanding of the design before writing code.
- **Write tests first:** Write tests asserting the intended user outcome before starting implementation.
- **Implement to satisfy tests:** Run tests, adjust implementation, and repeat until all tests pass.
- **Do not force green:** If a test fails, determine whether the test misencodes intent or the code is wrong. Fix the root cause; never weaken assertions to pass tests.
- **Iterate in dialogue:** Revise tests and implementation together until both strictly align with the confirmed intent.

## 5. Issue → PR Workflow
- **Issue Filing:** File every issue from the template. Split into an Epic with sub-issues only when the work spans multiple PRs. Always set the milestone.
- **Environment & PATH:** Verify `gh` is on PATH (`where.exe gh`); if not, prepend `$env:Path += ";C:\Program Files\GitHub CLI"`.
- **Clean Staging:** Run `git status` before branching or committing. Stage only files related to the current issue.
- **Check Existing Files:** Run `git status` and `git log -- <path>` before creating a file, to avoid overwriting merged work.
- **Explicit Approval:** Never run `git commit` or `gh pr create` unasked. Show the diff and wait for an explicit command.
- **Honest Verification:** Write "verified/confirmed X" only if X was actually executed this session.
- **Summary, Not Log:** A PR/Issue body is a summary of intent, not a sequential diff log. State only what changed and why; omit debugging narratives, trial logs, and diff walkthroughs. Follow `.github/pull_request_template.md` exactly.
- **Pre-Submit Review:** Before submitting, diff the drafted body against `git diff` and the template headings. Fix every gap: diff content missing from the body, and body claims the diff doesn't support.
- **Docs-Implementation Consistency:** Before submitting, verify docs (README, CONTRIBUTING, `docs/*.md`, this file) match the implementation. Update docs to follow the code, never the reverse.
- **Post-Merge Cleanup:** After confirming the merge (`gh pr view <n> --json state,mergedAt`), run `git checkout main && git pull && git branch -d <branch>`.