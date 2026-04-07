import { mentorclawOrchestrator } from "../src/core/orchestrator.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const runtimeRoot = resolveMentorclawRuntimeRoot();
const message = process.argv.slice(2).join(" ") || "我两周后要学完一个主题，帮我制定计划";

const repo = new WorkspaceRepo(runtimeRoot);
const orchestrator = new mentorclawOrchestrator(repo);
const outcome = await orchestrator.handleTurn({ message });

console.log(JSON.stringify(outcome, null, 2));
