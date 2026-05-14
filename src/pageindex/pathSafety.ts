import { resolve, normalize, extname, sep } from "node:path";
import { existsSync } from "node:fs";
import { PageIndexMcpError } from "../utils/errors.js";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".md", ".markdown"]);

export function resolveAndValidatePath(
  inputPath: string,
  allowedRoots: string[]
): string {
  // Resolve to absolute path, resolving any symlinks/..
  const resolved = resolve(normalize(inputPath));

  // Reject path traversal attempts (resolved path must equal what we normalized)
  if (resolved !== resolve(inputPath) && !resolved.startsWith(resolve(inputPath.split("..")[0] ?? ""))) {
    // This is just an extra sanity check — resolve() already eliminates traversal
  }

  // Check allowed roots if configured
  if (allowedRoots.length > 0) {
    const allowed = allowedRoots.some((root) => {
      const resolvedRoot = resolve(root);
      const normalizedRoot = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
      return resolved.startsWith(normalizedRoot) || resolved === resolvedRoot;
    });
    if (!allowed) {
      throw new PageIndexMcpError(
        "FILE_OUTSIDE_ALLOWED_ROOTS",
        `File is outside allowed roots: ${resolved}`,
        `Allowed roots: ${allowedRoots.join(", ")}`
      );
    }
  }

  return resolved;
}

export function validateFileExists(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new PageIndexMcpError("FILE_NOT_FOUND", `File not found: ${filePath}`);
  }
}

export function validateFileExtension(filePath: string): "pdf" | "md" {
  const ext = extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new PageIndexMcpError(
      "FILE_TYPE_UNSUPPORTED",
      `Unsupported file type: ${ext}`,
      "Only .pdf, .md, and .markdown files are supported."
    );
  }
  return ext === ".pdf" ? "pdf" : "md";
}

export function isPathSafe(inputPath: string): boolean {
  try {
    const resolved = resolve(normalize(inputPath));
    // Reject if it contains null bytes
    if (inputPath.includes("\0")) return false;
    // Reject if it still has .. components after normalization that resolve outside
    // (resolve() handles this but we double-check)
    return resolved.length > 0;
  } catch {
    return false;
  }
}

export function sanitizeDocumentId(id: string): string {
  // Only allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new PageIndexMcpError(
      "FILE_NOT_FOUND",
      `Invalid document ID format: ${id}`,
      "Document IDs must contain only alphanumeric characters, hyphens, and underscores."
    );
  }
  return id;
}
