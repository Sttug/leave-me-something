# leave-me-something

> Keep part of your AI coding quota for yourself.

`leave-me-something` watches your 5-hour and weekly usage on Claude and ChatGPT (Codex) plans. When a window reaches a threshold you choose (default **90%**), it pauses automated AI work and waits for you to resume.

It is a skill with hooks for [Claude Code](https://claude.com/claude-code), [Codex CLI](https://developers.openai.com/codex), and [OpenCode](https://opencode.ai).

## Why

Long agent runs, loops, and scheduled jobs can use up a whole weekly quota in one afternoon. This keeps a reserve so you can still work interactively when it matters.

## Supported tools

| Tool | Plans | How usage is measured | Blocking |
|---|---|---|---|
| Claude Code | Claude Pro, Max 5x, Max 20x | Estimate from local transcripts, calibrated with `/usage` | Hooks in `settings.json` |
| Codex CLI | ChatGPT Plus, Business, Pro | Official percent that Codex writes to its rollout files | Hooks in `~/.codex/hooks.json` |
| OpenCode | Any (blocks tool calls only) | Not measured | Plugin |
| Cursor, Gemini CLI, cron, scripts | Any | Not measured | Not covered. Run `check` first |

Plan details, reset rules, and sources are in [`references/plans.md`](references/plans.md).

## Quick start

**1. Install the skill**

Copy this folder to your skills directory:

```bash
git clone https://github.com/Sttug/leave-me-something.git ~/.claude/skills/leave-me-something
```

**2. Add the hooks you use**

Replace `<SKILL_DIR>` in the hook files with the absolute path to the folder, using forward slashes.

- **Claude Code:** merge [`hooks/claude-code-settings.json`](hooks/claude-code-settings.json) into `~/.claude/settings.json`.
- **Codex CLI:** copy [`hooks/codex-hooks.json`](hooks/codex-hooks.json) to `~/.codex/hooks.json`. Then run `/hooks` in Codex and approve them once.
- **OpenCode:** copy [`hooks/opencode-leave-me-something.js`](hooks/opencode-leave-me-something.js) to `~/.config/opencode/plugins/leave-me-something.js`.

**3. Pick your plans and calibrate Claude**

```bash
SKILL="$HOME/.claude/skills/leave-me-something"
node "$SKILL/scripts/quota_guard.mjs" plans
node "$SKILL/scripts/quota_guard.mjs" plan add claude-pro
node "$SKILL/scripts/quota_guard.mjs" calibrate 5h 57     # percent shown in /usage
node "$SKILL/scripts/quota_guard.mjs" calibrate week 91   # percent shown in /usage
node "$SKILL/scripts/quota_guard.mjs" usage
```

Codex plans need no calibration. They report their own percent.

Requires Node.js 18 or newer. The script has no dependencies.

## How it works

1. Before each tool call, the guard checks usage. The check runs at most once a minute.
2. If any monitored window is at or above the threshold, it writes a pause flag and blocks the call.
3. The pause holds until you run `resume`. It does not clear itself when the window resets.
4. Work already running in the background is not killed. The pause stops the next tool call.

State is stored in `~/.claude/leave-me-something/`.

## Commands

```bash
node "$SKILL/scripts/quota_guard.mjs" <command>
```

| Command | What it does |
|---|---|
| `usage` | Show usage and percent for each active plan |
| `check` | Exit `0` if automation may run, `2` if paused. Use this in scripts and cron jobs |
| `resume` | Lift the pause |
| `status` | Show pause state and config |
| `plans` | List supported plans |
| `plan`, `plan <id>`, `plan add <id>`, `plan remove <id>` | Manage active plans |
| `set threshold <n>` | Change the threshold (default `90`) |
| `set window <5h\|week\|both>` | Choose which windows to guard (default `both`) |
| `set countCacheRead <true\|false>` | Count cache reads toward Claude usage (default `false`) |
| `calibrate <5h\|week> <percent>` | Set a Claude plan limit from the percent in `/usage` |
| `limit <5h\|week> <tokens>` | Set a Claude plan limit manually |
| `refresh`, `gate` | Used by hooks. You don't need to run them |

Plan IDs: `claude-pro`, `claude-max-5x`, `claude-max-20x`, `chatgpt-plus`, `chatgpt-business`, `chatgpt-pro`.

## Using it from scripts and other tools

For anything the hooks don't cover, call `check` first and continue only on exit code `0`:

```bash
node "$SKILL/scripts/quota_guard.mjs" check || exit 0
# run your automated job here
```

## Limits and honesty

- Anthropic and OpenAI do not publish exact token caps. Claude usage is an **estimate**. Codex usage is **official**, but only as fresh as the last Codex turn.
- Only Claude Code and Codex sessions on the same machine are counted. claude.ai, the Claude desktop app, and other devices are not.
- OpenCode and other tools are not measured. OpenCode still blocks tool calls while paused.
- Older OpenCode versions may swallow errors thrown from hooks. If a paused OpenCode session still runs tools, update OpenCode.
- Hooks apply to every session on the machine, interactive ones included. While paused, the assistant can answer in text but cannot use tools.

## Troubleshooting

- **Codex hooks don't run:** open `/hooks` in Codex and approve the hooks. Codex skips new or changed hooks until they are trusted.
- **Claude says "limit not set":** run `calibrate` for each Claude window you monitor.
- **Pause won't go away:** run `resume`, or check `usage` to see which window is over the threshold.

## Contributing

Issues and pull requests are welcome. Keep the script dependency-free and test changes with `node --check scripts/quota_guard.mjs`.

## License

[MIT](LICENSE)
