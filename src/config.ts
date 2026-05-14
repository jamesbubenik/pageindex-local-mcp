import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import type { LogLevel, RegistryBackend } from "./pageindex/types.js";

export interface Config {
  pageindexRepoPath: string;
  python: string;
  workspace: string;
  model: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmTimeoutMs: number;
  /** Max ms to wait for a PageIndex Python subprocess (indexing). Default: 600 000 (10 min). */
  toolTimeoutMs: number;
  tocCheckPages: number;
  maxPagesPerNode: number;
  maxTokensPerNode: number;
  allowedRoots: string[];
  logLevel: LogLevel;
  registryBackend: RegistryBackend;
}

function loadDotEnv(dir: string): void {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // non-fatal
  }
}

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined && val !== "") return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Required environment variable ${key} is not set.`);
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function parseAllowedRoots(raw: string): string[] {
  if (!raw.trim()) return [];
  const sep = raw.includes(";") ? ";" : ":";
  return raw
    .split(sep)
    .map((p) => resolve(p.trim()))
    .filter(Boolean);
}

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  // Load .env from CWD first, then from project dir
  loadDotEnv(process.cwd());

  const pageindexRepoPath = env("PAGEINDEX_REPO_PATH", "");
  const python = env("PAGEINDEX_PYTHON", "python3");
  const defaultWorkspace = join(homedir(), ".pageindex-local-mcp");
  const workspace = resolve(env("PAGEINDEX_WORKSPACE", defaultWorkspace));
  const model = env("PAGEINDEX_MODEL", "local-model");
  const llmBaseUrl = env("PAGEINDEX_LLM_BASE_URL", "http://127.0.0.1:1234/v1");
  const llmApiKey = env("PAGEINDEX_LLM_API_KEY", "local");
  const llmTimeoutMs = envInt("PAGEINDEX_LLM_TIMEOUT_MS", 120_000);
  const toolTimeoutMs = envInt("PAGEINDEX_TOOL_TIMEOUT_MS", 600_000);
  const tocCheckPages = envInt("PAGEINDEX_TOC_CHECK_PAGES", 20);
  const maxPagesPerNode = envInt("PAGEINDEX_MAX_PAGES_PER_NODE", 10);
  const maxTokensPerNode = envInt("PAGEINDEX_MAX_TOKENS_PER_NODE", 20000);
  const allowedRoots = parseAllowedRoots(env("PAGEINDEX_ALLOWED_ROOTS", ""));
  const registryBackend = (env("PAGEINDEX_REGISTRY_BACKEND", "json") as RegistryBackend);
  const logLevelRaw = env("PAGEINDEX_LOG_LEVEL", "info");
  const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
  const logLevel: LogLevel = validLevels.includes(logLevelRaw as LogLevel)
    ? (logLevelRaw as LogLevel)
    : "info";

  _config = {
    pageindexRepoPath: pageindexRepoPath ? resolve(pageindexRepoPath) : "",
    python,
    workspace,
    model,
    llmBaseUrl,
    llmApiKey,
    llmTimeoutMs,
    toolTimeoutMs,
    tocCheckPages,
    maxPagesPerNode,
    maxTokensPerNode,
    allowedRoots,
    logLevel,
    registryBackend,
  };

  return _config;
}

/** Reset config (for testing) */
export function resetConfig(): void {
  _config = null;
}
