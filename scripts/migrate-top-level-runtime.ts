import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SessionBindingStore } from "../src/integration/openclaw-adapter.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const runtimeRoot = resolveMentorclawRuntimeRoot(process.argv[2]);
const workspaceTemplateRoot = path.join(import.meta.dirname, "..", "templates", "runtime", "workspace");
const rootTemplates = ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "MEMORY.md"];

const syncTemplate = async (workspaceRoot: string, relativePath: string): Promise<void> => {
  const template = await readFile(path.join(workspaceTemplateRoot, relativePath), "utf8");
  await writeFile(path.join(workspaceRoot, relativePath), template, "utf8");
};

const main = async (): Promise<void> => {
  const repo = new WorkspaceRepo(runtimeRoot);
  const educationRepo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();
  await educationRepo.ensureScaffold();

  for (const relativePath of rootTemplates) {
    await syncTemplate(repo.paths.workspaceRoot, relativePath);
  }

  const projectIds = await repo.listProjectIds();
  for (const projectId of projectIds) {
    const project = await repo.readProjectState(projectId);
    await repo.writeProjectState(project);
  }

  const bindingStore = new SessionBindingStore(repo.paths.workspaceRoot);
  const bindings = await bindingStore.list();
  for (const binding of bindings) {
    await bindingStore.set(binding);
  }

  console.log(`Migrated mentorclaw runtime at ${runtimeRoot}`);
  console.log(`Projects materialized: ${projectIds.length}`);
  console.log(`Bindings rewritten: ${bindings.length}`);
};

await main();
