import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  DebugUiService,
  type BindSessionRequest,
  type CreatePlanRequest,
  type CreateThreadRequest,
  type HandleTurnRequest,
  type RecordAssistantReplyRequest,
} from "../src/debug-ui/service.ts";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

const parseArgs = (argv: string[]): { host: string; port: number; runtimeRoot: string; open: boolean } => {
  const defaults = {
    host: "127.0.0.1",
    port: 4318,
    runtimeRoot: resolveMentorclawRuntimeRoot(),
    open: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--host" && argv[index + 1]) defaults.host = argv[index + 1];
    if (current === "--port" && argv[index + 1]) defaults.port = Number(argv[index + 1]) || defaults.port;
    if (current === "--runtime-root" && argv[index + 1]) defaults.runtimeRoot = argv[index + 1];
    if (current === "--no-open") defaults.open = false;
    if (current === "--open") defaults.open = true;
  }

  return defaults;
};

const json = (status: number, payload: unknown): { status: number; headers: Record<string, string>; body: string } => ({
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(payload),
});

const text = (status: number, body: string, contentType: string): { status: number; headers: Record<string, string>; body: string } => ({
  status,
  headers: {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  },
  body,
});

const readJsonBody = async (request: import("node:http").IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
};

const openBrowser = (url: string): void => {
  const spawnDetached = (command: string, args: string[]): void => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  };

  if (process.env.WSL_DISTRO_NAME) {
    spawnDetached("cmd.exe", ["/c", "start", "", url]);
    return;
  }
  if (process.platform === "win32") {
    spawnDetached("cmd.exe", ["/c", "start", "", url]);
    return;
  }
  if (process.platform === "darwin") {
    spawnDetached("open", [url]);
    return;
  }
  spawnDetached("xdg-open", [url]);
};

const send = (response: import("node:http").ServerResponse, result: { status: number; headers: Record<string, string>; body: string }): void => {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
};

const args = parseArgs(process.argv.slice(2));
const service = new DebugUiService(args.runtimeRoot);
const staticRoot = path.join(import.meta.dirname, "..", "src", "debug-ui", "static");

const staticFiles = new Map<string, { fileName: string; contentType: string }>([
  ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/app.js", { fileName: "app.js", contentType: "text/javascript; charset=utf-8" }],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    const staticFile = staticFiles.get(url.pathname);
    if (request.method === "GET" && staticFile) {
      const body = await readFile(path.join(staticRoot, staticFile.fileName), "utf8");
      send(response, text(200, body, staticFile.contentType));
      return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      send(response, text(204, "", "image/x-icon"));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      send(response, json(200, await service.getSnapshot()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath) throw new Error("path is required.");
      send(response, json(200, await service.readLocalFile(filePath)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/plans") {
      const body = (await readJsonBody(request)) as CreatePlanRequest;
      send(response, json(200, await service.createPlan(body)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/plans/activate") {
      const body = (await readJsonBody(request)) as { planId?: string };
      if (!body.planId) throw new Error("planId is required.");
      send(response, json(200, await service.activatePlan(body.planId)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/threads") {
      const body = (await readJsonBody(request)) as CreateThreadRequest;
      send(response, json(200, await service.createThread(body)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/bindings") {
      const body = (await readJsonBody(request)) as BindSessionRequest;
      send(response, json(200, await service.bindSession(body)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/bindings/unbind") {
      const body = (await readJsonBody(request)) as { sessionKey?: string };
      if (!body.sessionKey) throw new Error("sessionKey is required.");
      send(response, json(200, await service.unbindSession(body.sessionKey)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/turns") {
      const body = (await readJsonBody(request)) as HandleTurnRequest;
      send(response, json(200, await service.handleUserTurn(body)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/assistant-replies") {
      const body = (await readJsonBody(request)) as RecordAssistantReplyRequest;
      send(response, json(200, await service.recordAssistantReply(body)));
      return;
    }

    send(response, json(404, { error: `Route not found: ${request.method} ${url.pathname}` }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, json(400, { error: message }));
  }
});

server.listen(args.port, args.host, async () => {
  const url = `http://${args.host}:${args.port}`;
  const validation = await service.repo.validateRuntime();
  console.log(`[mentorclaw-debug-ui] runtimeRoot=${args.runtimeRoot}`);
  console.log(`[mentorclaw-debug-ui] workspace=${service.repo.paths.workspaceRoot}`);
  console.log(`[mentorclaw-debug-ui] listening at ${url}`);
  if (!validation.valid) {
    console.log("[mentorclaw-debug-ui] runtime validation errors:");
    for (const entry of validation.errors) console.log(`- ${entry}`);
  }
  if (args.open) openBrowser(url);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
