export type ErrorCode =
  | "CONFIG_MISSING_PAGEINDEX_REPO"
  | "CONFIG_INVALID_PYTHON"
  | "PAGEINDEX_RUNNER_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_OUTSIDE_ALLOWED_ROOTS"
  | "INDEX_FAILED"
  | "TREE_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "QUERY_FAILED"
  | "LLM_CONNECTION_FAILED"
  | "REGISTRY_WRITE_FAILED"
  | "REGISTRY_READ_FAILED"
  | "WORKSPACE_INIT_FAILED"
  | "PATH_TRAVERSAL_DETECTED"
  | "REINDEX_FAILED";

export class PageIndexMcpError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "PageIndexMcpError";
    this.code = code;
    this.detail = detail;
  }

  toMcpContent(): string {
    const parts = [`[${this.code}] ${this.message}`];
    if (this.detail) parts.push(`Detail: ${this.detail}`);
    return parts.join("\n");
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      detail: this.detail ?? null,
    };
  }
}

export function isMcpError(e: unknown): e is PageIndexMcpError {
  return e instanceof PageIndexMcpError;
}

export function toMcpError(e: unknown, fallbackCode: ErrorCode = "INDEX_FAILED"): PageIndexMcpError {
  if (isMcpError(e)) return e;
  if (e instanceof Error) return new PageIndexMcpError(fallbackCode, e.message);
  return new PageIndexMcpError(fallbackCode, String(e));
}
