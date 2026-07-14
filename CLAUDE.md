# mdd-cli — project instructions

## Changelog discipline

This project follows [Keep a Changelog](https://keepachangelog.com/) and SemVer.
`CHANGELOG.md` is the source of truth for user-facing history.

**For every change, decide whether it is user-facing.** If it is, add a bullet under
`## [Unreleased]` in `CHANGELOG.md` **in the same commit**, beneath the right heading
(`Added` / `Changed` / `Fixed` / `Deprecated` / `Removed` / `Security`). Not every change
needs an entry.

**Add an entry for:**
- New features, tools, flags, or commands
- Behavior changes a user would notice
- Bug fixes a user would notice
- Deprecations, removals, breaking changes, security fixes

**Skip (no entry needed):**
- Internal refactors with no behavior change
- Test-only changes
- Doc / comment / formatting tweaks
- CI / build config
- Dependency bumps with no user-visible impact

Write entries from the user's point of view (what changed for them), not the
implementation detail. Keep `## [Unreleased]` at the top of the changelog; at release
time it is renamed to the new version with a date, `package.json` `version` is bumped to
match, and a fresh empty `## [Unreleased]` is added.
