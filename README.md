# leave-me-something

Keeps a percentage of your AI coding subscription quota free. When the 5-hour or weekly window reaches a threshold (default 90%), automated work stops until you run `resume`.

Works with:
- **Claude Code**, Claude Pro, Max 5x and Max 20x. Usage is estimated from local transcripts and calibrated against `/usage`.
- **Codex CLI**, ChatGPT Plus, Business and Pro. Usage is the official percent Codex writes to its rollout files.
- **OpenCode**, through a plugin that blocks tool calls while paused.

Other tools (Cursor, Gemini CLI, cron jobs, scripts) are not covered by hooks. They must run `quota_guard.mjs check` before automated work and continue only on exit code 0.

## Install

1. Copy this folder to your skills directory, for example `~/.claude/skills/leave-me-something`.
2. Add the hooks you use. Replace `<SKILL_DIR>` in each file with the absolute path to the folder above, using forward slashes:
   - Claude Code: merge `hooks/claude-code-settings.json` into `~/.claude/settings.json`.
   - Codex CLI: copy `hooks/codex-hooks.json` to `~/.codex/hooks.json`, then approve the hooks once in `/hooks`.
   - OpenCode: copy `hooks/opencode-leave-me-something.js` to `~/.config/opencode/plugins/leave-me-something.js`.
3. Choose your plans and calibrate:

```
node "<SKILL_DIR>/scripts/quota_guard.mjs" plans
node "<SKILL_DIR>/scripts/quota_guard.mjs" plan add claude-pro
node "<SKILL_DIR>/scripts/quota_guard.mjs" calibrate 5h 57
node "<SKILL_DIR>/scripts/quota_guard.mjs" calibrate week 91
node "<SKILL_DIR>/scripts/quota_guard.mjs" usage
```

Claude calibration uses the percent shown by `/usage`. Codex plans need no calibration.

## Commands

| Command | Purpose |
|---|---|
| `usage` | Show usage and percent for each active plan |
| `check` | Exit 0 if automation may run, exit 2 if paused |
| `gate` / `refresh` | Used by hooks |
| `plans`, `plan`, `plan add/remove` | Manage active plans |
| `set threshold`, `set window`, `set countCacheRead` | Change settings |
| `calibrate 5h <percent>`, `calibrate week <percent>` | Set a Claude plan limit from `/usage` |
| `limit 5h <tokens>`, `limit week <tokens>` | Set a Claude plan limit manually |
| `resume` | Lift the pause |

## How the pause works

- When usage reaches the threshold, the guard writes a pause flag and blocks tool calls. Work that is still running stops at its next tool call. Processes already running in the background are not killed.
- The pause holds until you run `resume`. It does not clear itself when the window resets.
- Config and state live in `~/.claude/leave-me-something/`.

## Limits

- Anthropic and OpenAI do not publish exact token caps. Claude usage is an estimate. Codex usage is official but only as fresh as the last Codex turn.
- Only Claude Code and Codex transcripts on this machine are counted.
- See `references/plans.md` for plan details and sources.

## License

MIT
