export type FileType = "pdf" | "md";
export type IndexStatus = "pending" | "indexing" | "indexed" | "failed";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type RegistryBackend = "json" | "sqlite";

export interface TreeNode {
  id?: string;
  title?: string;
  summary?: string;
  description?: string;
  start_index?: number;
  end_index?: number;
  start_page?: number;
  end_page?: number;
  text?: string;
  children?: TreeNode[];
  [key: string]: unknown;
}

export interface PageIndexTree {
  description?: string;
  title?: string;
  children?: TreeNode[];
  [key: string]: unknown;
}

export interface DocumentRecord {
  documentId: string;
  sourcePath: string;
  workspacePath: string;
  fileName: string;
  fileType: FileType;
  fileHash: string;
  createdAt: string;
  updatedAt: string;
  indexStatus: IndexStatus;
  treePath: string | null;
  metadataPath: string | null;
  lastError: string | null;
  modelUsed: string | null;
  pageindexOptions: Record<string, unknown>;
}

export interface RegistryData {
  version: number;
  documents: Record<string, DocumentRecord>;
}

export interface DocumentMetadataFile {
  documentId: string;
  fileName: string;
  fileType: FileType;
  sourcePath: string;
  fileHash: string;
  indexedAt: string;
  modelUsed: string | null;
  pageindexOptions: Record<string, unknown>;
}

export interface HealthResult {
  ok: boolean;
  server: {
    name: string;
    version: string;
    workspace: string;
  };
  pageindex: {
    repoPath: string;
    python: string;
    runPageIndexExists: boolean;
    requirementsDetected: boolean;
    version: string | null;
  };
  llm: {
    baseUrl: string;
    model: string;
  };
  warnings: string[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
  durationMs: number;
}

export interface IndexOptions {
  path: string;
  copyToWorkspace?: boolean;
  documentId?: string;
  model?: string;
  tocCheckPages?: number;
  maxPagesPerNode?: number;
  maxTokensPerNode?: number;
  addNodeId?: boolean;
  addNodeSummary?: boolean;
  addDocDescription?: boolean;
  addNodeText?: boolean;
  forceReindex?: boolean;
  // markdown-only
  ifThinning?: boolean;
  thinningThreshold?: number;
  summaryTokenThreshold?: number;
}

export interface IndexResult {
  documentId: string;
  status: IndexStatus;
  fileName: string;
  fileHash: string;
  treePath: string | null;
  metadataPath: string | null;
  message: string;
  alreadyIndexed?: boolean;
}

export interface ReasoningPathItem {
  nodeId: string;
  title: string;
  reason: string;
}

export interface SearchResultItem {
  documentId: string;
  fileName: string;
  nodeId: string;
  title: string;
  summary: string | null;
  startIndex: number | null;
  endIndex: number | null;
  sourceText: string | null;
  reasoningPath: ReasoningPathItem[];
  score: null;
}

export interface QueryOptions {
  query: string;
  documentIds?: string[];
  maxResults?: number;
  includeReasoningPath?: boolean;
  includeSourceText?: boolean;
  model?: string;
}

export interface QueryResult {
  query: string;
  results: SearchResultItem[];
  answerDraft: string | null;
  warnings: string[];
}

export interface FlatNode {
  node: TreeNode;
  depth: number;
  parentId: string | null;
  path: ReasoningPathItem[];
}

export interface LlmNodeSelection {
  relevant_ids: string[];
  reasons: Record<string, string>;
}
