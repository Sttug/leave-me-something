#!/usr/bin/env node
// Keeps a percentage of the subscription quota free by pausing automation.
// Claude plans: usage is estimated from Claude Code transcripts and calibrated against /usage.
// ChatGPT/Codex plans: usage is the official percent Codex writes into its rollout files.
//
// Commands:
//   usage                      Show usage and percent for each active plan
//   check                      Exit 0 if automation may run, exit 2 if paused (pauses if over threshold)
//   refresh                    Update the pause, never blocks (UserPromptSubmit hooks)
//   gate                       Exit 2 if paused; checks usage first, at most once a minute (PreToolUse hooks)
//   status                     Show pause state and config
//   plans                      List supported plans and which are active
//   plan                       Show active plans
//   plan <id>                  Make <id> the only active plan
//   plan add <id> | remove <id>
//   set <key> <value>          threshold, window (5h|week|both), countCacheRead
//   calibrate <5h|week> <%>    Set the Claude plan limit from the percent shown in /usage
//   limit <5h|week> <tokens>   Set the Claude plan limit manually
//   resume                     Remove the pause (user-initiated only)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const BASE = join(HOME, ".claude", "leave-me-something");
const CONFIG = join(BASE, "config.json");
const PAUSE = join(BASE, "PAUSED");
const STATE = join(BASE, "state.json");
const CLAUDE_PROJECTS = join(HOME, ".claude", "projects");
const CODEX_SESSIONS = join(process.env.CODEX_HOME ?? join(HOME, ".codex"), "sessions");
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WINDOWS = { "5h": 5 * HOUR, week: 7 * DAY };
const LIMIT_KEYS = { "5h": "fiveHourTokenLimit", week: "weeklyTokenLimit" };

// Public information checked on 2026-10-26. Anthropic and OpenAI do not publish exact token caps.
const PLANS = {
  "claude-pro": { provider: "claude", name: "Claude Pro ($20)" },
  "claude-max-5x": { provider: "claude", name: "Claude Max 5x ($100)" },
  "claude-max-20x": { provider: "claude", name: "Claude Max 20x ($200)" },
  "chatgpt-plus": { provider: "codex", name: "ChatGPT Plus ($20, Codex)" },
  "chatgpt-business": { provider: "codex", name: "ChatGPT Business ($30/user, Codex)" },
  "chatgpt-pro": { provider: "codex", name: "ChatGPT Pro ($100 or $200, Codex)" },
};

const DEFAULTS = {
  threshold: 90,
  window: "both",
  countCacheRead: false,
  schedule: null,
  activePlans: ["claude-pro"],
  plans: {},
};

// schedule is { from: "22:00", to: "08:00" } in local time, or null to guard all day.
// The window may cross midnight.
function inSchedule(config, now = new Date()) {
  if (!config.schedule) return true;
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = toMinutes(config.schedule.from);
  const to = toMinutes(config.schedule.to);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}

function loadConfig() {
  mkdirSync(BASE, { recursive: true });
  const saved = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {};
  const config = { ...DEFAULTS, ...saved, plans: { ...(saved.plans ?? {}) } };
  if (saved.plan && !saved.activePlans) config.activePlans = [saved.plan === "20-usd" ? "claude-pro" : saved.plan];
  if (config.plans["20-usd"] && !config.plans["claude-pro"]) config.plans["claude-pro"] = config.plans["20-usd"];
  delete config.plans["20-usd"];
  delete config.plan;
  if (saved.fiveHourTokenLimit !== undefined || saved.weeklyTokenLimit !== undefined) {
    const id = config.activePlans[0] ?? "claude-pro";
    config.plans[id] = {
      ...config.plans[id],
      fiveHourTokenLimit: saved.fiveHourTokenLimit ?? null,
      weeklyTokenLimit: saved.weeklyTokenLimit ?? null,
    };
    delete config.fiveHourTokenLimit;
    delete config.weeklyTokenLimit;
  }
  return config;
}

function saveConfig(config) {
  mkdirSync(BASE, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}

function walkJsonl(dir, sinceMs, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walkJsonl(path, sinceMs, out);
    else if (name.endsWith(".jsonl") && st.mtimeMs >= sinceMs) out.push({ path, mtime: st.mtimeMs });
  }
  return out;
}

