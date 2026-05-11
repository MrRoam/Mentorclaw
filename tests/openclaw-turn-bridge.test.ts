import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeAgentConfig } from "../src/integration/openclaw-turn-bridge.ts";

describe("normalizeAgentConfig", () => {
  test("rewrites the workspace into the active runtime root while preserving an external auth-backed agentDir", () => {
    const input = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "/home/jiaxu/.openclaw-educlaw/workspace",
            agentDir: "/home/jiaxu/.openclaw-educlaw/agents/main/agent",
          },
        ],
      },
    };

    const result = normalizeAgentConfig(input, "/mnt/c/Users/MrRoam/.openclaw-educlaw");
    assert.equal(result.changed, true);
    assert.deepEqual(result.normalized, {
      agents: {
        list: [
          {
            id: "main",
            workspace: "/mnt/c/Users/MrRoam/.openclaw-educlaw/workspace",
            agentDir: "/home/jiaxu/.openclaw-educlaw/agents/main/agent",
          },
        ],
      },
    });
  });

  test("rewrites agentDir too when the active runtime has its own auth store", () => {
    const input = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "/home/jiaxu/.openclaw-educlaw/workspace",
            agentDir: "/home/jiaxu/.openclaw-educlaw/agents/main/agent",
          },
        ],
      },
    };

    const result = normalizeAgentConfig(input, "/mnt/c/Users/MrRoam/.openclaw-educlaw", {
      runtimeScopedAgentIds: new Set(["main"]),
    });
    assert.equal(result.changed, true);
    assert.deepEqual(result.normalized, {
      agents: {
        list: [
          {
            id: "main",
            workspace: "/mnt/c/Users/MrRoam/.openclaw-educlaw/workspace",
            agentDir: "/mnt/c/Users/MrRoam/.openclaw-educlaw/agents/main/agent",
          },
        ],
      },
    });
  });

  test("keeps the original config when agent paths already match the runtime", () => {
    const input = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "/mnt/c/Users/MrRoam/.openclaw-educlaw/workspace",
            agentDir: "/mnt/c/Users/MrRoam/.openclaw-educlaw/agents/main/agent",
          },
        ],
      },
      hooks: {
        internal: {
          enabled: true,
        },
      },
    };

    const result = normalizeAgentConfig(input, "/mnt/c/Users/MrRoam/.openclaw-educlaw");
    assert.equal(result.changed, false);
    assert.equal(result.normalized, input);
  });
});
