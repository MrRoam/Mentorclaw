import { firstArg, parseCliArgs } from "./_education-cli.ts";
import { syncCourseItems, syncCourseResources, syncCourses } from "../src/education/sync.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv.slice(2));
  const connectionId = firstArg(parsed, "connection-id");
  if (!connectionId) {
    throw new Error("Missing required --connection-id <id> argument.");
  }

  const runtimeRoot = resolveMentorclawRuntimeRoot(firstArg(parsed, "runtime-root") ?? undefined);
  const repo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();

  const mode = firstArg(parsed, "mode") ?? "all";
  const result =
    mode === "courses"
      ? await syncCourses(repo, connectionId)
      : mode === "items"
        ? await syncCourseItems(repo, connectionId)
        : mode === "resources"
          ? await syncCourseResources(repo, connectionId, firstArg(parsed, "course-id"))
          : await syncCourses(repo, connectionId);

  console.log(
    JSON.stringify(
      {
        runtimeRoot,
        connectionId,
        mode,
        ...result,
      },
      null,
      2,
    ),
  );
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
