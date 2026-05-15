import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  Config,
} from "../config.js";
import type {
  TreeNode,
  PageIndexTree,
  QueryOptions,
  QueryResult,
  SearchResultItem,
  ReasoningPathItem,
  LlmNodeSelection,
  FlatNode,
} from "./types.js";
import { PageIndexMcpError } from "../utils/errors.js";
import { logger } from "../logger.js";

const MAX_DEPTH = 4;
const MAX_NODES_PER_LEVEL = 20;

// ---- LLM client ----

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function llmChat(
  messages: ChatMessage[],
  config: Config,
  model?: string
): Promise<string> {
  const url = `${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: model ?? config.model,
    messages,
    temperature: 0,
    max_tokens: 2048,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
  } catch (e) {
    throw new PageIndexMcpError(
      "LLM_CONNECTION_FAILED",
      `Cannot reach LLM endpoint: ${url}`,
      String(e)
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PageIndexMcpError(
      "LLM_CONNECTION_FAILED",
      `LLM endpoint returned ${response.status}`,
      text
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

// ---- Tree utilities ----

function flattenTree(
  nodes: TreeNode[],
  depth = 0,
  parentId: string | null = null,
  path: ReasoningPathItem[] = []
): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes.slice(0, MAX_NODES_PER_LEVEL)) {
    result.push({ node, depth, parentId, path });
    if (node.children && node.children.length > 0 && depth < MAX_DEPTH) {
      const childPath: ReasoningPathItem[] = [
        ...path,
        {
          nodeId: node.id ?? "?",
          title: node.title ?? "Untitled",
          reason: "traversed",
        },
      ];
      result.push(...flattenTree(node.children, depth + 1, node.id ?? null, childPath));
    }
  }
  return result;
}

function truncateTree(node: TreeNode, maxDepth: number, currentDepth = 0): TreeNode {
  if (currentDepth >= maxDepth) {
    const { children: _dropped, ...rest } = node;
    return { ...rest, _truncated: true };
  }
  return {
    ...node,
    children: node.children?.map((c) => truncateTree(c, maxDepth, currentDepth + 1)),
  };
}

export function applyMaxDepth(tree: PageIndexTree, maxDepth?: number): PageIndexTree {
  if (!maxDepth) return tree;
  return {
    ...tree,
    children: tree.children?.map((c) => truncateTree(c, maxDepth - 1, 0)),
  };
}

function formatNodeList(nodes: TreeNode[]): string {
  return nodes
    .slice(0, MAX_NODES_PER_LEVEL)
    .map((n, i) => {
      const range =
        n.start_index != null
          ? `pages/lines ${n.start_index}–${n.end_index ?? n.start_index}`
          : "";
      const summary = n.summary ? ` | Summary: ${n.summary.slice(0, 200)}` : "";
      return `${i + 1}. [id: ${n.id ?? "?"}] "${n.title ?? "Untitled"}"${range ? ` | ${range}` : ""}${summary}`;
    })
    .join("\n");
}

function extractJson<T>(text: string, fallback: T): T {
  // Try to find JSON block
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

// ---- Selection prompts ----

async function selectRelevantNodes(
  nodes: TreeNode[],
  query: string,
  config: Config,
  model?: string
): Promise<Array<{ node: TreeNode; reason: string }>> {
  if (nodes.length === 0) return [];

  const prompt = `You are a document retrieval assistant selecting the most relevant sections for a user query.

Query: "${query}"

Document sections:
${formatNodeList(nodes)}

Return ONLY a JSON object with this exact structure:
{"relevant_ids": ["id1", "id2"], "reasons": {"id1": "why relevant", "id2": "why relevant"}}

Select only sections that likely contain an answer. If none are relevant, return {"relevant_ids": [], "reasons": {}}.`;

  let responseText = "";
  try {
    responseText = await llmChat(
      [{ role: "user", content: prompt }],
      config,
      model
    );
  } catch (e) {
    logger.warn("LLM selection failed, returning empty", { error: String(e) });
    return [];
  }

  const selection = extractJson<LlmNodeSelection>(responseText, {
    relevant_ids: [],
    reasons: {},
  });

  const selected: Array<{ node: TreeNode; reason: string }> = [];
  for (const id of selection.relevant_ids) {
    const node = nodes.find((n) => n.id === id || String(n.id) === String(id));
    if (node) {
      selected.push({ node, reason: selection.reasons[id] ?? "relevant" });
    }
  }
  return selected;
}

async function synthesizeAnswer(
  query: string,
  results: SearchResultItem[],
  config: Config,
  model?: string
): Promise<string> {
  if (results.length === 0) return "";

  const context = results
    .map((r) => {
      const lines = [`Section: "${r.title}"`, `Range: ${r.startIndex ?? "?"}–${r.endIndex ?? "?"}`];
      if (r.summary) lines.push(`Summary: ${r.summary}`);
      if (r.sourceText) lines.push(`Text: ${r.sourceText.slice(0, 800)}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = `Based only on the following retrieved document sections, answer the query concisely. Do not fabricate information not present in the sections.

Query: "${query}"

Retrieved sections:
${context}

Answer:`;

  try {
    return await llmChat([{ role: "user", content: prompt }], config, model);
  } catch {
    return "";
  }
}

// ---- Main query function ----

