# Contributing

Thank you for your interest in contributing to this project! We welcome contributions from everyone, whether it's reporting bugs, suggesting features, or submitting pull requests.

## About this repository

AIMS is a [pnpm workspace](https://pnpm.io/workspaces) monorepo. See the [README](README.md) for the product overview and tech stack.

### Repository Structure

```
aims/
├── apps/
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/          # App Router pages
│           ├── components/   # Reusable UI components (shadcn/ui-based)
│           ├── lib/          # Client-side utilities, incl. the Supabase client
│           └── types/        # Type definitions, incl. the generated Supabase schema types
├── packages/             # Shared packages consumed by apps/* (currently empty)
├── supabase/             # Local Supabase config, database migrations, and snippets
├── docs/                 # Project documentation (ERD, security notes, etc.)
└── .github/               # Issue templates and CI/CD workflows
```

## Development workflow

### Prerequisites

- [Node.js](https://nodejs.org/) (Version specified in [.node-version](.node-version))
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) (Required for running local Supabase)

### Setup

1. Clone the repository:
    ```bash
    git clone https://github.com/yukiyamasaki6/aims.git
    ```
2. Navigate to the project directory:
    ```bash
    cd aims
    ```
3. Install dependencies:
    ```bash
    pnpm install
    ```
4. Copy the environment variables template:
    ```bash
    cp apps/web/.env.example apps/web/.env.local
    ```

### Using an AI Coding Agent (Optional)

To let AI agents read issues and create PRs via CLI, install and authenticate the [GitHub CLI (`gh`)](https://cli.github.com/):

```bash
gh auth login
```

### Managing Local Supabase

1. Ensure the Docker engine is running.
2. Start the local Supabase environment:
    ```bash
    pnpm db:start
    ```
    This provides local Postgres, Auth, and Supabase Studio at `http://127.0.0.1:54323`
3. When database schemas or migrations are updated, regenerate TypeScript types:
    ```bash
    pnpm db:types
    ```
4. Stop the local Supabase instance when you are done:
    ```bash
    pnpm db:stop
    ```

### Development & Testing

1. Create a new branch:
    ```bash
    git checkout -b feat/my-feature-branch
    ```
2. Make your changes in the codebase.
3. Verify the changes on the local development server:
    ```bash
    pnpm dev
    ```
4. Run lint and type checks to ensure code quality:
    ```bash
    pnpm validate
    ```
    If lint/formatting errors occur, fix them automatically with `pnpm check:write`
5. Push your branch to GitHub:
    ```bash
    git push origin feat/my-feature-branch
    ```

### Submitting Pull Requests

1. Open a Pull Request toward `main`.
2. Ensure that your PR title follows the Conventional Commits specification.
    Format: `<type>(<scope>): <description>`

    Example: `feat(score-ui): Implement score input components`

    Types:
     - `feat`: New features
     - `fix`: Bug fixes
     - `refactor`: Code changes without adding features or fixing bugs
     - `docs`: Documentation changes
     - `test`: Adding or updating tests
     - `ci`: CI configuration or script changes
     - `chore`: Build task, dependency, or config updates
3. Fill out the PR description using the [provided template](.github/pull_request_template.md).
4. Merge using **Squash and merge** (local commit messages are completely flexible).

## Creating issues

We utilize a structured hierarchy to manage development tasks efficiently.
You can use both **English** and **Japanese** for issue titles and descriptions.

### Epic (Parent Issue)
Fill out the Epic issue description using the [📦 Create Epic template](.github/ISSUE_TEMPLATE/epic.md).

### Sub-issue (Child Issue)
No template required. Create directly from the parent issue page using the "Create sub-issue" button.
