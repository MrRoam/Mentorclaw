import { readFile } from "node:fs/promises";
import path from "node:path";
import { importEducationDocument, type EducationImportDocument } from "../src/education/importer.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const parseArgs = (
  argv: string[],
): {
  input: string;
  runtimeRoot: string;
} => {
  const defaults = {
    input: "",
    runtimeRoot: resolveMentorclawRuntimeRoot(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--input" && argv[index + 1]) defaults.input = argv[index + 1];
    if (current === "--runtime-root" && argv[index + 1]) defaults.runtimeRoot = argv[index + 1];
  }

  if (!defaults.input) {
    throw new Error("Missing --input <file>.");
  }

  return defaults;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(options.input);
  const raw = await readFile(inputPath, "utf8");
  const document = JSON.parse(raw) as EducationImportDocument;
  const repo = new EducationRepo(options.runtimeRoot);
  const result = await importEducationDocument(repo, document);

  console.log(JSON.stringify({
    runtimeRoot: options.runtimeRoot,
    inputPath,
    ...result,
  }, null, 2));
};

await main();
