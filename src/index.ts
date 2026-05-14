#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { setLogLevel } from "./logger.js";
import { logger } from "./logger.js";
import { startServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info("Starting pageindex-local-mcp", {
    workspace: config.workspace,
    repoPath: config.pageindexRepoPath || "(not set)",
    llmBaseUrl: config.llmBaseUrl,
  });

  await startServer(config);
}

main().catch((e) => {
  process.stderr.write(`Fatal error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
