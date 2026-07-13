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
mdd models                              # list commonly-used model ids
```

Mutating tools (write/edit files, shell, git) prompt for confirmation unless
`--yes` is set. Read-only tools run without prompting. Ctrl-C exits the REPL.

`--model` accepts any id; `mdd models` prints the common ones.

### In-REPL commands

Inside the REPL, lines starting with `/` are commands (not sent to the model):

```
/model [id]        show or switch the model (takes effect next turn)
/models            pick a model with ↑/↓ and enter
/provider <name>   switch provider: anthropic | openai
/theme [name]      switch theme: neon | ocean | mono
/help              show this help
/exit              quit (or press Ctrl-C)
```

The REPL runs as a fullscreen TUI (header box on top, input pinned at the
bottom). Scroll earlier messages with PageUp / PageDown. The status bar shows
the active provider · model, working directory, and git branch, and updates
live when you switch. One-shot (`mdd "…"`) stays inline so its output pipes
cleanly.

## Using 9router (or any OpenAI-compatible endpoint)

[9router](https://github.com/decolua/9router) exposes an OpenAI-compatible API, so
`mdd` talks to it through the `openai` provider — point it at 9router's base URL and
use a 9router model id:

```bash
mdd auth login   # choose openai; paste your 9router key; enter base URL when prompted,
                 # e.g. http://localhost:20128/v1

# or per-invocation, without storing it:
mdd --provider openai \
    --base-url http://localhost:20128/v1 \
    --model cc/claude-opus-4-8 \
    "explain this repo"
```

`mdd models` lists the known 9router (`cc/*`) ids. Base-URL precedence:
`--base-url` flag → `OPENAI_BASE_URL` env → stored config → OpenAI's default.

Note: `mdd`'s tools need the routed backend to support streamed OpenAI **function
calling**; if a model returns text but never invokes tools, that backend likely
doesn't support tool calls in the OpenAI format.

## Config

`~/.config/mdd/config.json` (mode 0600). Env overrides: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OPENAI_BASE_URL`.

## Roadmap (v2)

GitLab and Odoo tools (read-only first), central secrets, richer ink views.
