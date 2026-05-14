import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { join, basename } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { DocumentRecord, IndexOptions } from "../pageindex/types.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { CliAdapter } from "../pageindex/cliAdapter.js";
import { Registry } from "../pageindex/registry.js";
import { runQuery, loadTree, applyMaxDepth } from "../pageindex/queryEngine.js";
import {
  resolveAndValidatePath,
  validateFileExists,
  validateFileExtension,
  sanitizeDocumentId,
} from "../pageindex/pathSafety.js";
import { sha256File } from "../utils/fileHash.js";
import { PageIndexMcpError, toMcpError } from "../utils/errors.js";
import { logger } from "../logger.js";

export function createServer(config: Config): Server {
  const server = new Server(
    { name: "pageindex-local-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const cli = new CliAdapter(config);
  const registry = new Registry(config.workspace);

  // Ensure workspace exists
  try {
    mkdirSync(config.workspace, { recursive: true });
    mkdirSync(join(config.workspace, "documents"), { recursive: true });
  } catch {
    // may already exist
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "pageindex_local_health":
          return await handleHealth(cli);

        case "pageindex_local_index_document":
          return await handleIndexDocument(input, cli, registry, config);

        case "pageindex_local_list_documents":
          return await handleListDocuments(input, registry);

        case "pageindex_local_get_document":
          return await handleGetDocument(input, registry);

        case "pageindex_local_get_tree":
          return await handleGetTree(input, registry);

        case "pageindex_local_search":
          return await handleSearch(input, registry, config);

        case "pageindex_local_remove_document":
          return await handleRemoveDocument(input, registry);

        case "pageindex_local_reindex_document":
          return await handleReindexDocument(input, cli, registry, config);

        default:
          return errorContent(`Unknown tool: ${name}`);
      }
    } catch (e) {
      const err = toMcpError(e, "QUERY_FAILED");
      logger.error("Tool error", { tool: name, code: err.code, message: err.message });
      return errorContent(err.toMcpContent());
    }
  });

  return server;
}

export async function startServer(config: Config): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("pageindex-local-mcp started on stdio");
}

// ---- Tool handlers ----

async function handleHealth(cli: CliAdapter) {
  const result = await cli.checkInstall();
  return jsonContent(result);
}

