import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const runtimeRoot = resolveMentorclawRuntimeRoot();

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
