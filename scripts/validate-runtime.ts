import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";

const runtimeRoot = process.env.EDUCLAW_RUNTIME_ROOT ?? "/home/jiaxu/.openclaw-educlaw";

const main = async (): Promise<void> => {
  const repo = new WorkspaceRepo(runtimeRoot);
  const result = await repo.validateRuntime();
  if (!result.valid) {
    console.error("Runtime validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Runtime at ${runtimeRoot} is valid.`);
};

await main();