async function handleIndexDocument(
  input: Record<string, unknown>,
  cli: CliAdapter,
  registry: Registry,
  config: Config
) {
  const filePath = String(input.path ?? "");
  const copyToWorkspace = input.copyToWorkspace !== false;
  const forceReindex = input.forceReindex === true;
  const model = input.model ? String(input.model) : undefined;

  // --- Path validation ---
  const resolved = resolveAndValidatePath(filePath, config.allowedRoots);
  validateFileExists(resolved);
  const fileType = validateFileExtension(resolved);

  // --- File hash + dedup check ---
  const fileHash = await sha256File(resolved);
  const existing = registry.getByHash(fileHash);
  if (existing && !forceReindex) {
    return jsonContent({
      documentId: existing.documentId,
      status: existing.indexStatus,
      fileName: existing.fileName,
      fileHash,
      treePath: existing.treePath,
      metadataPath: existing.metadataPath,
      message: "Document already indexed (same file hash). Use forceReindex=true to re-index.",
      alreadyIndexed: true,
    });
  }

  // --- Generate document ID ---
  let documentId: string;
  if (input.documentId) {
    documentId = sanitizeDocumentId(String(input.documentId));
  } else if (existing) {
    documentId = existing.documentId; // reuse existing ID on force-reindex
  } else {
    documentId = randomUUID();
  }

  const fileName = basename(resolved);
  const docWorkspace = join(config.workspace, "documents", documentId);
  mkdirSync(docWorkspace, { recursive: true });

  const pageindexOptions: Record<string, unknown> = {
    addNodeId: input.addNodeId !== false,
    addNodeSummary: input.addNodeSummary !== false,
    addDocDescription: input.addDocDescription !== false,
    addNodeText: input.addNodeText === true,
  };

  // --- Upsert registry with pending status ---
  const record = registry.createRecord({
    documentId,
    sourcePath: resolved,
    workspacePath: docWorkspace,
    fileName,
    fileType,
    fileHash,
    modelUsed: model ?? config.model,
    pageindexOptions,
  });
  await registry.upsert(record);
  await registry.updateStatus(documentId, "indexing");

  // --- Copy source to workspace ---
  let workspacePath = resolved;
  if (copyToWorkspace) {
    workspacePath = await cli.copySourceToWorkspace(resolved, docWorkspace);
  }

  // --- Run PageIndex ---
  let cmdResult;
  try {
    if (fileType === "pdf") {
      cmdResult = await cli.indexPdf({
        pdfPath: workspacePath,
        model,
        tocCheckPages: input.tocCheckPages != null ? Number(input.tocCheckPages) : undefined,
        maxPagesPerNode: input.maxPagesPerNode != null ? Number(input.maxPagesPerNode) : undefined,
        maxTokensPerNode: input.maxTokensPerNode != null ? Number(input.maxTokensPerNode) : undefined,
        addNodeId: input.addNodeId !== false,
        addNodeSummary: input.addNodeSummary !== false,
        addDocDescription: input.addDocDescription !== false,
        addNodeText: input.addNodeText === true,
      });
    } else {
      cmdResult = await cli.indexMarkdown({
        mdPath: workspacePath,
        model,
        addNodeId: input.addNodeId !== false,
        addNodeSummary: input.addNodeSummary !== false,
        addDocDescription: input.addDocDescription !== false,
        addNodeText: input.addNodeText === true,
        ifThinning: input.ifThinning != null ? Boolean(input.ifThinning) : undefined,
        thinningThreshold: input.thinningThreshold != null ? Number(input.thinningThreshold) : undefined,
        summaryTokenThreshold: input.summaryTokenThreshold != null ? Number(input.summaryTokenThreshold) : undefined,
      });
    }
  } catch (e) {
    const errMsg = String(e);
    cli.writeLogs(docWorkspace, "", errMsg);
    await registry.updateStatus(documentId, "failed", { lastError: errMsg });
    throw new PageIndexMcpError("INDEX_FAILED", "PageIndex CLI execution failed", errMsg);
  }

  // Save logs
  cli.writeLogs(docWorkspace, cmdResult.stdout, cmdResult.stderr);

  if (!cmdResult.success) {
    const errMsg = `Process exited with code ${cmdResult.exitCode}.\n${cmdResult.stderr || cmdResult.stdout}`;
    await registry.updateStatus(documentId, "failed", { lastError: errMsg });
    throw new PageIndexMcpError("INDEX_FAILED", "PageIndex returned non-zero exit code", errMsg);
  }

  // --- Discover and store tree ---
  // When copyToWorkspace=true, the file is in docWorkspace/original/source.pdf
  // but PageIndex uses the filename to name the output. We pass `source.pdf` so output is `source_structure.json`.
  const sourceFileName = copyToWorkspace ? `source${fileType === "pdf" ? ".pdf" : ".md"}` : fileName;
  const generatedTreePath = cli.discoverGeneratedTree(sourceFileName);

  if (!existsSync(generatedTreePath)) {
    // Search stdout for a path hint
    const pathMatch = cmdResult.stdout.match(/(?:saved|output|writing).*?([^\s]+_structure\.json)/i);
    if (!pathMatch) {
      const errMsg = `Tree file not found at expected location: ${generatedTreePath}`;
      await registry.updateStatus(documentId, "failed", { lastError: errMsg });
      throw new PageIndexMcpError("TREE_NOT_FOUND", errMsg);
    }
  }

  let treePath: string;
  try {
    treePath = await cli.storeTreeInWorkspace(generatedTreePath, docWorkspace);
  } catch (e) {
    const errMsg = `Failed to store tree: ${e}`;
    await registry.updateStatus(documentId, "failed", { lastError: errMsg });
    throw new PageIndexMcpError("INDEX_FAILED", errMsg);
  }

  // Write metadata.json
  const metadataPath = join(docWorkspace, "index", "metadata.json");
  writeFileSync(
    metadataPath,
    JSON.stringify({
      documentId,
      fileName,
      fileType,
      sourcePath: resolved,
      fileHash,
      indexedAt: new Date().toISOString(),
      modelUsed: model ?? config.model,
      pageindexOptions,
    }, null, 2),
    "utf8"
  );

  await registry.updateStatus(documentId, "indexed", {
    treePath,
    metadataPath,
    lastError: null,
    modelUsed: model ?? config.model,
  });

  return jsonContent({
    documentId,
    status: "indexed",
    fileName,
    fileHash,
    treePath,
    metadataPath,
    message: "Document indexed successfully.",
  });
}

async function handleListDocuments(
  input: Record<string, unknown>,
  registry: Registry
) {
  const status = input.status as string | undefined;
  const limit = input.limit != null ? Number(input.limit) : 50;
  const offset = input.offset != null ? Number(input.offset) : 0;

  const { documents, total } = registry.list({
    status: status as import("../pageindex/types.js").IndexStatus | undefined,
    limit,
    offset,
  });

  return jsonContent({
    documents: documents.map((d) => ({
      documentId: d.documentId,
      fileName: d.fileName,
      sourcePath: d.sourcePath,
      fileType: d.fileType,
      indexStatus: d.indexStatus,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      modelUsed: d.modelUsed,
    })),
    total,
  });
}

async function handleGetDocument(
  input: Record<string, unknown>,
  registry: Registry
) {
  const documentId = sanitizeDocumentId(String(input.documentId ?? ""));
  const doc = registry.get(documentId);
  if (!doc) {
    throw new PageIndexMcpError("DOCUMENT_NOT_FOUND", `Document not found: ${documentId}`);
  }
  return jsonContent({ document: doc });
}

