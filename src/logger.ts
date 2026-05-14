import type { LogLevel } from "./pageindex/types.js";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(level: string, msg: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (data === undefined) return base;
  try {
    return `${base} ${JSON.stringify(data)}`;
  } catch {
    return `${base} [unserializable data]`;
  }
}

// MCP servers communicate over stdio, so logs MUST go to stderr to avoid corrupting the protocol.
export const logger = {
  debug(msg: string, data?: unknown): void {
    if (shouldLog("debug")) process.stderr.write(format("debug", msg, data) + "\n");
  },
  info(msg: string, data?: unknown): void {
    if (shouldLog("info")) process.stderr.write(format("info", msg, data) + "\n");
  },
  warn(msg: string, data?: unknown): void {
    if (shouldLog("warn")) process.stderr.write(format("warn", msg, data) + "\n");
  },
  error(msg: string, data?: unknown): void {
    if (shouldLog("error")) process.stderr.write(format("error", msg, data) + "\n");
  },
};
