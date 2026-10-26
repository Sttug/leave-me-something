# Supported plans (checked 2026-10-26)

Neither Anthropic nor OpenAI publishes exact token caps for these plans. The numbers below are published ranges or third-party estimates, not guarantees.

## Claude (measured by estimate, calibrated with /usage)

| Plan id | Price | Session window | Weekly | Published information |
|---|---|---|---|---|
| `claude-pro` | $20/mo | 5 h rolling | Yes, shared with claude.ai and Claude Desktop | At least 5x Free per session. Weekly floor of about 40 to 80 Sonnet hours. |
| `claude-max-5x` | $100/mo | 5 h rolling | Yes | 5x Pro per session. Weekly floor of about 140 to 280 Sonnet hours. |
| `claude-max-20x` | $200/mo | 5 h rolling | Yes | 20x Pro per session. Weekly floor of about 240 to 480 Sonnet hours. |

- Reset: the 5 h window is rolling. The weekly reset happens at a fixed time per account.
- Sources: support.claude.com (Use Claude Code with your Pro or Max plan; How do usage and length limits work). Anthropic pricing page.
- The skill only sees Claude Code transcripts on this machine. Usage from claude.ai or other devices is not counted.
- Set exact limits with `calibrate` (reads the `/usage` percent) or `limit`.

## ChatGPT / Codex (official percent, no calibration needed)

| Plan id | Price | Five-hour window | Weekly | Published information |
|---|---|---|---|---|
| `chatgpt-plus` | $20/mo | Yes, shared with cloud tasks | May apply, not published | Local messages per 5 h: 5–45 (GPT-6 Astra), 15–160 (GPT-6.1 Sol), 15–150 (GPT-6 Sol), 350–3,000 (GPT-6 Luna). |
| `chatgpt-business` | $30/user/mo (Standard seat) | Yes, same as Plus | May apply | Same ranges as Plus. |
| `chatgpt-pro` | $100 or $200/mo | No five-hour limit in Work and Codex (for Pro 100/200/500) | Yes | About 6x the Plus limits for local and cloud tasks. |

- Reset: the five-hour window starts with your first message in the window and ends five hours later. The weekly reset is seven days after the first request of the week.
- Codex writes the official usage into every turn: `payload.rate_limits.primary` (window_minutes 300) and `secondary` (window_minutes 10080), with `used_percent` and `resets_at`. The skill reads the last one. The figure is only as fresh as the last Codex turn.
- Enterprise and Edu without flexible pricing have the same per-seat limits as Plus. With flexible pricing they have no fixed limits, so the skill cannot guard them.
- Sources: developers.openai.com/codex/pricing; help.openai.com (Usage limits by plan; How resets work in Codex; Paid weekly Work and Codex rate limit resets); the Codex rollout format (`token_count` events with `rate_limits`).

## Harnesses

| Harness | Usage source | Blocking hook |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` (estimate) | `settings.json` `UserPromptSubmit` (`refresh`) and `PreToolUse` (`gate`) |
| Codex CLI | `$CODEX_HOME/sessions/**/rollout-*.jsonl` (official) | `~/.codex/hooks.json` with the same two events. Codex asks you to review the hook in `/hooks` the first time |
| OpenCode | Not measured. OpenCode sessions do not write to the Claude or Codex logs | `~/.config/opencode/plugins/leave-me-something.js` (`chat.message` refresh, `tool.execute.before` gate that throws). Older OpenCode versions may swallow hook errors, so test it |
| Cursor, Gemini CLI, others | Not measured | Not supported yet. They must run `check` before automated work |
