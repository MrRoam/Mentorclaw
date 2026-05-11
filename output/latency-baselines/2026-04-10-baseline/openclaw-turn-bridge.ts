import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXPLICIT_SESSION_KEY_PATTERN = /^agent:([^:]+):explicit:(.+)$/;
const OPENCLAW_JSON = "openclaw.json";
const OPENCLAW_BRIDGE_JSON = "openclaw.debug-ui.json";
const AUTH_PROFILES_JSON = "auth-profiles.json";
const MAX_STDIO_BUFFER = 10 * 1024 * 1024;

export interface OpenClawSessionHandle {
  agentId: string;
  sessionId: string;
  sessionKey: string;
}

export interface OpenClawTurnRequest {
  runtimeRoot: string;
  sessionRef: string;
  message: string;
  timeoutSeconds?: number;
}

export interface OpenClawTurnResult {
  assistantReply: string;
  sessionId: string;
  sessionKey: string;
  agentId: string;
  durationMs: number | null;
  stopReason: string | null;
  workspaceDir: string | null;
  raw: unknown;
}

export interface OpenClawTurnBridgeLike {
  resolveSessionHandle(runtimeRoot: string, sessionRef: string): Promise<OpenClawSessionHandle>;
  runTurn(request: OpenClawTurnRequest): Promise<OpenClawTurnResult>;
}

interface ExecTarget {
  command: string;
  args: string[];
  linuxRuntimeRoot: string;
}

const shellScript = [
  "set -euo pipefail",
  'export OPENCLAW_STATE_DIR="$MENTORCLAW_RUNTIME_ROOT"',
  'export OPENCLAW_CONFIG_PATH="$MENTORCLAW_CONFIG_PATH"',
  'message="$(printf %s "$MENTORCLAW_MESSAGE_B64" | base64 -d)"',
  "run_openclaw() {",
  '  "$@" agent --local --session-id "$MENTORCLAW_SESSION_ID" --message "$message" --timeout "$MENTORCLAW_TIMEOUT_SECONDS" --json',
  "}",
  "if command -v openclaw >/dev/null 2>&1; then",
  "  run_openclaw openclaw",
  "  exit $?",
  "fi",
  'if [ -f "$HOME/.nvm/nvm.sh" ]; then',
  '  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true',
  "fi",
  "if command -v openclaw >/dev/null 2>&1; then",
  "  run_openclaw openclaw",
  "  exit $?",
  "fi",
  'node_bin="$(ls -1d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -n 1 || true)"',
  'cli_entry="$(ls -1d "$HOME"/.nvm/versions/node/*/lib/node_modules/openclaw/dist/index.js 2>/dev/null | tail -n 1 || true)"',
  'if [ -n "$node_bin" ] && [ -n "$cli_entry" ]; then',
  '  run_openclaw "$node_bin" "$cli_entry"',
  "  exit $?",
  "fi",
  'echo "OpenClaw CLI could not be located in PATH or ~/.nvm." >&2',
  "exit 1",
].join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";

const readString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

const readNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const deepGet = (value: unknown, pathParts: string[]): unknown => {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
};

const extractReplyTexts = (value: unknown): string[] => {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractReplyTexts(entry));
  }

  if (!isRecord(value)) return [];

  return [
    ...extractReplyTexts(value.text),
    ...extractReplyTexts(value.content),
    ...extractReplyTexts(value.caption),
    ...extractReplyTexts(value.message),
  ];
};

const extractAssistantReply = (payload: unknown): string | null => {
  const payloads = Array.isArray(deepGet(payload, ["payloads"])) ? (deepGet(payload, ["payloads"]) as unknown[]) : [];
  const payloadTexts = payloads.flatMap((entry) => extractReplyTexts(entry));
  if (payloadTexts.length) {
    return payloadTexts.join("\n\n");
  }

  const fallbacks = [
    deepGet(payload, ["reply"]),
    deepGet(payload, ["message"]),
    deepGet(payload, ["content"]),
  ];
  for (const candidate of fallbacks) {
    const text = extractReplyTexts(candidate).join("\n\n");
    if (text) return text;
  }

  return null;
};

const parseJsonEnvelope = (raw: string): unknown | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  let cursor = trimmed.indexOf("{");
  while (cursor >= 0) {
    try {
      return JSON.parse(trimmed.slice(cursor));
    } catch {
      cursor = trimmed.indexOf("{", cursor + 1);
    }
  }

  return null;
};

