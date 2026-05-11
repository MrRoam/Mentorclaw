import { readFile } from "node:fs/promises";
import { firstArg, parseCliArgs } from "./_education-cli.ts";
import { syncBuaaByxt } from "../src/education/providers/buaa/byxt.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv.slice(2));
  const runtimeRoot = resolveMentorclawRuntimeRoot(firstArg(parsed, "runtime-root") ?? undefined);
  const repo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();

  const cookieFile = firstArg(parsed, "cookie-file");
  const cookie = cookieFile ? await readFile(cookieFile, "utf8") : firstArg(parsed, "cookie");
  const result = await syncBuaaByxt(repo, {
    auth: {
      username: firstArg(parsed, "username"),
      password: firstArg(parsed, "password"),
      cookie,
      accountLabel: firstArg(parsed, "account-label"),
    },
    termCode: firstArg(parsed, "term-code"),
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
