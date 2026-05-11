import { readFile } from "node:fs/promises";
import { firstArg, parseCliArgs } from "./_education-cli.ts";
import { importBuaaLivingroomCapture } from "../src/education/providers/buaa/msa.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv.slice(2));
  const inputPath = firstArg(parsed, "input");
  if (!inputPath) {
    throw new Error("Missing required --input <file> argument.");
  }

  const runtimeRoot = resolveMentorclawRuntimeRoot(firstArg(parsed, "runtime-root") ?? undefined);
  const repo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();

  const payload = JSON.parse(await readFile(inputPath, "utf8")) as {
    courseId?: string;
    replaySourceId?: string;
    replayTitle?: string;
    courseTitle?: string;
    teacher?: string;
    term?: string;
    subtitleData?: unknown[];
    pptData?: unknown[];
  };

  if (!payload.courseId?.trim() || !payload.replaySourceId?.trim() || !payload.replayTitle?.trim()) {
    throw new Error("Livingroom capture JSON must include courseId, replaySourceId, and replayTitle.");
  }

  const result = await importBuaaLivingroomCapture(repo, {
    courseId: payload.courseId,
    replaySourceId: payload.replaySourceId,
    replayTitle: payload.replayTitle,
    courseTitle: payload.courseTitle,
    teacher: payload.teacher,
    term: payload.term,
    subtitleData: payload.subtitleData,
    pptData: payload.pptData,
  });

  console.log(
    JSON.stringify(
      {
        runtimeRoot,
        inputPath,
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
