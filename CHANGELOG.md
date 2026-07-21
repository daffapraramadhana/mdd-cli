# Changelog

All notable changes to `mdd-cli` are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Clearer rate-limit (429) handling.** When a request is rate-limited, the agent now reads the reset time from the response's `Retry-After` header (falling back to the `reset after …` hint some gateways such as 9router include in the error body). Short resets are waited out and retried automatically; longer ones surface a clean, actionable message — e.g. `Rate limited on cc/claude-sonnet-5. Retry in 1m 4s.` — instead of a raw JSON error dump, and the agent no longer immediately re-fires against a limit that is still in effect.

## [0.5.0] - 2026-07-14

### Added
- **Skills** — reusable instruction bundles the agent loads on demand. A skill is a folder with a `SKILL.md` (optional `name`/`description` frontmatter plus a markdown body), discovered from `<repo>/.mdd/skills/` (project, checked in) and `~/.config/mdd/skills/` (personal); project skills override personal ones of the same name. The agent sees a compact list of available skills in its system prompt and pulls a skill's full instructions into context with the new read-only `use_skill` tool (no confirmation prompt). Skills work in both the interactive REPL and one-shot mode.

## [0.4.0] - 2026-07-14

The agent can now reach the web, and you can switch its permission posture on the fly.

### Added
- **Web search & fetch** — two new agent tools:
  - `web_search` queries the web through the 9router `/v1/search` endpoint (Tavily backend) and returns titles, URLs, and snippets. It reuses your stored 9router credentials, so there's no extra config.
  - `web_fetch` retrieves any `http(s)` URL as readable text (HTML stripped to text), with an SSRF guard that refuses `localhost`/private-network addresses.
  - Both ask for confirmation before running (with the usual "always allow this session" option), and the agent is told about them in the system prompt.
- **Mode cycling** — press `Shift+Tab` to rotate the session's permission posture between three modes, shown live in the status bar:
  - **normal** — every file/shell/git change asks first (default).
  - **auto-accept edits** — file edits (`write_file`, `edit_file`, `multi_edit`) apply without prompting; shell and git still ask.
  - **plan** — the agent proposes a concrete plan via the new `present_plan` tool and can't touch files until you approve; approving switches back to normal and it executes.

## [0.3.1] - 2026-07-14

### Added
- **Update notification** — a throttled (once/day) background check on startup nudges you in the status bar when a newer version is published on npm (`↑ update available: vX.Y.Z · npm i -g mdd-cli`). Silent on failure; opt out with `MDD_NO_UPDATE_CHECK`.

### Changed
- Thinking and reasoning indicators now use a braille spinner.

## [0.3.0] - 2026-07-14

A large UI/UX release: the terminal turn now feels alive and legible, and every
moment where the agent pauses for you got a proper interface.

### Added
- **Streaming thinking display** — a live reasoning block while the model thinks, collapsing to a compact `✻ Thought for Ns` summary in scrollback.
- **Tool result previews** — each finished tool call shows a one-line summary of what it did (e.g. `126 lines · 4.2 KB`, `16 entries`, `42 passing`).
- **Live tool timer & turn heartbeat** — running tools tick up elapsed time; while a turn is busy the footer shows elapsed time and an `esc to interrupt` hint.
- **Interrupt** — press `Esc` to abort an in-flight turn.
- **`ask_user` tool** — the agent can pause and ask you a question, offering suggested options you pick with the arrow keys or a free-text answer you type.
- **Image attachments** — drag or paste an image path to send the image to the model.
- **Long-paste collapsing** — long pastes become compact inline chips in the input while the full text is still sent to the model.

### Changed
- **Permission confirmation redesigned** — instead of raw JSON + typed `y/n/a`, the confirmation is a card showing the action in human-readable form (e.g. `⎇ git log --oneline -15`, with the full untruncated command) and arrow-key **yes / no — tell it what to do instead / always**. Rejecting with a reason feeds that reason back to the model so it can adjust.
- **Unified picker** — `/models` and `/resume` now use the same styled arrow-key prompt card as confirmations and questions.
- **Header & input chrome** — full-width, responsive header banner and a Claude-style input frame (full-width rule, always-visible prompt); completed stream blocks flush into scrollback so the input stays pinned at the bottom.
- **9router endpoint** now points at `https://ai-router.mdd.co.id/v1`.
- **Model picker** — added `cx/gpt-5.5`, `cx/gpt-5.4`, `cx/gpt-5.4-mini`, `cx/gpt-5.3-codex-spark`, and `mdd-free-combo`; removed the native `claude-opus-4-8` / `gpt-5` entries from the list (they remain fully usable as defaults and via `--model`).

### Fixed
- The plain `thinking…` placeholder no longer shows while the reasoning block is streaming.
- Header spans the full terminal width (explicit width instead of `100%`).
- Input submits from the live value (fixes a stale-input edge case after paste-collapse).

## [0.2.0] - earlier

- Live token and estimated-cost meter in the status bar.
- Hardcoded 9router endpoint and single-source version.
- Guided first-run onboarding; published to npm as `mdd-cli`.

## [0.1.0] - earlier

- Initial release: agentic loop that reads/searches/edits files and runs shell & git, multi-provider (Anthropic / OpenAI-compatible), fullscreen Ink TUI, per-user config, session persistence.
