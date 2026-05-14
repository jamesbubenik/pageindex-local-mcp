/**
 * Smoke tests that exercise the MCP server logic directly (no stdio protocol needed).
 *
 * Usage:
 *   npm run smoke:health
 *   npm run smoke:index -- /absolute/path/to/file.pdf
 *   npm run smoke:list
 *   npm run smoke:query -- "What is this document about?"
 */

import { loadConfig } from "../src/config.js";
import { setLogLevel } from "../src/logger.js";
import { CliAdapter } from "../src/pageindex/cliAdapter.js";
import { Registry } from "../src/pageindex/registry.js";
import { runQuery } from "../src/pageindex/queryEngine.js";

async function health(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const cli = new CliAdapter(config);
  const result = await cli.checkInstall();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function index(filePath: string): Promise<void> {
  if (!filePath) {
    console.error("Usage: npm run smoke:index -- /absolute/path/to/file.pdf");
    process.exit(1);
  }

  const config = loadConfig();
  setLogLevel(config.logLevel);
  const cli = new CliAdapter(config);
  const registry = new Registry(config.workspace);

  const { sha256File } = await import("../src/utils/fileHash.js");
  const { resolveAndValidatePath, validateFileExists, validateFileExtension } = await import(
    "../src/pageindex/pathSafety.js"
  );
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  const { join, basename } = await import("node:path");
  const { randomUUID } = await import("node:crypto");

  const resolved = resolveAndValidatePath(filePath, config.allowedRoots);
  validateFileExists(resolved);
  const fileType = validateFileExtension(resolved);
  const fileHash = await sha256File(resolved);

  const existing = registry.getByHash(fileHash);
  if (existing) {
    console.log("Already indexed:", JSON.stringify(existing, null, 2));
    return;
  }

  const documentId = randomUUID();
  const fileName = basename(resolved);
  const docWorkspace = join(config.workspace, "documents", documentId);
  mkdirSync(docWorkspace, { recursive: true });

  const record = registry.createRecord({
    documentId,
    sourcePath: resolved,
    workspacePath: docWorkspace,
    fileName,
    fileType,
    fileHash,
    pageindexOptions: {},
  });
  await registry.upsert(record);
  await registry.updateStatus(documentId, "indexing");

  const workspacePath = await cli.copySourceToWorkspace(resolved, docWorkspace);

  let cmdResult;
  if (fileType === "pdf") {
    cmdResult = await cli.indexPdf({ pdfPath: workspacePath });
  } else {
    cmdResult = await cli.indexMarkdown({ mdPath: workspacePath });
  }

  cli.writeLogs(docWorkspace, cmdResult.stdout, cmdResult.stderr);

  if (!cmdResult.success) {
    console.error("Indexing failed:", cmdResult.stderr || cmdResult.stdout);
    await registry.updateStatus(documentId, "failed", { lastError: cmdResult.stderr });
    process.exit(1);
  }

  const sourceFileName = `source${fileType === "pdf" ? ".pdf" : ".md"}`;
  const generatedTreePath = cli.discoverGeneratedTree(sourceFileName);

  if (!existsSync(generatedTreePath)) {
    console.error("Tree file not found:", generatedTreePath);
    process.exit(1);
  }

  const treePath = await cli.storeTreeInWorkspace(generatedTreePath, docWorkspace);
  const metadataPath = join(docWorkspace, "index", "metadata.json");
  writeFileSync(
    metadataPath,
    JSON.stringify({ documentId, fileName, fileType, indexedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );

  await registry.updateStatus(documentId, "indexed", { treePath, metadataPath });
  console.log(JSON.stringify({ documentId, status: "indexed", treePath }, null, 2));
}

async function list(): Promise<void> {
  const config = loadConfig();
  const registry = new Registry(config.workspace);
  const { documents, total } = registry.list({ limit: 50 });
  console.log(JSON.stringify({ documents, total }, null, 2));
}

async function query(queryText: string): Promise<void> {
  if (!queryText) {
    console.error('Usage: npm run smoke:query -- "What is this document about?"');
    process.exit(1);
  }

  const config = loadConfig();
  const registry = new Registry(config.workspace);
  const { documents } = registry.list({ status: "indexed", limit: 500 });

  if (documents.length === 0) {
    console.error("No indexed documents found.");
    process.exit(1);
  }

  const result = await runQuery(
    documents.map((d) => ({
      documentId: d.documentId,
      fileName: d.fileName,
      treePath: d.treePath!,
    })),
    { query: queryText, maxResults: 5 },
    config
  );

  console.log(JSON.stringify(result, null, 2));
}

// ---- Entry point ----

const [, , command, ...rest] = process.argv;

switch (command) {
  case "health":
    await health();
    break;
  case "index":
    await index(rest[0] ?? "");
    break;
  case "list":
    await list();
    break;
  case "query":
    await query(rest.join(" "));
    break;
  default:
    console.error("Unknown command. Use: health | index | list | query");
    process.exit(1);
}
