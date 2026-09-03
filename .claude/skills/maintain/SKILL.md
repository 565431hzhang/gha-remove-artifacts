---
name: maintain
description: Periodic health pass over this project — dependencies, security, CI, errors, runtime. Use when asked to maintain the project, do maintenance, or check its health.
---

# Maintain

## Checks

- **Security** - audit dependencies. Run the ecosystem's own audit.
- **Dependencies** - libraries, runtime, infrastructure.
- **CI** — check default branch CI status.
- **Tests and lint** — full suite locally.
- **Errors** — open and new errors in the error tracker.
- **Background jobs** — failed, stuck, or no longer scheduled.
- **Data health** - e.g. imports and scrapers.
- **Docs** — do they still match reality?
- **Release** — is the released or deployed version behind the default branch?

## Workflow

- MUST upgrade libraries and runtime automatically.
- MUST NOT update infrastructure, SHOULD propose upgrades.
- MUST fix each issue, create separate PRs.
- MUST resolve errors where the fix was released.
- MUST summarize findings per area with counts and severity, including healthy areas ("no issues").