const parseWslUncPath = (value: string): { distro: string; linuxPath: string } | null => {
  const normalized = value.replace(/\//g, "\\");
  const match = normalized.match(/^\\\\(?:wsl(?:\.localhost)?|wsl\$)\\([^\\]+)\\(.+)$/i);
  if (!match) return null;
  const [, distro, rest] = match;
  return {
    distro,
    linuxPath: `/${rest.replace(/\\/g, "/").replace(/^\/+/, "")}`,
  };
};

const resolveExecTarget = (runtimeRoot: string): ExecTarget => {
  if (process.platform === "win32") {
    const unc = parseWslUncPath(runtimeRoot);
    if (!unc) {
      throw new Error(`Windows-hosted debug-ui requires a WSL runtime root. Received: ${runtimeRoot}`);
    }
    return {
      command: "wsl.exe",
      args: ["-d", unc.distro, "bash", "-lc", shellScript],
      linuxRuntimeRoot: unc.linuxPath,
    };
  }

  if (!runtimeRoot.startsWith("/")) {
    throw new Error(`POSIX-hosted debug-ui requires a Linux runtime root. Received: ${runtimeRoot}`);
  }

  return {
    command: "bash",
    args: ["-lc", shellScript],
    linuxRuntimeRoot: runtimeRoot,
  };
};

const parseDefaultAgentId = async (runtimeRoot: string): Promise<string> => {
  try {
    const raw = await readFile(path.join(runtimeRoot, OPENCLAW_JSON), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: {
        list?: Array<{ id?: unknown }>;
      };
    };
    const first = parsed.agents?.list?.find((entry) => typeof entry?.id === "string");
    return typeof first?.id === "string" && first.id.trim() ? first.id : "main";
  } catch {
    return "main";
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizeAgentConfig = (
  config: unknown,
  linuxRuntimeRoot: string,
  options?: {
    runtimeScopedAgentIds?: Set<string>;
  },
): { normalized: unknown; changed: boolean } => {
  if (!isRecord(config)) {
    return { normalized: config, changed: false };
  }

  const agents = config.agents;
  if (!isRecord(agents) || !Array.isArray(agents.list)) {
    return { normalized: config, changed: false };
  }

  let changed = false;
  const normalizedList = agents.list.map((entry) => {
    if (!isRecord(entry)) return entry;
    const agentId = readString(entry.id);
    if (!agentId) return entry;

    const expectedWorkspace = path.posix.join(linuxRuntimeRoot, "workspace");
    const runtimeScopedAgentIds = options?.runtimeScopedAgentIds ?? new Set<string>();
    const fallbackAgentDir = readString(entry.agentDir);
    const expectedAgentDir =
      runtimeScopedAgentIds.has(agentId) || !fallbackAgentDir
        ? path.posix.join(linuxRuntimeRoot, "agents", agentId, "agent")
        : fallbackAgentDir;
    const next = {
      ...entry,
      workspace: expectedWorkspace,
      agentDir: expectedAgentDir,
    };

    if (entry.workspace !== expectedWorkspace || entry.agentDir !== expectedAgentDir) {
      changed = true;
    }

    return next;
  });

  if (!changed) {
    return { normalized: config, changed: false };
  }

  return {
    normalized: {
      ...config,
      agents: {
        ...agents,
        list: normalizedList,
      },
    },
    changed: true,
  };
};

const resolveConfigPath = async (runtimeRoot: string, linuxRuntimeRoot: string): Promise<string> => {
  const originalPath = path.join(runtimeRoot, OPENCLAW_JSON);
  const originalLinuxPath = path.posix.join(linuxRuntimeRoot, OPENCLAW_JSON);

  try {
    const raw = await readFile(originalPath, "utf8");
    const parsed = JSON.parse(raw);
    const runtimeScopedAgentIds = new Set<string>();
    if (isRecord(parsed) && isRecord(parsed.agents) && Array.isArray(parsed.agents.list)) {
      await Promise.all(
        parsed.agents.list.map(async (entry) => {
          if (!isRecord(entry)) return;
          const agentId = readString(entry.id);
          if (!agentId) return;
          const authPath = path.join(runtimeRoot, "agents", agentId, "agent", AUTH_PROFILES_JSON);
          if (await fileExists(authPath)) runtimeScopedAgentIds.add(agentId);
        }),
      );
    }

    const { normalized, changed } = normalizeAgentConfig(parsed, linuxRuntimeRoot, { runtimeScopedAgentIds });
    if (!changed) {
      return originalLinuxPath;
    }

    const bridgePath = path.join(runtimeRoot, OPENCLAW_BRIDGE_JSON);
    await writeFile(bridgePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return path.posix.join(linuxRuntimeRoot, OPENCLAW_BRIDGE_JSON);
  } catch {
    return originalLinuxPath;
  }
};

export class OpenClawTurnBridge implements OpenClawTurnBridgeLike {
  private readonly agentIdCache = new Map<string, Promise<string>>();

  async resolveSessionHandle(runtimeRoot: string, sessionRef: string): Promise<OpenClawSessionHandle> {
    const trimmed = sessionRef.trim();
    if (!trimmed) {
      throw new Error("OpenClaw session reference is required.");
    }

    const explicitMatch = trimmed.match(EXPLICIT_SESSION_KEY_PATTERN);
    if (explicitMatch) {
      const [, agentId, sessionId] = explicitMatch;
      return {
        agentId,
        sessionId,
        sessionKey: trimmed,
      };
    }

    const agentId = await this.resolveDefaultAgentId(runtimeRoot);
    return {
      agentId,
      sessionId: trimmed,
      sessionKey: `agent:${agentId}:explicit:${trimmed}`,
    };
  }

  async runTurn(request: OpenClawTurnRequest): Promise<OpenClawTurnResult> {
    const session = await this.resolveSessionHandle(request.runtimeRoot, request.sessionRef);
    const target = resolveExecTarget(request.runtimeRoot);
    const configPath = await resolveConfigPath(request.runtimeRoot, target.linuxRuntimeRoot);
    const timeoutSeconds = Math.max(30, request.timeoutSeconds ?? 600);

    let stdout = "";
    let stderr = "";
    let failureMessage = "";
    try {
      const result = await execFileAsync(target.command, target.args, {
        env: {
          ...process.env,
          MENTORCLAW_RUNTIME_ROOT: target.linuxRuntimeRoot,
          MENTORCLAW_CONFIG_PATH: configPath,
          MENTORCLAW_SESSION_ID: session.sessionId,
          MENTORCLAW_AGENT_ID: session.agentId,
          MENTORCLAW_TIMEOUT_SECONDS: String(timeoutSeconds),
          MENTORCLAW_MESSAGE_B64: Buffer.from(request.message, "utf8").toString("base64"),
        },
        maxBuffer: MAX_STDIO_BUFFER,
        timeout: (timeoutSeconds + 15) * 1000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const failure = error as Partial<{
        stdout: string | Buffer;
        stderr: string | Buffer;
        message: string;
      }>;
      stdout = typeof failure.stdout === "string" ? failure.stdout : Buffer.isBuffer(failure.stdout) ? failure.stdout.toString("utf8") : "";
      stderr = typeof failure.stderr === "string" ? failure.stderr : Buffer.isBuffer(failure.stderr) ? failure.stderr.toString("utf8") : "";
      failureMessage = failure.message ?? "";
    }

    const parsed = parseJsonEnvelope(stdout) ?? parseJsonEnvelope(stderr);
    if (!parsed) {
      const detail = stderr.trim() || stdout.trim() || failureMessage || "OpenClaw returned non-JSON output.";
      throw new Error(`OpenClaw agent turn failed: ${detail}`);
    }

    const assistantReply = extractAssistantReply(parsed);
    if (!assistantReply) {
      throw new Error("OpenClaw agent turn completed without a text reply payload.");
    }

    const reportedSessionKey = readString(deepGet(parsed, ["meta", "systemPromptReport", "sessionKey"])) ?? session.sessionKey;
    const reportedSessionId = readString(deepGet(parsed, ["meta", "agentMeta", "sessionId"])) ?? session.sessionId;
    const reportedAgentId = reportedSessionKey.match(EXPLICIT_SESSION_KEY_PATTERN)?.[1] ?? session.agentId;

    return {
      assistantReply,
      sessionId: reportedSessionId,
      sessionKey: reportedSessionKey,
      agentId: reportedAgentId,
      durationMs: readNumber(deepGet(parsed, ["meta", "durationMs"])),
      stopReason: readString(deepGet(parsed, ["stopReason"])),
      workspaceDir: readString(deepGet(parsed, ["meta", "systemPromptReport", "workspaceDir"])),
      raw: parsed,
    };
  }

  private resolveDefaultAgentId(runtimeRoot: string): Promise<string> {
    const cached = this.agentIdCache.get(runtimeRoot);
    if (cached) return cached;
    const promise = parseDefaultAgentId(runtimeRoot);
    this.agentIdCache.set(runtimeRoot, promise);
    return promise;
  }
}

export { normalizeAgentConfig };
