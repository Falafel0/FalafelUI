---
name: sync-upstream
description: >-
  Fetches and merges the latest changes from upstream Mooshieblob1/MooshieUI into
  the Falafel0/FalafelUI fork while preserving fork-specific endpoints, signing keys,
  and configurations. Use when the user says /sync-upstream, sync upstream, or pull upstream updates.
---

# Sync Upstream (FalafelUI Fork)

Workflow to cleanly synchronize this fork (`Falafel0/FalafelUI`) with upstream (`Mooshieblob1/MooshieUI:main`).

## Protected Fork Configurations (MUST PRESERVE)

When merging upstream changes or resolving conflicts, **never** overwrite these fork-specific files with upstream versions:

1. **`src-tauri/tauri.conf.json`**:
   - `plugins.updater.endpoints`: must point to `https://github.com/Falafel0/FalafelUI/releases/latest/download/latest.json`
   - `plugins.updater.pubkey`: must keep the fork's public key
2. **`src/lib/errors/reportError.ts`**:
   - `GITHUB_REPO`: must remain `"Falafel0/FalafelUI"`
3. **`src-tauri/src/webserver.rs`**:
   - `check_update_handler`: must query `https://api.github.com/repos/Falafel0/FalafelUI/releases/latest`
4. **`README.md`**:
   - Keep fork repository badges, clone URL, and release links
5. **Key & build utilities**:
   - `generate-keys.bat`, `scripts/apply-updater-pubkey.mjs`, and `.gitignore` key exclusions (`*.key`, `*.key.pub`)

## Workflow

### 1. Verify Clean Tree and Remotes

```powershell
git status --short
```

Ensure no uncommitted changes exist. If dirty, commit or stash first.

Verify remotes:
```powershell
git remote -v
```

If `upstream` is missing:
```powershell
git remote add upstream https://github.com/Mooshieblob1/MooshieUI.git
```

### 2. Fetch Upstream

```powershell
git -c core.hooksPath=/dev/null fetch upstream main --tags
```

### 3. Review Incoming Changes

```powershell
git log --oneline main..upstream/main
```

Report the number of incoming commits and major changes to the user.

### 4. Merge Upstream into main

```powershell
git checkout main
git -c core.hooksPath=/dev/null merge upstream/main -m "chore: sync with upstream Mooshieblob1/MooshieUI"
```

### 5. Conflict Resolution (if any)

If conflicts occur:
1. Review conflicted files: `git status --short`
2. For protected fork files (`tauri.conf.json`, `reportError.ts`, etc.), ensure the fork's endpoints and keys are kept intact.
3. For core code, merge functionality cleanly.
4. Mark resolved: `git add <file>`
5. Complete merge: `git -c core.hooksPath=/dev/null commit`

### 6. Validation Checks

Run pre-commit checks:
```powershell
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
```

Fix any regressions before pushing.

### 7. Push to Fork

```powershell
git -c core.hooksPath=/dev/null push origin main
```

## Checklist

- [ ] Upstream fetched (`upstream/main`)
- [ ] Incoming changes inspected
- [ ] Merge completed
- [ ] Protected fork settings verified (`tauri.conf.json`, `reportError.ts`, `webserver.rs`)
- [ ] Validation passed (`cargo check`, `npm run check`)
- [ ] Pushed to `origin main`
