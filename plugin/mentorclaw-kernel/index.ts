import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { mentorclawOrchestrator } from "../../src/core/orchestrator.ts";
import {
  mentorclaw_STATIC_SYSTEM_APPEND,
  SessionBindingStore,
  recordAgentEnd,
  renderPromptContext,
  resolveRuntimeRootFromWorkspace,
} from "../../src/integration/openclaw-adapter.ts";
import { WorkspaceRepo } from "../../src/storage/workspace-repo.ts";
import { nowIso } from "../../src/utils/time.ts";

type PluginConfig = {
  runtimeRoot?: string;
};

const plugin = definePluginEntry({
  id: "mentorclaw-kernel",
  name: "mentorclaw Kernel",
  description: "Injects mentorclaw dynamic planning context and writes turn state back into the mentorclaw runtime instance.",
  register(api: OpenClawPluginApi) {
    const logger = api.logger;
    const pluginConfig = (api.pluginConfig ?? {}) as PluginConfig;

    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        if (ctx.trigger && ctx.trigger !== "user") {
          return;
        }

        try {
          const runtimeRoot = resolveRuntimeRootFromWorkspace(ctx.workspaceDir, pluginConfig.runtimeRoot);
          const repo = new WorkspaceRepo(runtimeRoot);
          const orchestrator = new mentorclawOrchestrator(repo);
          const bindingStore = ctx.workspaceDir ? new SessionBindingStore(ctx.workspaceDir) : null;
          const binding = bindingStore ? await bindingStore.get(ctx.sessionKey) : null;

          const outcome = await orchestrator.handleTurn({
            message: event.prompt,
            now: nowIso(),
            planId: binding?.planId,
            threadId: binding?.threadId,
          });

          if (bindingStore && ctx.sessionKey && outcome.plan && outcome.thread) {
            await bindingStore.set({
              sessionKey: ctx.sessionKey,
              planId: outcome.plan.planId,
              threadId: outcome.thread.threadId,
              updatedAt: nowIso(),
              lastWorkflow: outcome.decision.primary,
            });
          }

          return {
            // Keep dynamic mentorclaw state in system-prompt space so the model still
            // receives workflow/plan/thread context without rewriting the user's
            // visible message body.
            prependSystemContext: renderPromptContext(outcome),
            appendSystemContext: mentorclaw_STATIC_SYSTEM_APPEND,
          };
        } catch (error) {
          logger.warn(`mentorclaw-kernel before_prompt_build failed: ${String(error)}`);
          return {
            prependSystemContext: "mentorclaw kernel warning: dynamic planning context was unavailable for this turn.",
            appendSystemContext: mentorclaw_STATIC_SYSTEM_APPEND,
          };
        }
      },
      { priority: 25 },
    );

    api.on(
      "agent_end",
      async (event, ctx) => {
        if (!ctx.workspaceDir || (ctx.trigger && ctx.trigger !== "user")) {
          return;
        }

        try {
          const runtimeRoot = resolveRuntimeRootFromWorkspace(ctx.workspaceDir, pluginConfig.runtimeRoot);
          const repo = new WorkspaceRepo(runtimeRoot);
          const bindingStore = new SessionBindingStore(ctx.workspaceDir);
          const binding = await bindingStore.get(ctx.sessionKey);
          await recordAgentEnd(repo, binding, event);
        } catch (error) {
          logger.warn(`mentorclaw-kernel agent_end failed: ${String(error)}`);
        }
      },
      { priority: 25 },
    );
  },
});

export default plugin;
