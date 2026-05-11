import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const windowsWslCandidates = (): string[] => {
  if (process.platform === "win32") {
    return [];
  }

  const usersRoot = "/mnt/c/Users";
  if (!existsSync(usersRoot)) {
    return [];
  }

  try {
    return readdirSync(usersRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !["All Users", "Default", "Default User", "Public"].includes(name))
      .flatMap((name) => [
        path.join(usersRoot, name, ".openclaw-educlaw"),
        path.join(usersRoot, name, ".openclaw-mentorclaw"),
        path.join(usersRoot, name, ".mentorclaw"),
      ]);
  } catch {
    return [];
  }
};

const defaultCandidates = (): string[] => [
  path.join(os.homedir(), ".mentorclaw"),
  path.join(os.homedir(), ".openclaw-mentorclaw"),
  path.join(os.homedir(), ".openclaw-educlaw"),
  ...windowsWslCandidates(),
];

const requiredRuntimeFiles = (runtimeRoot: string): string[] => [
  path.join(runtimeRoot, "workspace", "AGENTS.md"),
  path.join(runtimeRoot, "workspace", "SOUL.md"),
  path.join(runtimeRoot, "workspace", "TOOLS.md"),
];

const hasNewShape = (runtimeRoot: string): boolean =>
  existsSync(path.join(runtimeRoot, "workspace", "MEMORY.md")) &&
  existsSync(path.join(runtimeRoot, "workspace", "projects"));

const hasLegacyShape = (runtimeRoot: string): boolean =>
  existsSync(path.join(runtimeRoot, "workspace", "agent", "learner", "LEARNER_STATE.yaml")) &&
  existsSync(path.join(runtimeRoot, "workspace", "agent", "plans"));

const isValidRuntimeRoot = (runtimeRoot: string): boolean =>
  requiredRuntimeFiles(runtimeRoot).every((filePath) => existsSync(filePath)) && (hasNewShape(runtimeRoot) || hasLegacyShape(runtimeRoot));

export const resolveMentorclawRuntimeRoot = (explicitRuntimeRoot?: string): string => {
  if (explicitRuntimeRoot?.trim()) {
    return explicitRuntimeRoot;
  }

  const configured = process.env.mentorclaw_RUNTIME_ROOT?.trim();
  if (configured) {
    return configured;
  }

  const validCandidate = defaultCandidates().find((candidate) => isValidRuntimeRoot(candidate));
  if (validCandidate) {
    return validCandidate;
  }

  const existingCandidate = defaultCandidates().find((candidate) => existsSync(candidate));
  if (existingCandidate) {
    return existingCandidate;
  }

  return defaultCandidates()[0];
};
