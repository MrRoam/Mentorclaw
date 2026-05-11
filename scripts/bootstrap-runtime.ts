import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const runtimeRoot = resolveMentorclawRuntimeRoot();
const workspaceTemplateRoot = path.join(import.meta.dirname, "..", "templates", "runtime", "workspace");
const templateFiles = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "MEMORY.md",
];

const writeIfMissing = async (filePath: string, content: string): Promise<void> => {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, content, "utf8");
  }
};

const main = async (): Promise<void> => {
  const repo = new WorkspaceRepo(runtimeRoot);
  const educationRepo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();
  await educationRepo.ensureScaffold();

  const plansDir = path.join(repo.paths.workspaceRoot, "projects");
  const cronsDir = path.join(repo.paths.workspaceRoot, "crons");

  for (const relativePath of templateFiles) {
    const template = await readFile(path.join(workspaceTemplateRoot, relativePath), "utf8");
    await writeIfMissing(path.join(repo.paths.workspaceRoot, relativePath), template);
  }

  await writeIfMissing(
    path.join(plansDir, "README.md"),
    "# Projects\n\nEach project is a single YAML state file plus an append-only JSONL event log.\n",
  );
  await writeIfMissing(
    path.join(cronsDir, "README.md"),
    "# Crons\n\nStore cron definitions that target a course scope or a project.\n",
  );

  console.log(`Bootstrapped runtime scaffold at ${runtimeRoot}`);
  console.log(`Education storage scaffolded at ${educationRepo.educationDir}`);
};

await main();
