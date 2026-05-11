import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LearningEvent, TurnInput, TurnOutcome } from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { nowIso } from "../utils/time.ts";

export interface mentorclawSessionBinding {
  sessionKey: string;
  projectId: string;
  planId?: string;
  threadId?: string;
  updatedAt: string;
  lastWorkflow: string;
  pendingSignals?: TurnInput["signals"];
}

interface BindingStoreShape {
  version: number;
  bindings: Record<string, mentorclawSessionBinding>;
}

const defaultStore = (): BindingStoreShape => ({
  version: 2,
  bindings: {},
});

export const resolveRuntimeRootFromWorkspace = (workspaceDir?: string, configuredRuntimeRoot?: string): string => {
  if (configuredRuntimeRoot) return configuredRuntimeRoot;
  if (!workspaceDir) {
    throw new Error("Cannot resolve mentorclaw runtime root without workspaceDir or configured runtimeRoot.");
  }
  return path.dirname(workspaceDir);
};

export class SessionBindingStore {
  private readonly filePath: string;

  constructor(workspaceDir: string) {
    this.filePath = path.join(workspaceDir, ".openclaw", "mentorclaw-session-bindings.json");
  }

  async get(sessionKey?: string): Promise<mentorclawSessionBinding | null> {
    if (!sessionKey) return null;
    const store = await this.readStore();
    return store.bindings[sessionKey] ?? null;
  }

  async set(binding: mentorclawSessionBinding): Promise<void> {
    const store = await this.readStore();
    store.bindings[binding.sessionKey] = {
      ...binding,
      planId: binding.planId ?? binding.projectId,
      threadId: binding.threadId ?? `thread-${binding.projectId}`,
    };
    await this.writeStore(store);
  }

  async list(): Promise<mentorclawSessionBinding[]> {
    const store = await this.readStore();
    return Object.values(store.bindings).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async remove(sessionKey: string): Promise<void> {
    const store = await this.readStore();
    delete store.bindings[sessionKey];
    await this.writeStore(store);
  }

  private async readStore(): Promise<BindingStoreShape> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        version?: number;
        bindings?: Record<string, Partial<mentorclawSessionBinding> & { planId?: string }>;
      };

      const bindings: Record<string, mentorclawSessionBinding> = {};
      for (const [sessionKey, entry] of Object.entries(parsed.bindings ?? {})) {
        const projectId = typeof entry.projectId === "string" && entry.projectId.trim() ? entry.projectId : entry.planId?.trim();
        if (!projectId) continue;
        bindings[sessionKey] = {
          sessionKey,
          projectId,
          planId: typeof entry.planId === "string" && entry.planId.trim() ? entry.planId : projectId,
          threadId: typeof entry.threadId === "string" && entry.threadId.trim() ? entry.threadId : `thread-${projectId}`,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : nowIso(),
          lastWorkflow: typeof entry.lastWorkflow === "string" ? entry.lastWorkflow : "tutoring",
          pendingSignals: entry.pendingSignals,
        };
      }

      return {
        version: parsed.version ?? 2,
        bindings,
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

const renderSection = (title: string, lines: string[]): string =>
  lines.length ? `## ${title}\n- ${lines.join("\n- ")}` : "";

export const renderPromptContext = (outcome: TurnOutcome): string => {
  const sections = [
    "# mentorclaw Context",
    "",
    renderSection("Current Turn", outcome.context.projectSummary),
    "",
    renderSection("Course Context", outcome.context.resourceSummary),
    "",
    renderSection("Locators", outcome.context.locatorSummary),
    "",
    renderSection("Durable Learner Context", outcome.context.memorySummary),
    "",
    renderSection("Read Set", outcome.context.readSet),
  ].filter(Boolean);

  return sections.join("\n");
};

export const mentorclaw_STATIC_SYSTEM_APPEND = [
  "You are operating inside mentorclaw, a campus-platform-focused learning agent.",
  "Use the current project and the durable learner memory when they are relevant.",
  "Do not invent project ids, course bindings, or resource facts that were not provided.",
  "If the current turn is project setup, clarify scope, course, deadline, and the next concrete action.",
  "If the current turn is a review, stay evidence-based and conservative about mastery claims.",
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

export const recordAgentEnd = async (
  repo: WorkspaceRepo,
  binding: mentorclawSessionBinding | null,
  event: { success: boolean; error?: string; messages: unknown[]; durationMs?: number },
): Promise<void> => {
  if (!binding?.projectId) return;

  const lastAssistantText = extractLastAssistantText(event.messages);
  const ts = nowIso();
  const learningEvent: LearningEvent = {
    ts,
    level: "project",
    type: event.success ? "assistant_reply_recorded" : "assistant_reply_failed",
    projectId: binding.projectId,
    planId: binding.projectId,
    evidence: lastAssistantText ? [lastAssistantText] : [event.error ?? "No assistant reply text captured."],
    impact: event.success ? "Assistant reply completed and was recorded." : `Assistant run failed: ${event.error ?? "unknown error"}`,
    promotion: "project",
    metadata: {
      durationMs: event.durationMs,
    },
  };

  await repo.appendProjectEvent(binding.projectId, learningEvent);
  if (binding.threadId) {
    await repo.appendThreadEvent(binding.projectId, binding.threadId, {
      ...learningEvent,
      level: "thread",
      threadId: binding.threadId,
      promotion: "thread",
    });
  }
};
