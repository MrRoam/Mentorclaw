import { readFile } from "node:fs/promises";
import { manyArgs, firstArg, parseCliArgs } from "./_education-cli.ts";
import { syncBuaaMsa } from "../src/education/providers/buaa/msa.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const collectCourseIds = (parsed: ReturnType<typeof parseCliArgs>): string[] => {
  const repeated = manyArgs(parsed, "course-id");
  const csv = (firstArg(parsed, "course-ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...repeated, ...csv]));
};

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv.slice(2));
  const runtimeRoot = resolveMentorclawRuntimeRoot(firstArg(parsed, "runtime-root") ?? undefined);
  const repo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();

  const cookieFile = firstArg(parsed, "cookie-file");
  const cookie = cookieFile ? await readFile(cookieFile, "utf8") : firstArg(parsed, "cookie");
  const result = await syncBuaaMsa(repo, {
    auth: {
      username: firstArg(parsed, "username"),
      password: firstArg(parsed, "password"),
      token: firstArg(parsed, "token"),
      account: firstArg(parsed, "account"),
      cookie,
      accountLabel: firstArg(parsed, "account-label"),
    },
    courseIds: collectCourseIds(parsed),
    term: firstArg(parsed, "term"),
  });

  console.log(
    JSON.stringify(
      {
        runtimeRoot,
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