// ---- Claude: estimate from transcripts ----

function claudeRecords(sinceMs) {
  const byMessage = new Map();
  for (const { path } of walkJsonl(CLAUDE_PROJECTS, sinceMs)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes('"usage"')) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = obj.message?.usage;
      if (!usage || !obj.timestamp) continue;
      const key = obj.message?.id ?? obj.uuid ?? `${path}:${obj.timestamp}`;
      byMessage.set(key, {
        ts: Date.parse(obj.timestamp),
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheCreate: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
      });
    }
  }
  return [...byMessage.values()];
}

function claudeTokens(records, windowMs, config) {
  const since = Date.now() - windowMs;
  let total = 0;
  for (const r of records) {
    if (r.ts < since) continue;
    total += r.input + r.output + r.cacheCreate + (config.countCacheRead ? r.cacheRead : 0);
  }
  return total;
}

function measureClaude(config, planId) {
  const records = claudeRecords(Date.now() - WINDOWS.week);
  const p = config.plans[planId] ?? {};
  const limits = { "5h": p.fiveHourTokenLimit ?? null, week: p.weeklyTokenLimit ?? null };
  const windows = {};
  for (const name of Object.keys(WINDOWS)) {
    const used = claudeTokens(records, WINDOWS[name], config);
    const limit = limits[name];
    windows[name] = { used, limit, percent: limit ? (used / limit) * 100 : null, source: "estimate" };
  }
  return windows;
}

// ---- Codex: official percent from the latest rollout with rate_limits ----

function latestCodexRateLimits() {
  const files = walkJsonl(CODEX_SESSIONS, Date.now() - 8 * DAY).sort((a, b) => b.mtime - a.mtime);
  for (const { path } of files) {
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let obj;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const rl = obj.payload?.rate_limits;
      if (rl) return { rl, timestamp: obj.timestamp };
    }
  }
  return null;
}

function measureCodex() {
  const found = latestCodexRateLimits();
  const windows = { "5h": emptyWindow("no 5-hour window reported"), week: emptyWindow("no weekly window reported") };
  if (!found) return { windows, note: "no Codex usage found yet" };
  for (const w of [found.rl.primary, found.rl.secondary]) {
    if (!w) continue;
    const key = w.window_minutes <= 360 ? "5h" : w.window_minutes >= 10000 ? "week" : null;
    if (!key) continue;
    const resetPassed = w.resets_at && w.resets_at * 1000 < Date.now();
    const percent = resetPassed ? 0 : w.used_percent;
    windows[key] = {
      used: null,
      limit: null,
      percent,
      resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null,
      source: "official",
    };
  }
  return { windows, note: `as of ${found.timestamp} (updates on each Codex turn)` };
}

function emptyWindow(reason) {
  return { used: null, limit: null, percent: null, source: reason };
}

function measurePlan(config, planId) {
  const plan = PLANS[planId];
  if (plan.provider === "claude") return { id: planId, name: plan.name, windows: measureClaude(config, planId) };
  const m = measureCodex();
  return { id: planId, name: plan.name, windows: m.windows, note: m.note };
}

function measureAll(config) {
  return config.activePlans.map((id) => measurePlan(config, id));
}

