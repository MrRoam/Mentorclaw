import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LearningEvent, TurnOutcome } from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { nowIso } from "../utils/time.ts";

export interface EduclawSessionBinding {
  sessionKey: string;
  planId: string;
  threadId: string;
  updatedAt: string;
  lastWorkflow: string;
}

interface BindingStoreShape {
  version: number;
  bindings: Record<string, EduclawSessionBinding>;
}

const defaultStore = (): BindingStoreShape => ({
  version: 1,
  bindings: {},
});

export const resolveRuntimeRootFromWorkspace = (workspaceDir?: string, configuredRuntimeRoot?: string): string => {
  if (configuredRuntimeRoot) return configuredRuntimeRoot;
  if (!workspaceDir) {
    throw new Error("Cannot resolve Educlaw runtime root without workspaceDir or configured runtimeRoot.");
  }
  return path.dirname(workspaceDir);
};

export class SessionBindingStore {
  private readonly filePath: string;

  constructor(workspaceDir: string) {
    this.filePath = path.join(workspaceDir, ".openclaw", "educlaw-session-bindings.json");
  }

  async get(sessionKey?: string): Promise<EduclawSessionBinding | null> {
    if (!sessionKey) return null;
    const store = await this.readStore();
    return store.bindings[sessionKey] ?? null;
  }

  async set(binding: EduclawSessionBinding): Promise<void> {
    const store = await this.readStore();
    store.bindings[binding.sessionKey] = binding;
    await this.writeStore(store);
  }

  private async readStore(): Promise<BindingStoreShape> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BindingStoreShape>;
      return {
        version: parsed.version ?? 1,
        bindings: parsed.bindings ?? {},
      };
    } catch {
      return defaultStore();
    }
  }

  private async writeStore(store: BindingStoreShape): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

const toBulletList = (title: string, items: string[]): string =>
  items.length ? `## ${title}\n- ${items.join("\n- ")}` : "";

export const renderPromptContext = (outcome: TurnOutcome): string => {
  const sections = [
    "# Educlaw Kernel Context",
    "",
    `Primary workflow: ${outcome.decision.primary}`,
    ...(outcome.decision.secondary ? [`Secondary workflow: ${outcome.decision.secondary}`] : []),
    "",
    toBulletList("Why This Workflow", outcome.decision.reasons),
    "",
    toBulletList("Learner State", outcome.context.learnerSummary),
    "",
    toBulletList("Plan State", outcome.context.planSummary),
    "",
    toBulletList("Thread State", outcome.context.threadSummary),
    "",
    toBulletList("Resource State", outcome.context.resourceSummary),
    "",
    toBulletList(
      "Proactive Actions",
      outcome.proactiveActions.map((action) => `${action.kind}: ${action.reason}`),
    ),
  ].filter(Boolean);

  return sections.join("\n");
};

export const EDUCLAW_STATIC_SYSTEM_APPEND = [
  "You are operating with the Educlaw education kernel.",
  "Treat the injected kernel context as the current source of truth for workflow, learner state, plan state, and thread state.",
  "Do not invent plan ids, thread ids, or memory updates that are not present in the injected kernel context.",
  "When the workflow is planning, optimize for clarifying goals, constraints, deadlines, and next executable tasks.",
  "When the workflow is evaluation or review, ground judgments in evidence and be conservative about mastery claims.",
].join("\n");

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content && typeof content.text === "string") {
    return content.text;
  }
  return "";
};

export const extractLastAssistantText = (messages: unknown[]): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || typeof entry !== "object") continue;

    const directRole = "role" in entry ? entry.role : undefined;
    const directContent = "content" in entry ? entry.content : undefined;
    if (directRole === "assistant") {
      const text = extractTextFromContent(directContent);
      if (text) return text;
    }

    if ("message" in entry && entry.message && typeof entry.message === "object") {
      const nested = entry.message as { role?: unknown; content?: unknown };
      if (nested.role === "assistant") {
        const text = extractTextFromContent(nested.content);
        if (text) return text;
      }
    }
  }
  return null;
};

export const recordAgentEnd = async (repo: WorkspaceRepo, binding: EduclawSessionBinding | null, event: { success: boolean; error?: string; messages: unknown[]; durationMs?: number }): Promise<void> => {
  if (!binding) return;

  const lastAssistantText = extractLastAssistantText(event.messages);
  const ts = nowIso();
  const learningEvent: LearningEvent = {
    ts,
    level: "thread",
    type: event.success ? "assistant_reply_recorded" : "assistant_reply_failed",
    planId: binding.planId,
    threadId: binding.threadId,
    evidence: lastAssistantText ? [lastAssistantText] : [event.error ?? "No assistant reply text captured."],
    impact: event.success ? "Assistant reply completed and was recorded." : `Assistant run failed: ${event.error ?? "unknown error"}`,
    promotion: "thread",
    metadata: {
      durationMs: event.durationMs,
    },
  };

  await repo.appendThreadEvent(binding.planId, binding.threadId, learningEvent);

  const thread = await repo.readThreadState(binding.planId, binding.threadId);
  thread.updatedAt = ts;
  if (lastAssistantText) {
    thread.summary = `${thread.summary}\nAssistant reply captured.`.trim();
    thread.workingMemory = [...thread.workingMemory, `Assistant reply: ${lastAssistantText}`].slice(-12);
  }
  await repo.writeThreadState(thread);
};
