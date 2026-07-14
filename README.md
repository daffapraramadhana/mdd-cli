# mdd

[![npm version](https://img.shields.io/npm/v/mdd-cli.svg)](https://www.npmjs.com/package/mdd-cli)
[![node](https://img.shields.io/node/v/mdd-cli.svg)](https://nodejs.org)

MDD's terminal coding assistant. Chat with an AI agent that reads and edits files,
runs shell/git, and streams its work in a polished terminal UI — multi-provider
(Anthropic + OpenAI-compatible, including 9router), with confirmation before any change.

**Features**

- 🤖 Agentic loop — reads, searches, edits files and runs shell & git to complete tasks
- 🧩 Skills — reusable `SKILL.md` instruction bundles the agent loads on demand
- 🔌 Multi-provider — Anthropic, OpenAI, or any OpenAI-compatible endpoint (9router)
- 📊 Live token + estimated-cost meter in the status bar
- 🖥️ Fullscreen TUI — gradient header, live tool status & timing, markdown replies, themes
- 🔒 Safe by default — every file/shell/git change asks for confirmation first
- ⚡ Switch on the fly — `/model`, `/provider`, `/theme` without restarting
- 📜 History persists — your conversation prints back to the terminal on exit

---

## Quick start (for MDD teammates)

**1. Install** (needs [Node.js](https://nodejs.org) 20+):

```bash
npm install -g mdd-cli
```

**2. Run it** — the first time, it walks you through setup automatically:

```bash
mdd
```

A short wizard walks you through it. **For the company 9router**, just:

1. Choose **`1) 9router`**
2. Paste your API key *(ask Daffa for it)*

That's it — the endpoint and a good default model are set for you. Pick a different
model any time with `/models`, then start chatting. 🎉

**Update later:**

```bash
npm install -g mdd-cli@latest
```

---

## Everyday use

```bash
mdd                                     # interactive chat (fullscreen TUI)
mdd "add a health check and run tests"  # one-shot: answer and exit
mdd --yes "reformat src/**/*.ts"        # auto-approve file/shell changes (careful!)
```

Mutating tools (write/edit files, shell, git) ask for confirmation. Read-only tools
run silently. Your conversation prints to the terminal when you exit, so it stays in
your scrollback.

### In-chat commands

Type these inside the chat (a leading `/` means it's a command, not a prompt):

```
/models            pick a model with ↑/↓ and Enter
/model [id]        show or switch the model directly
/provider <name>   switch provider: anthropic | openai
/theme [name]      switch theme: neon | ocean | mono
/help              list commands
/exit              quit (or press Ctrl-C)
```

`PageUp` / `PageDown` scroll earlier messages. The status bar shows the active
provider · model, working directory, and git branch.

---

## 9router (and any OpenAI-compatible endpoint)

`mdd` reaches 9router through the `openai` provider — you just point it at the base URL
and use a 9router model id. The setup wizard stores this for you, or per-invocation:

```bash
mdd --provider openai \
    --base-url http://192.168.7.8:20128/v1 \
    --model cc/claude-sonnet-5 \
    "explain this repo"
```

`mdd models` lists the known 9router (`cc/*`) ids. Base-URL precedence:
`--base-url` flag → `OPENAI_BASE_URL` env → stored config → OpenAI's default.

> The routed model must support streamed OpenAI **function calling** for tools to fire.
> If a model replies with text but never runs a tool, that backend doesn't support it.

---

## Skills

Skills are small, reusable bundles of instructions the agent can load on demand.
Each skill is a folder with a `SKILL.md` file; the agent sees a short list of
available skills in its system prompt and pulls a skill's full instructions into
context (via the `use_skill` tool) only when a task matches.

Skills are discovered from two places:

- **Project skills:** `<repo>/.mdd/skills/<name>/SKILL.md` — checked into the repo,
  shared with your team.
- **Personal skills:** `~/.config/mdd/skills/<name>/SKILL.md` — just for you.

A project skill overrides a personal skill with the same name.

A minimal `SKILL.md`:

```markdown
---
name: deploy
description: How to release the app to staging
---

1. Run `npm run build`.
2. Push the image with `./scripts/deploy.sh staging`.
3. Verify the health check at https://staging.example.com/healthz.
```

The frontmatter (`name`, `description`) is optional — with no frontmatter, the
folder name becomes the skill name and the whole file is the instruction body.
Skills are read-only and load without a confirmation prompt.

## Config

Stored at `~/.config/mdd/config.json` (mode `0600`). Re-run setup any time with
`mdd auth login`. Environment overrides: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENAI_BASE_URL`.

## Roadmap

GitLab and Odoo tools (read-only first), central secrets, richer skills
(bundled scripts/resources, a `/skills` command).