function inScope(config, name) {
  return config.window === "both" || config.window === name;
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

function describeWindow(w, name) {
  const label = name === "5h" ? "5-hour" : "weekly";
  if (w.source === "official") {
    const reset = w.resetsAt ? `, resets ${new Date(w.resetsAt).toLocaleString("en-US")}` : "";
    return `${label}: ${w.percent === null ? "n/a" : w.percent.toFixed(1) + "%"} (official${reset})`;
  }
  if (w.percent === null && w.source !== "estimate") return `${label}: ${w.source}`;
  if (w.limit === null) return `${label}: ${fmt(w.used)} tokens | limit not set (run calibrate)`;
  return `${label}: ${fmt(w.used)} tokens | ${w.percent.toFixed(1)}% of ${fmt(w.limit)} (estimate)`;
}

function printUsage(config, plans) {
  for (const p of plans) {
    console.log(`${p.name}`);
    for (const name of ["5h", "week"]) {
      const text = describeWindow(p.windows[name], name);
      console.log(`  ${text}${inScope(config, name) ? "" : " | not monitored"}`);
    }
    if (p.note) console.log(`  ${p.note}`);
  }
  const schedule = config.schedule
    ? `${config.schedule.from}-${config.schedule.to} (${inSchedule(config) ? "active now" : "inactive now"})`
    : "always";
  console.log(`threshold: ${config.threshold}% | monitoring: ${config.window} | schedule: ${schedule}`);
}

function readPause() {
  return existsSync(PAUSE) ? JSON.parse(readFileSync(PAUSE, "utf8")) : null;
}

// Updates the pause flag from current usage. Returns the measurements and the hits.
function applyThreshold(config) {
  const plans = measureAll(config);
  const hits = [];
  if (!inSchedule(config)) return { plans, hits, outsideSchedule: true };
  for (const p of plans) {
    for (const name of ["5h", "week"]) {
      const w = p.windows[name];
      if (inScope(config, name) && w.percent !== null && w.percent >= config.threshold) {
        hits.push(`${p.name} ${name} at ${w.percent.toFixed(1)}%`);
      }
    }
  }
  return { plans, hits };
}

// Reuses a measurement from the last 60 seconds so every tool call does not rescan transcripts.
function cachedHits(config) {
  const state = readJson(STATE, {});
  const sameRules =
    state.threshold === config.threshold &&
    state.window === config.window &&
    JSON.stringify(state.schedule ?? null) === JSON.stringify(config.schedule);
  if (sameRules && state.ts && Date.now() - state.ts < 60_000) return state.hits;
  const { hits } = applyThreshold(config);
  writeJson(STATE, {
    ...state,
    ts: Date.now(),
    hits,
    threshold: config.threshold,
    window: config.window,
    schedule: config.schedule,
  });
  return hits;
}

// Pauses when over the threshold. The pause holds until the user runs "resume".
// Returns "paused" only on the transition, so the user is told once.
function syncPause(hits) {
  const state = readJson(STATE, {});
  if (!hits.length) {
    if (state.suppressed) writeJson(STATE, { ...state, suppressed: false });
    return null;
  }
  if (existsSync(PAUSE) || state.suppressed) return null;
  writeJson(PAUSE, { since: new Date().toISOString(), reason: hits.join("; ") });
  return "paused";
}

// The command a hook is about to run: from the hook's JSON on stdin, or from QUOTA_GUARD_COMMAND (OpenCode plugin).
function toolCommand() {
  if (process.env.QUOTA_GUARD_COMMAND) return process.env.QUOTA_GUARD_COMMAND;
  if (process.stdin.isTTY) return "";
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}").tool_input?.command ?? "";
  } catch {
    return "";
  }
}