async function queryDocument(
  documentId: string,
  fileName: string,
  tree: PageIndexTree,
  options: QueryOptions,
  config: Config
): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const topNodes = tree.children ?? [];
  const topRelevant = await selectRelevantNodes(topNodes, options.query, config, options.model);
  logger.debug("Top-level relevant nodes", { documentId, count: topRelevant.length });

  const maxResults = options.maxResults ?? 10;

  for (const { node: topNode, reason: topReason } of topRelevant) {
    if (results.length >= maxResults) break;

    const basePath: ReasoningPathItem[] = [
      { nodeId: topNode.id ?? "?", title: topNode.title ?? "Untitled", reason: topReason },
    ];

    // If no children, this is a result
    if (!topNode.children || topNode.children.length === 0) {
      results.push(buildResult(documentId, fileName, topNode, basePath, options));
      continue;
    }

    // Drill into children
    const childRelevant = await selectRelevantNodes(
      topNode.children,
      options.query,
      config,
      options.model
    );

    if (childRelevant.length === 0) {
      // Fall back to the parent node itself
      results.push(buildResult(documentId, fileName, topNode, basePath, options));
      continue;
    }

    for (const { node: childNode, reason: childReason } of childRelevant) {
      if (results.length >= maxResults) break;

      const childPath: ReasoningPathItem[] = [
        ...basePath,
        { nodeId: childNode.id ?? "?", title: childNode.title ?? "Untitled", reason: childReason },
      ];

      // Drill one more level if children exist
      if (childNode.children && childNode.children.length > 0) {
        const grandchildRelevant = await selectRelevantNodes(
          childNode.children,
          options.query,
          config,
          options.model
        );

        if (grandchildRelevant.length > 0) {
          for (const { node: gcNode, reason: gcReason } of grandchildRelevant) {
            if (results.length >= maxResults) break;
            const gcPath: ReasoningPathItem[] = [
              ...childPath,
              { nodeId: gcNode.id ?? "?", title: gcNode.title ?? "Untitled", reason: gcReason },
            ];
            results.push(buildResult(documentId, fileName, gcNode, gcPath, options));
          }
          continue;
        }
      }

      results.push(buildResult(documentId, fileName, childNode, childPath, options));
    }
  }

  return results;
}

function buildResult(
  documentId: string,
  fileName: string,
  node: TreeNode,
  path: ReasoningPathItem[],
  options: QueryOptions
): SearchResultItem {
  return {
    documentId,
    fileName,
    nodeId: node.id ?? "?",
    title: node.title ?? "Untitled",
    summary: node.summary ?? null,
    startIndex: node.start_index ?? node.start_page ?? null,
    endIndex: node.end_index ?? node.end_page ?? null,
    sourceText: options.includeSourceText !== false && node.text ? node.text.slice(0, 2000) : null,
    reasoningPath: options.includeReasoningPath !== false ? path : [],
    score: null,
  };
}

// ---- Public API ----

export async function runQuery(
  documents: Array<{ documentId: string; fileName: string; treePath: string }>,
  options: QueryOptions,
  config: Config
): Promise<QueryResult> {
  const warnings: string[] = [];
  const allResults: SearchResultItem[] = [];

  for (const doc of documents) {
    if (!existsSync(doc.treePath)) {
      warnings.push(`Tree not found for document ${doc.documentId}, skipping.`);
      continue;
    }

    let tree: PageIndexTree;
    try {
      tree = JSON.parse(readFileSync(doc.treePath, "utf8")) as PageIndexTree;
    } catch (e) {
      warnings.push(`Failed to parse tree for ${doc.documentId}: ${e}`);
      continue;
    }

    if (!tree.children || tree.children.length === 0) {
      logger.warn("Document tree has no children", { documentId: doc.documentId });
      warnings.push(
        `EMPTY_TREE: Document "${doc.fileName}" (${doc.documentId}) has an empty index tree — ` +
        `no content sections were produced during indexing. ` +
        `Do NOT retry pageindex_local_search for this document. ` +
        `Call pageindex_local_reindex_document with this documentId to rebuild its index, then search again.`
      );
      continue;
    }

    let docResults: SearchResultItem[];
    try {
      docResults = await queryDocument(doc.documentId, doc.fileName, tree, options, config);
    } catch (e) {
      if (e instanceof PageIndexMcpError && e.code === "LLM_CONNECTION_FAILED") throw e;
      warnings.push(`Query failed for ${doc.documentId}: ${e}`);
      continue;
    }

    // Flag if results have no source text (only summaries available)
    if (docResults.some((r) => r.sourceText === null)) {
      warnings.push(
        `Results for ${doc.fileName} are based on node summaries. ` +
          `Re-index with --if-add-node-text yes for full source text.`
      );
    }

    allResults.push(...docResults);
  }

  // Limit total results
  const maxResults = options.maxResults ?? 10;
  const trimmed = allResults.slice(0, maxResults);

  // Save query result to workspace (best-effort)
  const queryId = randomUUID();

  let answerDraft: string | null = null;
  if (trimmed.length > 0) {
    try {
      answerDraft = await synthesizeAnswer(options.query, trimmed, config, options.model);
    } catch {
      warnings.push("Failed to synthesize answer draft.");
    }
  }

  return { query: options.query, results: trimmed, answerDraft, warnings };
}

export function loadTree(treePath: string): PageIndexTree {
  if (!existsSync(treePath)) {
    throw new PageIndexMcpError("TREE_NOT_FOUND", `Tree file not found: ${treePath}`);
  }
  try {
    return JSON.parse(readFileSync(treePath, "utf8")) as PageIndexTree;
  } catch (e) {
    throw new PageIndexMcpError("TREE_NOT_FOUND", `Failed to parse tree JSON: ${treePath}`, String(e));
  }
}
