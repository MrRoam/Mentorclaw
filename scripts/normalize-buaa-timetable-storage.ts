import { EducationRepo } from "../src/storage/education-repo.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";
import { firstArg, parseCliArgs } from "./_education-cli.ts";
import { normalizeCourseHint } from "../src/education/providers/buaa/shared.ts";

const stripPresenterLabel = (value: string | null | undefined): string => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .replace(/[\[（(【]\s*主讲\s*[\]）)】]/g, " ")
    .replace(/\b主讲\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv.slice(2));
  const runtimeRoot = resolveMentorclawRuntimeRoot(firstArg(parsed, "runtime-root") ?? undefined);
  const repo = new EducationRepo(runtimeRoot);
  await repo.ensureScaffold();

  const [courses, items] = await Promise.all([repo.readCourses(), repo.readCourseItems()]);

  const normalizedCourses = courses.map((course) => {
    if (course.sourceType !== "buaa-byxt") return course;
    const teacher = stripPresenterLabel(course.teacher);
    const metadata = { ...(course.metadata || {}) };
    const stableKeyHints = Array.isArray(metadata.stableKeyHints)
      ? metadata.stableKeyHints
          .filter((value): value is string => typeof value === "string" && value.trim())
          .map((value) => stripPresenterLabel(value))
      : [];
    return {
      ...course,
      teacher,
      metadata: {
        ...metadata,
        stableKeyHints: [normalizeCourseHint(course.title, teacher), ...stableKeyHints]
          .filter(Boolean)
          .filter((value, index, array) => array.indexOf(value) === index),
      },
    };
  });

  const normalizedItems = items.map((item) => {
    if (item.type !== "class") return item;
    const teacher = stripPresenterLabel(item.teacher);
    const weeksAndTeachers = item.metaJson?.weeksAndTeachers;
    return {
      ...item,
      teacher,
      metaJson: {
        ...(item.metaJson || {}),
        weeksAndTeachers: typeof weeksAndTeachers === "string" ? stripPresenterLabel(weeksAndTeachers) : weeksAndTeachers,
      },
    };
  });

  await Promise.all([repo.writeCourses(normalizedCourses), repo.writeCourseItems(normalizedItems)]);

  console.log(
    JSON.stringify(
      {
        runtimeRoot,
        normalizedCourses: normalizedCourses.filter((course, index) => course.teacher !== courses[index]?.teacher).length,
        normalizedCourseItems: normalizedItems.filter((item, index) => item.teacher !== items[index]?.teacher).length,
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
