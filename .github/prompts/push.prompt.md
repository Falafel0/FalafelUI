---
name: push
description: Commit and push changes to main — no version bump, no release, no tag
argument-hint: "Brief commit message describing the changes"
agent: agent
---


# Push to Main (FalafelUI Fork)

Non-release path: **pre-flight → pre-commit-check → commit → push**.
Run autonomously; do not pause for confirmation unless blocked.

**Does not:** bump version, edit `docs/RELEASE_NOTES.md` / `CHANGELOG.md`, create tags, or run full release build CI.

## Inputs

- **Commit message:** user-provided, or derive from `git diff` (imperative, ≤72 chars, e.g. `feat: add custom model preset`)
- **Mode:**
  - **Direct push (default)**: commit and push directly to `main` (standard for solo development).
  - **PR mode (`--pr`)**: create `chore/<slug>` or `feat/<slug>` branch, open PR, and merge.

## Windows git (required)

Pre-commit hook is bash and **hangs in PowerShell**. Prefix **every** git command:

```text
git -c core.hooksPath=/dev/null ...
```

## Workflow

### 1. Pre-flight

```powershell
cd "$(git rev-parse --show-toplevel)"
git diff --stat
git diff --cached --stat
```

Clean tree → tell user and stop.

If `package.json`, `src-tauri/Cargo.toml`, or `src-tauri/tauri.conf.json` show version-only bumps → warn user to use **release** skill instead.

### 2. Pre-commit-check

Follow the **pre-commit-check** skill:
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check` (or `npm run check:i18n` and `npm run build`)
Fix blocking issues; re-run until ✅ Ready to commit.

### 3. Commit and Push

#### Option A: Direct Push to `main` (Default Solo Workflow)

If on `main` and branch protection is not blocking:

```powershell
git add -A
git -c core.hooksPath=/dev/null commit -m "<message>"
git -c core.hooksPath=/dev/null push origin main
```

#### Option B: Branch & PR Workflow (when `--pr` is specified or branch is protected)

```powershell
git checkout -b chore/<slug>
git add -A
git -c core.hooksPath=/dev/null commit -m "<message>"
git -c core.hooksPath=/dev/null push -u origin chore/<slug>
gh pr create --base main --head chore/<slug> --title "<message>" --body "$(git diff --stat origin/main...HEAD)"
gh pr merge --squash --delete-branch
git checkout main
git fetch origin main
git reset --hard origin/main
```

### 4. Docs Pass (if user-facing behavior changed)

Most pushes (refactors, internal fixes, build scripts) need nothing here — skip.
If this push adds or renames a user-facing feature:
Update in-repository docs under `docs/` or wiki documentation.
Verify exact UI labels against current code (`src/lib/locales/en.ts` and components).

## Checklist

```
- [ ] Pre-commit-check passed (cargo check + npm build)
- [ ] Changes committed with descriptive message (no Co-Authored-By)
- [ ] Pushed to origin main (directly or via PR merge)
- [ ] In-tree docs updated if user-facing behavior changed
```

## Mistakes to avoid

1. Omitting `core.hooksPath=/dev/null` on Windows
2. Including release version bumps — use **release** skill
3. Adding `Co-Authored-By` trailers to commits, PR bodies, or comments — never attribute AI assistance in any git or GitHub output
4. Overwriting fork-specific configs (endpoints, signing keys)