async function handleGetTree(
  input: Record<string, unknown>,
  registry: Registry
) {
  const documentId = sanitizeDocumentId(String(input.documentId ?? ""));
  const maxDepth = input.maxDepth != null ? Number(input.maxDepth) : undefined;

  const doc = registry.get(documentId);
  if (!doc) throw new PageIndexMcpError("DOCUMENT_NOT_FOUND", `Document not found: ${documentId}`);
  if (!doc.treePath) throw new PageIndexMcpError("TREE_NOT_FOUND", `No tree for document: ${documentId}`);

  let tree = loadTree(doc.treePath);

  // Optionally strip text/summaries to reduce payload
  if (input.includeSummaries === false) {
    tree = stripField(tree, "summary") as typeof tree;
  }
  if (input.includePageRanges === false) {
    tree = stripFields(tree, ["start_index", "end_index", "start_page", "end_page"]) as typeof tree;
  }

  const truncated = maxDepth !== undefined;
  if (truncated) {
    tree = applyMaxDepth(tree, maxDepth);
  }

  return jsonContent({ documentId, tree, truncated });
}

async function handleSearch(
  input: Record<string, unknown>,
  registry: Registry,
  config: Config
) {
  const query = String(input.query ?? "");
  if (!query) throw new PageIndexMcpError("QUERY_FAILED", "query is required");

  const requestedIds = Array.isArray(input.documentIds)
    ? (input.documentIds as string[])
    : undefined;

  let documents: DocumentRecord[];
  if (requestedIds && requestedIds.length > 0) {
    documents = requestedIds.map((id) => {
      const doc = registry.get(id);
      if (!doc) throw new PageIndexMcpError("DOCUMENT_NOT_FOUND", `Document not found: ${id}`);
      return doc;
    });
  } else {
    const { documents: allDocs } = registry.list({ status: "indexed", limit: 500 });
    documents = allDocs;
  }

  const indexedDocs = documents.filter((d) => d.indexStatus === "indexed" && d.treePath);

  if (indexedDocs.length === 0) {
    return jsonContent({
      query,
      results: [],
      answerDraft: null,
      warnings: ["No indexed documents found. Index some documents first."],
    });
  }

  const result = await runQuery(
    indexedDocs.map((d) => ({
      documentId: d.documentId,
      fileName: d.fileName,
      treePath: d.treePath!,
    })),
    {
      query,
      documentIds: requestedIds,
      maxResults: input.maxResults != null ? Number(input.maxResults) : 10,
      includeReasoningPath: input.includeReasoningPath !== false,
      includeSourceText: input.includeSourceText !== false,
      model: input.model ? String(input.model) : undefined,
    },
    config
  );

  return jsonContent(result);
}

async function handleRemoveDocument(
  input: Record<string, unknown>,
  registry: Registry
) {
  const documentId = sanitizeDocumentId(String(input.documentId ?? ""));
  const deleteFiles = input.deleteFiles === true;

  const doc = registry.get(documentId);
  if (!doc) throw new PageIndexMcpError("DOCUMENT_NOT_FOUND", `Document not found: ${documentId}`);

  const removed = await registry.remove(documentId);

  if (deleteFiles && doc.workspacePath && existsSync(doc.workspacePath)) {
    try {
      rmSync(doc.workspacePath, { recursive: true, force: true });
    } catch (e) {
      logger.warn("Failed to delete workspace files", { documentId, error: String(e) });
    }
  }

  return jsonContent({ documentId, removed, filesDeleted: deleteFiles });
}

async function handleReindexDocument(
  input: Record<string, unknown>,
  cli: CliAdapter,
  registry: Registry,
  config: Config
) {
  const documentId = sanitizeDocumentId(String(input.documentId ?? ""));
  const doc = registry.get(documentId);
  if (!doc) throw new PageIndexMcpError("DOCUMENT_NOT_FOUND", `Document not found: ${documentId}`);

  // Delegate to index handler with forceReindex
  return handleIndexDocument(
    {
      path: doc.sourcePath,
      copyToWorkspace: true,
      documentId,
      forceReindex: true,
      model: input.model,
      tocCheckPages: input.tocCheckPages,
      maxPagesPerNode: input.maxPagesPerNode,
      maxTokensPerNode: input.maxTokensPerNode,
      addNodeId: true,
      addNodeSummary: true,
      addDocDescription: true,
      addNodeText: input.addNodeText,
    },
    cli,
    registry,
    config
  );
}

// ---- Helpers ----

function jsonContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function stripField(obj: unknown, field: string): unknown {
  if (Array.isArray(obj)) return obj.map((item) => stripField(item, field));
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k !== field) result[k] = stripField(v, field);
    }
    return result;
  }
  return obj;
}

function stripFields(obj: unknown, fields: string[]): unknown {
  let result = obj;
  for (const f of fields) result = stripField(result, f);
  return result;
}
