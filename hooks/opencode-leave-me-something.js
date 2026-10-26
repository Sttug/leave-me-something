const SCRIPT = "<SKILL_DIR>/scripts/quota_guard.mjs";

export const LeaveMeSomething = async ({ $ }) => ({
  "chat.message": async () => {
    await $`node ${SCRIPT} refresh`.nothrow().quiet();
  },
  "tool.execute.before": async () => {
    const result = await $`node ${SCRIPT} gate`.nothrow().quiet();
    if (result.exitCode === 2) {
      throw new Error(result.stderr.toString().trim() || "Quota guard: automation paused.");
    }
  },
});
