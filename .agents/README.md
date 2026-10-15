# MooshieUI Agent Config (`.agents/`)

**Canonical source** for project skills and rules. Claude Code and Copilot configs are synced from here.

## Skills

Invoke by name or slash-style request (`/push`, `/release`, etc.):

| Skill | Purpose |
|-------|---------|
| [push](skills/push/SKILL.md) | Commit & push to main (direct or PR), no release |
| [sync-upstream](skills/sync-upstream/SKILL.md) | Fetch & merge updates from upstream MooshieUI |
| [release](skills/release/SKILL.md) | Version bump, tag, CI release |
| [quickrelease](skills/quickrelease/SKILL.md) | Quick release: version bump, tag, CI release (no local compile/lint checks) |
| [cleanup](skills/cleanup/SKILL.md) | Branch hygiene + bot PR triage |
| [pre-commit-check](skills/pre-commit-check/SKILL.md) | Pre-commit / pre-PR validation |
| [add-tauri-command](skills/add-tauri-command/SKILL.md) | New Tauri + TS IPC command |
| [add-generation-param](skills/add-generation-param/SKILL.md) | New generation setting (full stack) |
| [add-comfyui-node](skills/add-comfyui-node/SKILL.md) | New custom ComfyUI Python node + Rust registration |
| [workflow-template-builder](skills/workflow-template-builder/SKILL.md) | ComfyUI workflow templates in Rust |

## Rules

| Rule | When |
|------|------|
| [mooshie-core](rules/mooshie-core.md) | **Always** — build, IPC, git/release |
| [mooshie-architect](rules/mooshie-architect.md) | System design, dual-mode, workflows |
| [mooshie-code-frontend](rules/mooshie-code-frontend.md) | Files under `src/` |
| [mooshie-code-rust](rules/mooshie-code-rust.md) | Files under `src-tauri/` |
| [mooshie-debug](rules/mooshie-debug.md) | Bugs, logs, browser mode |
| [mooshie-ask](rules/mooshie-ask.md) | Explanations, navigation |

## Sync targets

| Target | Format | Notes |
|--------|--------|-------|
| [`.claude/skills/`](../.claude/skills/) | `SKILL.md` | Direct copy (Claude Code project skills) |
| [`.claude/commands/`](../.claude/commands/) | `.md` | Thin slash-command wrappers — surface `/push` etc. in the Claude Code `/` menu; each invokes its skill via the Skill tool |
| [`.github/agents/`](../.github/agents/) | `.agent.md` | Copilot agents (skill + reference inlined) |
| [`.github/prompts/`](../.github/prompts/) | `.prompt.md` | Copilot prompts (`agent: agent` frontmatter, canonical skill body) |

When editing conventions, update `.agents/rules/` first, then re-sync the targets above.

## Core Documentation & Specifications

| Document | Purpose |
|----------|---------|
| [DEVELOPMENT_CYCLE_AND_ROADMAP.md](../docs/DEVELOPMENT_CYCLE_AND_ROADMAP.md) | Phased milestones (M1–M4), OKRs, Quality Gates and Definition of Done |
| [UNIFIED_CANVAS_STUDIO_SPEC.md](../docs/UNIFIED_CANVAS_STUDIO_SPEC.md) | Unified Canvas Studio (txt2img + img2img + inpaint + upscale) architecture |
| [FRONTEND_AGENT_AUDIT.md](../docs/FRONTEND_AGENT_AUDIT.md) | Complete frontend audit, dual-mode gotchas, mock preview harness |
| [UI_UX_AUDIT.md](../docs/UI_UX_AUDIT.md) | UI/UX guidelines, progressive disclosure, and professional workstation ergonomics |

## Also see

- [AGENTS.md](../AGENTS.md) — repo entry for all agents
