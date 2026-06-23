import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../infra/env/config.js";

export type ServerProcessStatus = {
  running: boolean;
  pid?: number;
  pidPath: string;
  logPath: string;
};

export function startServiceInBackground(config: AppConfig): ServerProcessStatus {
  const existing = getServiceProcessStatus(config);
  if (existing.running) return existing;

  fs.mkdirSync(path.dirname(config.serverPidPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.serverLogPath), { recursive: true });

  const out = fs.openSync(config.serverLogPath, "a");
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "serve"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env
  });
  child.unref();
  fs.writeFileSync(config.serverPidPath, `${child.pid}\n`);

  return {
    running: true,
    pid: child.pid,
    pidPath: config.serverPidPath,
    logPath: config.serverLogPath
  };
}

export function getServiceProcessStatus(config: AppConfig): ServerProcessStatus {
  const pid = readPid(config.serverPidPath);
  const running = pid ? isProcessRunning(pid) : false;
  if (pid && !running) cleanupStalePidFile(config.serverPidPath, pid);
  return {
    running,
    pid,
    pidPath: config.serverPidPath,
    logPath: config.serverLogPath
  };
}

export function stopServiceProcess(config: AppConfig): ServerProcessStatus {
  const status = getServiceProcessStatus(config);
  if (status.pid && status.running) {
    process.kill(status.pid, "SIGTERM");
  }
  if (fs.existsSync(config.serverPidPath)) fs.unlinkSync(config.serverPidPath);
  return {
    ...status,
    running: false
  };
}

export async function restartServiceProcess(config: AppConfig): Promise<ServerProcessStatus> {
  const previous = getServiceProcessStatus(config);
  if (previous.pid && previous.running) {
    process.kill(previous.pid, "SIGTERM");
    // Wait for the old process to release the port before launching a new one,
    // otherwise the new server can hit EADDRINUSE on a fast restart.
    await waitForProcessExit(previous.pid, 10_000);
  }
  if (fs.existsSync(config.serverPidPath)) fs.unlinkSync(config.serverPidPath);
  return startServiceInBackground(config);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function readPid(pidPath: string): number | undefined {
  if (!fs.existsSync(pidPath)) return undefined;
  const raw = fs.readFileSync(pidPath, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupStalePidFile(pidPath: string, pid: number): void {
  try {
    if (fs.existsSync(pidPath) && readPid(pidPath) === pid) {
      fs.unlinkSync(pidPath);
    }
  } catch {
    // Status/start should stay best-effort even if a stale pid file cannot be removed.
  }
}
