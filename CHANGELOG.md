# Changelog

All notable changes to `mdd-cli` are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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
