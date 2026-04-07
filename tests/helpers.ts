import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LearnerState } from "../src/schemas/models.ts";

const learnerState: LearnerState = {
  version: 1,
  updated_at: null,
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  active_plan_count: 0,
  active_plan_ids: [],
  current_focus: null,
  risk_flags: [],
  capability_signals: [],
};

export const createRuntimeFixture = async (): Promise<string> => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "mentorclaw-runtime-"));
  const workspaceRoot = path.join(runtimeRoot, "workspace");

  await mkdir(path.join(workspaceRoot, "agent", "learner"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "agent", "plans"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "agent", "curriculum"), { recursive: true });

  await Promise.all([
    writeFile(path.join(workspaceRoot, "AGENTS.md"), "# AGENTS\n", "utf8"),
    writeFile(path.join(workspaceRoot, "SOUL.md"), "# SOUL\n", "utf8"),
    writeFile(path.join(workspaceRoot, "TOOLS.md"), "# TOOLS\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "PROFILE.md"), "# Profile\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "PREFERENCES.md"), "# Preferences\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "GLOBAL_GOALS.md"), "# Goals\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "learner", "GLOBAL_MISCONCEPTIONS.yaml"), "[]\n", "utf8"),
    writeFile(
      path.join(workspaceRoot, "agent", "learner", "LEARNER_STATE.yaml"),
      `version: 1
updated_at: null
language: zh-CN
timezone: Asia/Shanghai
active_plan_count: 0
active_plan_ids: []
current_focus: null
risk_flags: []
capability_signals: []
`,
      "utf8",
    ),
    writeFile(path.join(workspaceRoot, "agent", "learner", "EVENTS.jsonl"), "", "utf8"),
    writeFile(
      path.join(workspaceRoot, "agent", "plans", "INDEX.yaml"),
      `version: 1
active_plan_id: null
plans: []
`,
      "utf8",
    ),
    writeFile(path.join(workspaceRoot, "agent", "plans", "README.md"), "# Plans\n", "utf8"),
    writeFile(path.join(workspaceRoot, "agent", "curriculum", "README.md"), "# Curriculum\n", "utf8"),
  ]);

  return runtimeRoot;
};

export { learnerState };