// Only the exact resume command is allowed through while paused, so the guard can be lifted from inside the session.
function isResumeCommand(command) {
  return /^\s*node\s+"?[^"\s]*quota_guard\.mjs"?\s+resume\s*$/.test(command);
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function writeJson(path, value) {
  mkdirSync(BASE, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function activeClaudePlan(config) {
  return config.activePlans.find((id) => PLANS[id]?.provider === "claude");
}

const [, , cmd = "usage", ...args] = process.argv;
const config = loadConfig();

switch (cmd) {
  case "usage": {
    printUsage(config, measureAll(config));
    break;
  }

  case "check": {
    const { plans, hits } = applyThreshold(config);
    const change = syncPause(hits);
    printUsage(config, plans);
    if (existsSync(PAUSE)) {
      console.log(`PAUSED (threshold ${config.threshold}%): ${readJson(PAUSE, {}).reason}`);
      process.exit(2);
    }
    console.log("OK: automation may run");
    break;
  }

  case "refresh": {
    const change = syncPause(cachedHits(config));
    if (change === "paused") console.error(`Quota guard: pausing automation (${readJson(PAUSE, {}).reason}). Stopping here; work resumes automatically when usage drops under ${config.threshold}%.`);
    break;
  }

  case "gate": {
    if (isResumeCommand(toolCommand())) break;
    syncPause(cachedHits(config));
    if (existsSync(PAUSE)) {
      console.error(`Quota guard: paused (${readJson(PAUSE, {}).reason}). This tool call is blocked. Work continues automatically when usage drops under ${config.threshold}%, or the user can run "resume".`);
      process.exit(2);
    }
    break;
  }

  case "status": {
    const pause = readPause();
    console.log(pause ? `PAUSED since ${pause.since}: ${pause.reason}` : "not paused");
    console.log(JSON.stringify(config, null, 2));
    break;
  }

  case "plans": {
    for (const [id, p] of Object.entries(PLANS)) {
      const active = config.activePlans.includes(id) ? " (active)" : "";
      console.log(`${id}: ${p.name} [${p.provider}]${active}`);
    }
    break;
  }

  case "plan": {
    const [action, id] = args;
    if (!action) {
      console.log(`active: ${config.activePlans.join(", ") || "none"}`);
      break;
    }
    if (action === "add" || action === "remove") {
      if (!PLANS[id]) unknownPlan(id);
      const list = new Set(config.activePlans);
      if (action === "add") list.add(id);
      else list.delete(id);
      config.activePlans = [...list];
    } else {
      if (!PLANS[action]) unknownPlan(action);
      config.activePlans = [action];
    }
    saveConfig(config);
    console.log(`active: ${config.activePlans.join(", ") || "none"}`);
    break;
  }

  case "set": {
    const [key, raw] = args;
    const valid = ["threshold", "window", "countCacheRead", "schedule"];
    if (!valid.includes(key)) {
      console.log(`unknown key: ${key}. valid: ${valid.join(", ")}`);
      process.exit(1);
    }
    let value = raw;
    if (raw === "true" || raw === "false") value = raw === "true";
    else if (!isNaN(Number(raw)) && raw.trim() !== "") value = Number(raw);
    if (key === "window" && !["5h", "week", "both"].includes(value)) {
      console.log("window must be 5h, week or both");
      process.exit(1);
    }
    if (key === "schedule") {
      const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(raw ?? "");
      if (raw === "off") value = null;
      else if (match) value = { from: match[1], to: match[2] };
      else {
        console.log('schedule must be "HH:MM-HH:MM" (local time, e.g. 22:00-08:00) or "off"');
        process.exit(1);
      }
    }
    config[key] = value;
    saveConfig(config);
    console.log(`${key} = ${JSON.stringify(value)}`);
    break;
  }

  case "calibrate": {
    const [name, rawPct] = args;
    const percent = Number(rawPct);
    const planId = activeClaudePlan(config);
    if (!planId) {
      console.log("calibrate only applies to Claude plans. Codex percentages are official.");
      process.exit(1);
    }
    if (!WINDOWS[name] || !(percent > 0 && percent <= 100)) {
      console.log("usage: calibrate <5h|week> <percent between 1 and 100>");
      process.exit(1);
    }
    const used = claudeTokens(claudeRecords(Date.now() - WINDOWS[name]), WINDOWS[name], config);
    const limit = Math.round(used / (percent / 100));
    config.plans[planId] = { ...config.plans[planId], [LIMIT_KEYS[name]]: limit };
    saveConfig(config);
    console.log(`${planId}: ${name} limit set to ${fmt(limit)} tokens (${fmt(used)} used = ${percent}%)`);
    break;
  }

  case "limit": {
    const [name, raw] = args;
    const tokens = Number(raw);
    const planId = activeClaudePlan(config);
    if (!planId || !WINDOWS[name] || !(tokens > 0)) {
      console.log("usage: limit <5h|week> <tokens>, needs an active Claude plan");
      process.exit(1);
    }
    config.plans[planId] = { ...config.plans[planId], [LIMIT_KEYS[name]]: tokens };
    saveConfig(config);
    console.log(`${planId}: ${name} limit set to ${fmt(tokens)} tokens`);
    break;
  }

  case "resume": {
    if (existsSync(PAUSE)) unlinkSync(PAUSE);
    writeJson(STATE, { ...readJson(STATE, {}), suppressed: true });
    console.log("resumed. The guard stays off until usage drops under the threshold and rises again.");
    break;
  }

  default:
    console.log("commands: usage | check | refresh | gate | status | plans | plan | set | calibrate | limit | resume");
    process.exit(1);
}

function unknownPlan(id) {
  console.log(`unknown plan: ${id}. Run "plans" to see the list.`);
  process.exit(1);
}
