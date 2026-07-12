# Contributing

Thank you for your interest in contributing to this project! We welcome contributions from everyone, whether it's reporting bugs, suggesting features, or submitting pull requests.

## About this repository

Coming soon...

## Contributing guidelines

### Creating issues

We utilize a structured hierarchy to manage development tasks efficiently.
You can use both **English** and **Japanese** for issue titles and descriptions.

- **Epic (Parent Issue)**
  - Use the `📦 Create Epic` template.
  - Write the `🎯 Objective` and `📋 Acceptance Criteria`.
- **Sub-issue (Child Issue)**
  - No template required. Create directly from the parent issue page using the "Create sub-issue" button.

### Branching model

#### 🛠️ Regular Development (Feature / Bugfix)

1. Branch out from `main`.
2. **Format:** `<type>/<description>` (e.g., `feat/score-buttons`, `fix/input-validation`).
3. Open a Pull Request toward `main`.
4. Merge using **Squash and merge** (local commit messages are completely flexible).

#### 🚨 Emergency Bug Fixes (Hotfix)

1. Branch out directly from the latest production deployment branch: **`release/vX.X.X`**.
2. **Format:** `fix/<description>` (e.g., `fix/critical-crash`).
3. Open a Pull Request toward `release/vX.X.X` for an immediate patch release (e.g., `v0.1.1`).
4. Merge or cherry-pick the exact same changes into `main` to synchronize development tracking.

### PR format

The PR title must strictly follow the Conventional Commits specification. A GitHub Action automatically validates the title before merging.
You can use both **English** and **Japanese** for the PR title and description.

- **Format:** `<type>(<scope>): <description>`
- **Example:** `feat(score-ui): Implement score input components`

#### Allowed Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `chore`: Updating build tasks, package manager configs, etc.

#### PR Body

Please fill out the description and verification steps using the default Pull Request template provided by the repository.

> **💡 Note on CI Failures**
> If the title check fails, do not amend or re-push from your local machine. Simply click the "Edit" button at the top right of the PR page on GitHub and correct the title directly.
