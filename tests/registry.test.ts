import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry, resetRegistry } from "../src/pageindex/registry.js";
import type { DocumentRecord } from "../src/pageindex/types.js";

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "pitest-"));
}

function makeRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: "test-doc-1",
    sourcePath: "/tmp/test.pdf",
    workspacePath: "/tmp/workspace/test-doc-1",
    fileName: "test.pdf",
    fileType: "pdf",
    fileHash: "abc123",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    indexStatus: "indexed",
    treePath: "/tmp/workspace/test-doc-1/index/tree.json",
    metadataPath: "/tmp/workspace/test-doc-1/index/metadata.json",
    lastError: null,
    modelUsed: "local-model",
    pageindexOptions: {},
    ...overrides,
  };
}

describe("Registry", () => {
  let workspace: string;
  let registry: Registry;

  beforeEach(() => {
    resetRegistry();
    workspace = tmpWorkspace();
    registry = new Registry(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("starts empty", () => {
    const { documents, total } = registry.list();
    expect(documents).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("upserts and retrieves a document", async () => {
    const record = makeRecord();
    await registry.upsert(record);
    const retrieved = registry.get("test-doc-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.fileName).toBe("test.pdf");
  });

  it("persists to disk (registry.json)", async () => {
    const record = makeRecord();
    await registry.upsert(record);
    const registryPath = join(workspace, "registry.json");
    expect(existsSync(registryPath)).toBe(true);
  });

  it("finds document by hash", async () => {
    const record = makeRecord({ fileHash: "deadbeef" });
    await registry.upsert(record);
    const found = registry.getByHash("deadbeef");
    expect(found?.documentId).toBe("test-doc-1");
  });

  it("returns null for unknown hash", () => {
    expect(registry.getByHash("nonexistent")).toBeNull();
  });

  it("returns null for unknown ID", () => {
    expect(registry.get("nobody")).toBeNull();
  });

  it("lists with status filter", async () => {
    await registry.upsert(makeRecord({ documentId: "doc-a", indexStatus: "indexed" }));
    await registry.upsert(makeRecord({ documentId: "doc-b", indexStatus: "failed" }));
    const { documents: indexed } = registry.list({ status: "indexed" });
    expect(indexed).toHaveLength(1);
    expect(indexed[0].documentId).toBe("doc-a");
  });

  it("supports pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await registry.upsert(makeRecord({ documentId: `doc-${i}`, fileHash: `hash-${i}` }));
    }
    const { documents, total } = registry.list({ limit: 2, offset: 0 });
    expect(total).toBe(5);
    expect(documents).toHaveLength(2);
  });

  it("updates status", async () => {
    await registry.upsert(makeRecord({ indexStatus: "pending" }));
    await registry.updateStatus("test-doc-1", "indexed", { treePath: "/some/tree.json" });
    const updated = registry.get("test-doc-1");
    expect(updated?.indexStatus).toBe("indexed");
    expect(updated?.treePath).toBe("/some/tree.json");
  });

  it("removes a document", async () => {
    await registry.upsert(makeRecord());
    const removed = await registry.remove("test-doc-1");
    expect(removed).toBe(true);
    expect(registry.get("test-doc-1")).toBeNull();
  });

  it("returns false when removing non-existent document", async () => {
    const removed = await registry.remove("ghost");
    expect(removed).toBe(false);
  });

  it("reloads from disk on invalidate", async () => {
    const record = makeRecord();
    await registry.upsert(record);

    // Create a fresh registry pointing to the same workspace
    const registry2 = new Registry(workspace);
    const found = registry2.get("test-doc-1");
    expect(found?.fileName).toBe("test.pdf");
  });
});
