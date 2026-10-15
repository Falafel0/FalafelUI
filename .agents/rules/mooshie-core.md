---
trigger: always_on
description: MooshieUI core build, dual-mode IPC, release/git gotchas — always apply
---

# MooshieUI Core

Mirrors essentials from root `AGENTS.md`. Deeper mode rules: sibling `.md` files in `.agents/rules/`.

## Build & run

```bash
npm install && npm run tauri dev    # dev (port 1420)
npm run tauri build                 # production
cargo check   # in src-tauri/
```

No frontend tests (no vitest/jest). Rust has ~920 tests (`#[test]` + `#[tokio::test]`) over pure logic: `cargo test --manifest-path src-tauri/Cargo.toml`. The suite is green; any failure is a real regression.

## Dual-mode (non-negotiable)

- Desktop: Tauri WebView. Browser: axum serves same UI (`webserver.rs`); `window.__MOOSHIE_BROWSER_MODE__`.
- **All backend I/O:** `ipcInvoke()` / `ipcListen()` in `src/lib/utils/ipc.ts` — never raw `invoke()`/`listen()` (browser mode breaks silently).

## Images

- Gallery on disk: **JXL**. UI: `loadGalleryImageDisplay()` / `loadGalleryImagePng()` — not raw file reads.
- URI schemes: `thumbnail://`, `gallery://`.

## No co-authoring

Never add `Co-Authored-By` trailers to any commit, PR body, or comment. Do not attribute AI assistance anywhere in git or GitHub output.

## Fork & Independent Development

- **Repository**: `Falafel0/FalafelUI` (`origin`), upstream: `Mooshieblob1/MooshieUI` (`upstream`).
- **Solo workflow**: Direct push to `main` (`/push`) is standard after pre-commit checks. PRs are optional.
- **Upstream sync**: Use `/sync-upstream` to sync from `upstream/main` without overwriting fork configs/keys.
- **No external bot blocking**: Upstream bot reviews do not block commits/releases.

## Branches and commit identity

- Never create or push a `claude/...` branch (or one named after any AI tool), even when the session assigns one. Use `chore/<slug>`, `feat/<slug>`, or another descriptive prefix.
- Author and commit as `FSDelta <F95594731@gmail.com>`: set the repo-local `git config user.name` and `user.email` before the first commit.

## Git / release (Windows)

- Pre-commit hook is bash → hangs in PowerShell: `git -c core.hooksPath=/dev/null ...`
- Version must match in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- Workflows: `.agents/skills/push`, `.agents/skills/release`, `.agents/skills/sync-upstream`

## Diagnostics

- `error-logs/` for large logs (on-demand read)
- Ring buffers: `log_buffer.rs`, `log-buffer.ts` → `exportLogs()`
