import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveMentorclawRuntimeRoot } from "../src/utils/runtime-root.ts";

type Command = "start" | "stop" | "restart" | "status";

interface Options {
  command: Command;
  host: string;
  port: number;
  runtimeRoot: string;
}

const parseArgs = (argv: string[]): Options => {
  const positional = argv.find((value) => !value.startsWith("--"));
  const command = (positional as Command | undefined) ?? "start";
  if (!["start", "stop", "restart", "status"].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  const options: Options = {
    command,
    host: "127.0.0.1",
    port: 4318,
    runtimeRoot: resolveMentorclawRuntimeRoot(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--host" && argv[index + 1]) options.host = argv[index + 1];
    if (current === "--port" && argv[index + 1]) options.port = Number(argv[index + 1]) || options.port;
    if (current === "--runtime-root" && argv[index + 1]) options.runtimeRoot = argv[index + 1];
  }

  return options;
};

const pidFile = (runtimeRoot: string): string => path.join(runtimeRoot, "logs", "debug-ui.pid");
const logFile = (runtimeRoot: string): string => path.join(runtimeRoot, "logs", "debug-ui.log");
const healthUrl = (host: string, port: number): string => `http://${host}:${port}/api/state`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const isPidRunning = async (pid: number): Promise<boolean> => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readPid = async (runtimeRoot: string): Promise<number | null> => {
  try {
    const raw = await readFile(pidFile(runtimeRoot), "utf8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const writePid = async (runtimeRoot: string, pid: number): Promise<void> => {
  await mkdir(path.join(runtimeRoot, "logs"), { recursive: true });
  await writeFile(pidFile(runtimeRoot), `${pid}\n`, "utf8");
};

const removePid = async (runtimeRoot: string): Promise<void> => {
  await rm(pidFile(runtimeRoot), { force: true });
};

const checkHealth = async (host: string, port: number): Promise<boolean> => {
  try {
    const response = await fetch(healthUrl(host, port), { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
};

const waitForHealthy = async (host: string, port: number, timeoutMs = 8000): Promise<boolean> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkHealth(host, port)) {
      return true;
    }
    await sleep(250);
  }
  return false;
};

const ensureStopped = async (runtimeRoot: string): Promise<void> => {
  const pid = await readPid(runtimeRoot);
  if (!pid) {
    await removePid(runtimeRoot);
    return;
  }

  if (!(await isPidRunning(pid))) {
    await removePid(runtimeRoot);
    return;
  }

  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await isPidRunning(pid))) {
      await removePid(runtimeRoot);
      return;
    }
    await sleep(200);
  }

  process.kill(pid, "SIGKILL");
  await removePid(runtimeRoot);
};

const startDaemon = async (options: Options): Promise<void> => {
  const existingPid = await readPid(options.runtimeRoot);
  if (existingPid && (await isPidRunning(existingPid)) && (await checkHealth(options.host, options.port))) {
    console.log(`debug-ui already running at http://${options.host}:${options.port} (pid=${existingPid})`);
    return;
  }

  if (existingPid && !(await isPidRunning(existingPid))) {
    await removePid(options.runtimeRoot);
  }

  await mkdir(path.join(options.runtimeRoot, "logs"), { recursive: true });
  const logHandle = await open(logFile(options.runtimeRoot), fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY, 0o644);
  const outFd = logHandle.fd;

  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(import.meta.dirname, "debug-ui.ts"),
      "--host",
      options.host,
      "--port",
      String(options.port),
      "--runtime-root",
      options.runtimeRoot,
      "--no-open",
    ],
    {
      cwd: path.join(import.meta.dirname, ".."),
      detached: true,
      stdio: ["ignore", outFd, outFd],
    },
  );

  child.unref();
  await logHandle.close();
  await writePid(options.runtimeRoot, child.pid!);

  const healthy = await waitForHealthy(options.host, options.port);
  if (!healthy) {
    const lastLog = await readFile(logFile(options.runtimeRoot), "utf8").catch(() => "");
    throw new Error(`debug-ui failed to become healthy.\n${lastLog.trim()}`);
  }

  console.log(`debug-ui running at http://${options.host}:${options.port} (pid=${child.pid})`);
};

const printStatus = async (options: Options): Promise<void> => {
  const pid = await readPid(options.runtimeRoot);
  const running = pid ? await isPidRunning(pid) : false;
  const healthy = await checkHealth(options.host, options.port);
  console.log(
    JSON.stringify(
      {
        runtimeRoot: options.runtimeRoot,
        pid,
        running,
        healthy,
        url: `http://${options.host}:${options.port}`,
        logFile: logFile(options.runtimeRoot),
      },
      null,
      2,
    ),
  );
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "start") {
    await startDaemon(options);
    return;
  }

  if (options.command === "stop") {
    await ensureStopped(options.runtimeRoot);
    console.log("debug-ui stopped");
    return;
  }

  if (options.command === "restart") {
    await ensureStopped(options.runtimeRoot);
    await startDaemon(options);
    return;
  }

  await printStatus(options);
};

await main();
