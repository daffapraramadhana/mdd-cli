# mdd

MDD's internal terminal coding assistant. Multi-provider (Anthropic + OpenAI),
reads and edits files, runs shell/git — with confirmation before any change.
Interactive terminal UI built on ink.

## Install

```bash
npm install -g @mdd/cli   # or: npm i -g <git-url>
```

## Setup

```bash
mdd auth login   # store your Anthropic and/or OpenAI API key
```

## Usage

```bash
mdd                                     # interactive REPL (ink UI)
mdd "add a health check and run tests"  # one-shot
mdd --provider openai --model gpt-5 "explain this repo"
mdd --yes "reformat src/**/*.ts"        # auto-approve mutations (use with care)
```

Mutating tools (write/edit files, shell, git) prompt for confirmation unless
`--yes` is set. Read-only tools run without prompting. Ctrl-C exits the REPL.

## Config

`~/.config/mdd/config.json` (mode 0600). Env overrides: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`.

## Roadmap (v2)

GitLab and Odoo tools (read-only first), central secrets, richer ink views.
