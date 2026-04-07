import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";
import { nowIso } from "../src/utils/time.ts";

const runtimeRoot = resolveMentorclawRuntimeRoot();

const writeIfMissing = async (filePath: string, content: string): Promise<void> => {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, content, "utf8");
  }
};

const main = async (): Promise<void> => {
  const repo = new WorkspaceRepo(runtimeRoot);
  await repo.ensureScaffold();

  const learnerDir = path.join(repo.paths.workspaceRoot, "agent", "learner");
  const plansDir = path.join(repo.paths.workspaceRoot, "agent", "plans");
  const curriculumDir = path.join(repo.paths.workspaceRoot, "agent", "curriculum");

  await writeIfMissing(
    path.join(learnerDir, "LEARNER_STATE.yaml"),
    `version: 1
updated_at: ${nowIso()}
language: zh-CN
timezone: Asia/Shanghai
active_plan_count: 0
active_plan_ids: []
current_focus: null
risk_flags: []
capability_signals: []
`,
  );
  await writeIfMissing(path.join(learnerDir, "PROFILE.md"), "# Learner Profile\n\nStatus: pending population\n");
  await writeIfMissing(path.join(learnerDir, "PREFERENCES.md"), "# Learner Preferences\n\nStatus: pending confirmation\n");
  await writeIfMissing(path.join(learnerDir, "GLOBAL_GOALS.md"), "# Global Goals\n\nStatus: pending population\n");
  await writeIfMissing(path.join(learnerDir, "GLOBAL_MISCONCEPTIONS.yaml"), "[]\n");
  await writeIfMissing(path.join(learnerDir, "EVENTS.jsonl"), "");

  await writeIfMissing(
    path.join(plansDir, "INDEX.yaml"),
    `version: 1
active_plan_id: null
plans: []
`,
  );
  await writeIfMissing(
    path.join(plansDir, "README.md"),
    "# Plans\n\nLive plans live directly under this folder. Templates live under `_template/`.\n",
  );

  await writeIfMissing(
    path.join(curriculumDir, "README.md"),
    "# Curriculum Assets\n\nStore reusable course truth here only when a plan needs it.\n",
  );

  console.log(`Bootstrapped runtime scaffold at ${runtimeRoot}`);
};

await main();
