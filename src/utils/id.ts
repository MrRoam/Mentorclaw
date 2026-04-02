const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";

export const makePlanId = (title: string, now: string): string => `${slugify(title)}-${now.slice(0, 10)}`;

export const makeThreadId = (title: string, now: string): string => `${slugify(title)}-${now.replace(/[:.]/g, "-")}`;

export const makeTaskId = (title: string, index: number): string => `${slugify(title)}-${String(index + 1).padStart(2, "0")}`;

export const makeMilestoneId = (title: string, index: number): string =>
  `milestone-${String(index + 1).padStart(2, "0")}-${slugify(title)}`;
