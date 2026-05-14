import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { DocumentRecord, RegistryData, IndexStatus } from "./types.js";
import { PageIndexMcpError } from "../utils/errors.js";
import { logger } from "../logger.js";

const REGISTRY_VERSION = 1;

export class Registry {
  private registryPath: string;
  private writeLock: Promise<void> = Promise.resolve();
  private data: RegistryData | null = null;

  constructor(workspace: string) {
    this.registryPath = join(workspace, "registry.json");
  }

  private load(): RegistryData {
    if (this.data) return this.data;

    if (!existsSync(this.registryPath)) {
      this.data = { version: REGISTRY_VERSION, documents: {} };
      return this.data;
    }

    try {
      const raw = readFileSync(this.registryPath, "utf8");
      this.data = JSON.parse(raw) as RegistryData;
      return this.data;
    } catch (e) {
      throw new PageIndexMcpError(
        "REGISTRY_READ_FAILED",
        "Failed to read registry",
        String(e)
      );
    }
  }

  private async persist(): Promise<void> {
    const data = this.load();
    const tmpPath = this.registryPath + ".tmp";
    try {
      const dir = dirname(this.registryPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
      renameSync(tmpPath, this.registryPath);
    } catch (e) {
      throw new PageIndexMcpError(
        "REGISTRY_WRITE_FAILED",
        "Failed to write registry",
        String(e)
      );
    }
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeLock = this.writeLock.then(fn).catch((e) => {
      logger.error("Registry write error", e);
    });
    return this.writeLock;
  }

  generateId(): string {
    return randomUUID();
  }

  get(documentId: string): DocumentRecord | null {
    const data = this.load();
    return data.documents[documentId] ?? null;
  }

  getByHash(fileHash: string): DocumentRecord | null {
    const data = this.load();
    return Object.values(data.documents).find((d) => d.fileHash === fileHash) ?? null;
  }

  list(filter?: { status?: IndexStatus; limit?: number; offset?: number }): {
    documents: DocumentRecord[];
    total: number;
  } {
    const data = this.load();
    let docs = Object.values(data.documents);

    if (filter?.status) {
      docs = docs.filter((d) => d.indexStatus === filter.status);
    }

    const total = docs.length;
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 50;
    docs = docs.slice(offset, offset + limit);

    return { documents: docs, total };
  }

  async upsert(record: DocumentRecord): Promise<void> {
    return this.enqueue(async () => {
      const data = this.load();
      data.documents[record.documentId] = record;
      await this.persist();
    });
  }

  async updateStatus(
    documentId: string,
    status: IndexStatus,
    extra?: Partial<DocumentRecord>
  ): Promise<void> {
    return this.enqueue(async () => {
      const data = this.load();
      const existing = data.documents[documentId];
      if (!existing) return;
      data.documents[documentId] = {
        ...existing,
        ...extra,
        indexStatus: status,
        updatedAt: new Date().toISOString(),
      };
      await this.persist();
    });
  }

  async remove(documentId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue(async () => {
        const data = this.load();
        if (!data.documents[documentId]) {
          resolve(false);
          return;
        }
        delete data.documents[documentId];
        await this.persist();
        resolve(true);
      });
    });
  }

  createRecord(
    params: Pick<
      DocumentRecord,
      "documentId" | "sourcePath" | "workspacePath" | "fileName" | "fileType" | "fileHash" | "pageindexOptions"
    > & { modelUsed?: string | null }
  ): DocumentRecord {
    const now = new Date().toISOString();
    return {
      ...params,
      modelUsed: params.modelUsed ?? null,
      createdAt: now,
      updatedAt: now,
      indexStatus: "pending",
      treePath: null,
      metadataPath: null,
      lastError: null,
    };
  }

  /** Invalidate in-memory cache so next read hits disk */
  invalidate(): void {
    this.data = null;
  }
}

let _registry: Registry | null = null;

export function getRegistry(workspace: string): Registry {
  if (!_registry) {
    _registry = new Registry(workspace);
  }
  return _registry;
}

export function resetRegistry(): void {
  _registry = null;
}
