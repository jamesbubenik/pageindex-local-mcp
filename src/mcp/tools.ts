import { z } from "zod";

export const HealthInputSchema = z.object({});

export const IndexDocumentInputSchema = z.object({
  path: z.string().min(1).describe("Absolute path to a .pdf, .md, or .markdown file"),
  copyToWorkspace: z.boolean().optional().default(true).describe("Copy source file into workspace (recommended)"),
  documentId: z.string().optional().describe("Optional stable custom document ID"),
  model: z.string().optional().describe("Model override for this indexing run"),
  tocCheckPages: z.number().int().positive().optional().describe("Pages to check for TOC (PDF only)"),
  maxPagesPerNode: z.number().int().positive().optional().describe("Max pages per node (PDF only)"),
  maxTokensPerNode: z.number().int().positive().optional().describe("Max tokens per node"),
  addNodeId: z.boolean().optional().default(true).describe("Include node IDs in tree"),
  addNodeSummary: z.boolean().optional().default(true).describe("Include node summaries"),
  addDocDescription: z.boolean().optional().default(true).describe("Include document description"),
  addNodeText: z.boolean().optional().default(false).describe("Include raw node text (increases tree size)"),
  forceReindex: z.boolean().optional().default(false).describe("Re-index even if document hash matches existing"),
  ifThinning: z.boolean().optional().describe("Apply tree thinning (Markdown only)"),
  thinningThreshold: z.number().int().positive().optional().describe("Thinning min token threshold (Markdown only)"),
  summaryTokenThreshold: z.number().int().positive().optional().describe("Summary token threshold (Markdown only)"),
});

export const ListDocumentsInputSchema = z.object({
  status: z
    .enum(["pending", "indexing", "indexed", "failed"])
    .optional()
    .describe("Filter by index status"),
  limit: z.number().int().min(1).max(500).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const GetDocumentInputSchema = z.object({
  documentId: z.string().min(1).describe("Document ID to retrieve"),
});

export const GetTreeInputSchema = z.object({
  documentId: z.string().min(1),
  maxDepth: z.number().int().min(1).max(20).optional().describe("Truncate tree at this depth"),
  includeSummaries: z.boolean().optional().default(true),
  includePageRanges: z.boolean().optional().default(true),
});

export const SearchInputSchema = z.object({
  query: z.string().min(1).describe("Natural language query"),
  documentIds: z.array(z.string()).optional().describe("Limit search to these document IDs (all indexed docs if omitted)"),
  maxResults: z.number().int().min(1).max(50).optional().default(10),
  includeReasoningPath: z.boolean().optional().default(true),
  includeSourceText: z.boolean().optional().default(true),
  model: z.string().optional().describe("Model override for query"),
});

export const RemoveDocumentInputSchema = z.object({
  documentId: z.string().min(1),
  deleteFiles: z.boolean().optional().default(false).describe("Also delete workspace artifacts"),
});

export const ReindexDocumentInputSchema = z.object({
  documentId: z.string().min(1),
  model: z.string().optional(),
  tocCheckPages: z.number().int().positive().optional(),
  maxPagesPerNode: z.number().int().positive().optional(),
  maxTokensPerNode: z.number().int().positive().optional(),
  addNodeText: z.boolean().optional(),
});

export const TOOL_DEFINITIONS = [
  {
    name: "pageindex_local_health",
    description: "Check whether the local MCP server, PageIndex repo, Python environment, and workspace are configured correctly.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "pageindex_local_index_document",
    description: "Add and index a local PDF or Markdown file using the local PageIndex installation. Returns document ID and tree path on success.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to .pdf, .md, or .markdown file" },
        copyToWorkspace: { type: "boolean", default: true },
        documentId: { type: "string", description: "Optional stable custom document ID" },
        model: { type: "string" },
        tocCheckPages: { type: "number" },
        maxPagesPerNode: { type: "number" },
        maxTokensPerNode: { type: "number" },
        addNodeId: { type: "boolean", default: true },
        addNodeSummary: { type: "boolean", default: true },
        addDocDescription: { type: "boolean", default: true },
        addNodeText: { type: "boolean", default: false },
        forceReindex: { type: "boolean", default: false },
        ifThinning: { type: "boolean" },
        thinningThreshold: { type: "number" },
        summaryTokenThreshold: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "pageindex_local_list_documents",
    description: "List documents in the local workspace registry.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["pending", "indexing", "indexed", "failed"] },
        limit: { type: "number", default: 50 },
        offset: { type: "number", default: 0 },
      },
      required: [],
    },
  },
  {
    name: "pageindex_local_get_document",
    description: "Return full metadata for one indexed document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        documentId: { type: "string" },
      },
      required: ["documentId"],
    },
  },
  {
    name: "pageindex_local_get_tree",
    description: "Return the PageIndex tree structure for a document, optionally limited by depth.",
    inputSchema: {
      type: "object" as const,
      properties: {
        documentId: { type: "string" },
        maxDepth: { type: "number" },
        includeSummaries: { type: "boolean", default: true },
        includePageRanges: { type: "boolean", default: true },
      },
      required: ["documentId"],
    },
  },
  {
    name: "pageindex_local_search",
    description: "Perform vectorless reasoning-based retrieval across locally indexed PageIndex documents using a local LLM.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        documentIds: { type: "array", items: { type: "string" } },
        maxResults: { type: "number", default: 10 },
        includeReasoningPath: { type: "boolean", default: true },
        includeSourceText: { type: "boolean", default: true },
        model: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "pageindex_local_remove_document",
    description: "Remove a document from the local registry and optionally delete workspace artifacts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        documentId: { type: "string" },
        deleteFiles: { type: "boolean", default: false },
      },
      required: ["documentId"],
    },
  },
  {
    name: "pageindex_local_reindex_document",
    description: "Re-run local PageIndex generation for an existing document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        documentId: { type: "string" },
        model: { type: "string" },
        tocCheckPages: { type: "number" },
        maxPagesPerNode: { type: "number" },
        maxTokensPerNode: { type: "number" },
        addNodeText: { type: "boolean" },
      },
      required: ["documentId"],
    },
  },
];
