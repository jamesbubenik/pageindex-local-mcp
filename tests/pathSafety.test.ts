import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  resolveAndValidatePath,
  validateFileExtension,
  isPathSafe,
  sanitizeDocumentId,
} from "../src/pageindex/pathSafety.js";
import { PageIndexMcpError } from "../src/utils/errors.js";

describe("resolveAndValidatePath", () => {
  it("accepts a path with no allowed roots configured", () => {
    const result = resolveAndValidatePath("/home/user/document.pdf", []);
    expect(result).toBe(resolve("/home/user/document.pdf"));
  });

  it("accepts a path within allowed roots", () => {
    const result = resolveAndValidatePath("/home/user/docs/file.pdf", ["/home/user/docs"]);
    expect(result).toBeTruthy();
  });

  it("rejects a path outside allowed roots", () => {
    expect(() =>
      resolveAndValidatePath("/etc/passwd", ["/home/user/docs"])
    ).toThrow(PageIndexMcpError);
  });

  it("rejects path traversal attempts (../../etc/passwd)", () => {
    expect(() =>
      resolveAndValidatePath("/home/user/docs/../../etc/passwd", ["/home/user/docs"])
    ).toThrow(PageIndexMcpError);
  });

  it("resolves relative ../ components before checking roots", () => {
    // /home/user/docs/../../../etc resolves to /etc, outside allowed root
    expect(() =>
      resolveAndValidatePath("/home/user/docs/../../../etc/shadow", ["/home/user/docs"])
    ).toThrow(PageIndexMcpError);
  });
});

describe("validateFileExtension", () => {
  it("accepts .pdf", () => {
    expect(validateFileExtension("document.pdf")).toBe("pdf");
  });

  it("accepts .md", () => {
    expect(validateFileExtension("README.md")).toBe("md");
  });

  it("accepts .markdown", () => {
    expect(validateFileExtension("notes.markdown")).toBe("md");
  });

  it("is case-insensitive", () => {
    expect(validateFileExtension("REPORT.PDF")).toBe("pdf");
  });

  it("rejects .txt", () => {
    expect(() => validateFileExtension("notes.txt")).toThrow(PageIndexMcpError);
  });

  it("rejects .exe", () => {
    expect(() => validateFileExtension("malware.exe")).toThrow(PageIndexMcpError);
  });

  it("rejects no extension", () => {
    expect(() => validateFileExtension("noextension")).toThrow(PageIndexMcpError);
  });
});

describe("isPathSafe", () => {
  it("returns true for normal paths", () => {
    expect(isPathSafe("/home/user/document.pdf")).toBe(true);
  });

  it("returns false for null-byte injection", () => {
    expect(isPathSafe("/home/user/file\0.pdf")).toBe(false);
  });
});

describe("sanitizeDocumentId", () => {
  it("accepts valid IDs", () => {
    expect(sanitizeDocumentId("abc-123_DEF")).toBe("abc-123_DEF");
  });

  it("accepts UUID format", () => {
    expect(sanitizeDocumentId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
  });

  it("rejects IDs with slashes", () => {
    expect(() => sanitizeDocumentId("../../etc/passwd")).toThrow(PageIndexMcpError);
  });

  it("rejects IDs with spaces", () => {
    expect(() => sanitizeDocumentId("my doc id")).toThrow(PageIndexMcpError);
  });
});
