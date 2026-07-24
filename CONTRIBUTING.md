# Contributing

Thank you for your interest in contributing to this project! We welcome contributions from everyone, whether it's reporting bugs, suggesting features, or submitting pull requests.

## About this repository

Coming soon...

## Development workflow

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

### Development & Testing

1. Create a new branch:
    ```bash
    git checkout -b my-feature-branch
    ```
2. Make your changes in the codebase.
3. Verify the changes on the local development server:
    ```bash
    pnpm dev
    ```
4. Run code checks and formatting:
    ```bash
    pnpm check:write
    ```
5. Push your branch to GitHub:
    ```bash
    git push origin my-feature-branch
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
3. Fill out the PR description using the provided template.
4. Merge using **Squash and merge** (local commit messages are completely flexible).

## Creating issues

We utilize a structured hierarchy to manage development tasks efficiently.
You can use both **English** and **Japanese** for issue titles and descriptions.

### Epic (Parent Issue)
1. Use the `📦 Create Epic` template.
2. Write the `🎯 Objective` and `📋 Acceptance Criteria`.

### Sub-issue (Child Issue)
No template required. Create directly from the parent issue page using the "Create sub-issue" button.
