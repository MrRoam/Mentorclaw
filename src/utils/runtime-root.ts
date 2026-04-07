import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultCandidates = (): string[] => [
  path.join(os.homedir(), ".mentorclaw"),
  path.join(os.homedir(), ".openclaw-mentorclaw"),
  path.join(os.homedir(), ".openclaw-educlaw"),
];

const requiredRuntimeFiles = (runtimeRoot: string): string[] => [
  path.join(runtimeRoot, "workspace", "AGENTS.md"),
  path.join(runtimeRoot, "workspace", "agent", "learner", "PROFILE.md"),
  path.join(runtimeRoot, "workspace", "agent", "learner", "LEARNER_STATE.yaml"),
  path.join(runtimeRoot, "workspace", "agent", "plans", "INDEX.yaml"),
];

const isValidRuntimeRoot = (runtimeRoot: string): boolean =>
  requiredRuntimeFiles(runtimeRoot).every((filePath) => existsSync(filePath));

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
