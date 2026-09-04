# Agent Guidelines

## 0. Core Directives

- **Context Reference:** Read `README.md` and `CONTRIBUTING.md` first. Treat their rules with the same mandatory priority as this file.
- **Proactive Compliance Check:** Context presence does not guarantee compliance. At natural checkpoints (before running tests, git operations, or creating GitHub artifacts), actively verify the planned action against these guidelines.
- **Language:** Always respond in the language used by the user in the prompt.
- **Security & Secrets:** NEVER output, hardcode, or request `service_role` keys or production secrets. Use only local `anon`/publishable keys in code and `.env.example`.

## 1. Frontend Practices

- **Strict Typing:** Never use `any`. 
- **Server-First:** Default to React Server Components; restrict `"use client"` strictly to leaf components.
- **UI Reuse:** Use Tailwind CSS and reuse existing `shadcn/ui` components; never reinvent primitives.
- **API Alignment:** Strictly adhere to the project's Next.js version APIs; never use deprecated patterns.

## 2. Database Operations

- **Migrations Only:** Apply all schema changes via versioned SQL files and `pnpm db:reset`; never execute ad-hoc SQL. Resolve `pnpm lint:sql` issues directly without disabling rules.
- **Table Pipeline:** For every new or modified table:
  1. Write pgTAP tests before creating migrations.
  2. Define an RLS policy.
  3. Explicitly grant permissions (`select, insert, update, delete`) to `anon, authenticated`.
  4. Run `pnpm db:types`, strip any log prefixes, and commit the regenerated types.
  5. Update `docs/erd.md`.

## 3. Development Workflow

- **Agile Principle:** Incremental progress precedes perfection; flawless code on a misaligned premise is worthless. Maintain a fast, continuous loop returning to Step 1.

1. **Align:** Establish shared understanding before coding through iterative dialogue:
   - Clarify intent through discussion and questions.
   - Reflect understood design into documents to confirm alignment.
2. **Test-First:** Write outcome-verifying tests before writing implementation.
3. **Implement:** Write code strictly to satisfy the tests. Never weaken assertions.
4. **Targeted Verify:** Run only specific tests or typecheck;  never run full test suites.

## 4. Git & GitHub Operations

1. **Issue (Optional):** File an issue from the template before starting work. Always set milestones; split into an Epic with sub-issues only when spanning multiple PRs.
2. **Develop:** Loop Development Workflow with the user until implementation alignment is reached.
3. **Commit with Approval:** Present the diff, stage only issue-related files, and obtain user approval before executing `git commit` (`<type>: <why and what>`). Keep messages high-level without debug logs.
4. **Pre-PR Quality Gate:** After approval, run `pnpm validate:all` (if touching logic, migrations, or E2E) or `pnpm validate` otherwise. Never dismiss failures as flaky; verify root causes before proceeding.
5. **Create PR:** Follow `.github/pull_request_template.md` upon explicit user approval. Summarize intent concisely without trial logs, and claim "verified X" only if executed in the current session.
6. **Monitor CI:** Watch CI runs post-creation; promptly resolve root causes and push fixes if any checks fail.
7. **Cleanup:** Switch to `main`, pull latest, and delete the feature branch only after the PR merge is confirmed.
