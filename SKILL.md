---
name: leave-me-something
description: Pauses automated or unattended AI coding work when subscription quota reaches a set percentage (default 90%) of the 5-hour or weekly window. Supports Claude plans (Pro, Max 5x, Max 20x; Claude Code) and ChatGPT plans with Codex (Plus, Business, Pro), and works with Claude Code, Codex CLI and OpenCode through hooks. Use this skill whenever the user mentions leaving a percentage of their quota, stopping automations, scheduled tasks or agents when the quota runs low, checking how much of the 5-hour or weekly limit is used, adding or switching a plan, calibrating the threshold, or resuming after a quota pause. Also use before starting any long-running, looping, scheduled, or background job while the guard is enabled.
---

# leave-me-something

This skill keeps a percentage of each subscription quota free. When a monitored window reaches the threshold, it writes a pause flag. Hooks in Claude Code, Codex CLI and OpenCode then block tool use until the user resumes.

## How usage is measured

- **ChatGPT / Codex plans:** official. Codex writes `used_percent` and `resets_at` into its rollout files. No calibration needed. The figure is only as fresh as the last Codex turn.
- **Claude plans:** estimate. The skill sums tokens from `~/.claude/projects/**/*.jsonl`. Calibrate the limit with `/usage` (see Workflow).
- **Not measured:** OpenCode sessions, Cursor, Gemini CLI and other tools. OpenCode still gets the pause hook, but its own usage is not counted.

Plan details and sources: `references/plans.md`. Read it when the user asks about limits or reset times.

## Files

- Script: `scripts/quota_guard.mjs` (Node, no dependencies)
- Config: `~/.claude/leave-me-something/config.json`
- Pause flag: `~/.claude/leave-me-something/PAUSED` (exists only while paused)
- Hooks: `~/.claude/settings.json` (Claude Code), `~/.codex/hooks.json` (Codex CLI), `~/.config/opencode/plugins/leave-me-something.js` (OpenCode)

Run commands with:

```
node "<SKILL_DIR>/scripts/quota_guard.mjs" <command>
```

## Commands

| Command | Purpose |
|---|---|
| `usage` | Show usage and percent for each active plan |
| `check` | Exit 0 if automation may run. If a threshold is reached, write the pause flag and exit 2 |
| `refresh` | Update the pause flag from current usage. Never blocks. Used by `UserPromptSubmit` hooks |
| `gate` | Exit 2 if paused, without scanning transcripts. Used by `PreToolUse` hooks |
| `status` | Show pause state and config |
| `plans` | List supported plans and which ones are active |
| `plan` | Show active plans |
| `plan <id>` | Make `<id>` the only active plan |
| `plan add <id>` / `plan remove <id>` | Add or remove one plan from the active set |
| `set <key> <value>` | `threshold` (default 90), `window` (`5h`, `week`, or `both`; default `both`), `countCacheRead` (default false), `schedule` (`HH:MM-HH:MM` in local time, e.g. `22:00-08:00`, or `off` to guard all day; default `off`) |
| `calibrate <5h\|week> <percent>` | Set the active Claude plan's limit from the percent shown in `/usage` |
| `limit <5h\|week> <tokens>` | Set the active Claude plan's limit manually |
| `resume` | Lift the pause. Only when the user asks |

Plan ids: `claude-pro`, `claude-max-5x`, `claude-max-20x`, `chatgpt-plus`, `chatgpt-business`, `chatgpt-pro`.

The user's current active plan is `claude-pro` (the $20 Claude plan), calibrated to 57% (5 h) and 91% (week) on 2026-10-26.

## Workflow

### First-time setup

1. Run `plans` and ask which plans the user has. Activate them with `plan add <id>`. Use `plan <id>` if they have only one.
2. For each active Claude plan, ask the user for the percent shown in `/usage` for the 5-hour and weekly limits, then run `calibrate 5h <percent>` and `calibrate week <percent>`. Use a value above 5% for accuracy. If the percent is 0, wait for some usage first. Codex plans do not need this step.
3. Ask which window to guard (`5h`, `week` or `both`) and the threshold (default 90). Run `set window` and `set threshold` if they change.
4. Ask the user to install the Codex hooks if they use Codex CLI: run `/hooks` in Codex and approve the new hooks. Ask them to restart OpenCode if they use it.
5. Run `usage` and show the result.

### Before any automated or unattended work

Run `check` first.
- Exit 0: continue and report the usage briefly.
- Exit 2: do not start the job. Tell the user which plan and window triggered the pause and when it resets.

### When a pause is triggered

- The pause is total. It stops all automated work when the threshold is reached, and it holds until the user runs `resume`. It does not clear on its own when the window resets.
- Stop any loop, scheduled job, or background work you started in this session, once. Report what was stopped. Processes already running in the background are not killed.
- Do not run `resume` on your own. The user decides when to continue.
- When the user's message is `/leave-me-something resume` (or they clearly ask to resume), run this exact command as your first and only tool call, with nothing chained to it: `node "<SKILL_DIR>/scripts/quota_guard.mjs" resume`. The pause hook allows exactly this command, so it is the only way to resume from inside the session.
- Explain that the hooks block tool calls in every session, interactive ones too, while paused. Claude can still answer in text.

### When the user only asks about quota

Run `usage` and report the numbers in plain language. Do not run `check`, because it can write the pause flag.

## Enforcing the pause

- **Claude Code:** `UserPromptSubmit` runs `refresh`; `PreToolUse` (matcher `*`) runs `gate`. Configured in `settings.json`. `gate` rechecks usage before each tool call, at most once a minute, so a long agent run stops during the run.
- **Codex CLI:** same two events in `~/.codex/hooks.json`. Codex blocks a tool call when the hook exits with code 2. The user must trust the hook once in `/hooks`.
- **OpenCode:** the plugin refreshes on each chat message and throws in `tool.execute.before` when paused. Older OpenCode versions may swallow hook errors. If a paused OpenCode session still runs tools, tell the user to update OpenCode.
- **Everything else** (Cursor, Gemini CLI, cron jobs, scripts): not covered. They must run `check` and continue only on exit code 0.

Changing hooks in global settings affects every session on the machine. Only add or remove them when the user asks.

## Reply style

Reply in the user's language. Keep updates short: the plan, the window, the percentage, the threshold, and the action taken.
