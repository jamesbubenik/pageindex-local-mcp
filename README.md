# pageindex-local-mcp

A local-first MCP (Model Context Protocol) server for [PageIndex](https://github.com/VectifyAI/PageIndex) — the vectorless, reasoning-based RAG framework.

This server lets local AI agents (Claude Desktop, Cursor, Claude Code, Cline, Continue, OpenAI Agents SDK, LangChain, or any MCP-compatible client) index and query local PDF and Markdown documents through a self-hosted PageIndex installation, **without requiring any PageIndex cloud API key**.

---

> **Security Warning:** This MCP server exposes local file indexing and tree-query capabilities to MCP clients. Only connect trusted clients. Review `PAGEINDEX_ALLOWED_ROOTS` before deploying in shared environments.

---

## What This Project Does

- Wraps a locally installed PageIndex repository and exposes its capabilities as MCP tools.
- Indexes local PDF and Markdown files by calling `run_pageindex.py` from the PageIndex repo.
- Builds and stores a hierarchical PageIndex tree structure for each document.
- Performs vectorless, reasoning-based document search over those trees using a local OpenAI-compatible LLM endpoint (LM Studio, Ollama, vLLM, etc.).
- Returns traceable results: document ID, node ID, title, summary, page/line range, reasoning path.
- Maintains a local document registry with full metadata.

## What This Project Does Not Do

- Does **not** call `https://api.pageindex.ai` or any PageIndex cloud API.
- Does **not** require a `PAGEINDEX_API_KEY`.
- Does **not** use vector databases or embeddings.
- Does **not** provide a web UI.
- Does **not** perform cloud OCR. Local PDF parsing quality depends on your PageIndex installation and the underlying Python PDF library (PyPDF2). Complex scanned PDFs may parse poorly compared to the cloud pipeline.

## How It Differs from the Official PageIndex MCP

| Feature | Official pageindex-mcp | This project |
|---|---|---|
| Backend | PageIndex Cloud API | Local PageIndex repo |
| API key required | Yes | No |
| Runs locally | No | Yes |
| Vector DB | No (tree-based) | No (tree-based) |
| LLM for indexing | Cloud models | Configurable local/remote |
| LLM for querying | Cloud models | Local OpenAI-compatible endpoint |
| OCR quality | Cloud (best) | Local (depends on PageIndex/PyPDF2) |

---

## Prerequisites

- **Node.js 18+** (for this MCP server)
- **Python 3.9+** (for the PageIndex repo)
- A **local clone of [VectifyAI/PageIndex](https://github.com/VectifyAI/PageIndex)** with dependencies installed
- A **local OpenAI-compatible LLM endpoint** (LM Studio, Ollama, vLLM) — required for both indexing (if PageIndex is configured to use it) and querying

---

## 1. Install the Local PageIndex Repository

```bash
git clone https://github.com/VectifyAI/PageIndex.git
cd PageIndex
pip install -r requirements.txt
```

PageIndex needs an LLM to generate tree structures. Configure it to use your local endpoint by editing `pageindex/config.yaml`:

```yaml
model: local-model           # must match what your local server loads
```

Or set the model via the `--model` argument at indexing time.

> **Note:** PageIndex's indexing currently calls LLM APIs. Point its config at your local endpoint (LM Studio, Ollama, vLLM) so no internet calls are made during indexing.

---

## 2. Install the MCP Server

```bash
git clone https://github.com/jamesbubenik/pageindex-local-mcp.git
cd pageindex-local-mcp
npm install
npm run build
```

---

## 3. Configure Environment Variables

Copy the example and edit:

```bash
cp examples/sample.env .env
# or: cp .env.example .env
```

Edit `.env`:

```dotenv
PAGEINDEX_REPO_PATH=/home/user/PageIndex
PAGEINDEX_PYTHON=python3
PAGEINDEX_WORKSPACE=/home/user/.pageindex-local-mcp
PAGEINDEX_LLM_BASE_URL=http://127.0.0.1:1234/v1
PAGEINDEX_LLM_API_KEY=lm-studio
PAGEINDEX_MODEL=local-model
```

### All Configuration Options

| Variable | Required | Default | Description |
|---|---|---|---|
| `PAGEINDEX_REPO_PATH` | **Yes** | — | Absolute path to cloned PageIndex repo |
| `PAGEINDEX_PYTHON` | No | `python3` | Python executable with PageIndex deps |
| `PAGEINDEX_WORKSPACE` | No | `~/.pageindex-local-mcp` | Where the MCP server stores artifacts |
| `PAGEINDEX_MODEL` | No | `local-model` | Default model name for indexing/querying |
| `PAGEINDEX_LLM_BASE_URL` | No | `http://127.0.0.1:1234/v1` | OpenAI-compatible endpoint for queries |
| `PAGEINDEX_LLM_API_KEY` | No | `local` | API key (any non-empty value for local servers) |
| `PAGEINDEX_LLM_TIMEOUT_MS` | No | `120000` | LLM request timeout (ms) |
| `PAGEINDEX_TOOL_TIMEOUT_MS` | No | `600000` | Max ms for a PageIndex Python subprocess. Raise for large PDFs or slow machines. |
| `PAGEINDEX_TOC_CHECK_PAGES` | No | `20` | Pages scanned for TOC (PDF only) |
| `PAGEINDEX_MAX_PAGES_PER_NODE` | No | `10` | Max pages per tree node (PDF only) |
| `PAGEINDEX_MAX_TOKENS_PER_NODE` | No | `20000` | Max tokens per tree node |
| `PAGEINDEX_ALLOWED_ROOTS` | No | `""` (all) | Semicolon (Win) or colon (Unix) separated allowed dirs |
| `PAGEINDEX_REGISTRY_BACKEND` | No | `json` | `json` (supported) or `sqlite` (future) |
| `PAGEINDEX_LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |

---

## 4. Configure Your MCP Client

### Claude Desktop

**macOS/Linux** — config file: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux)

```json
{
  "mcpServers": {
    "pageindex-local": {
      "command": "node",
      "args": ["/home/user/pageindex-local-mcp/dist/index.js"],
      "env": {
        "PAGEINDEX_REPO_PATH": "/home/user/PageIndex",
        "PAGEINDEX_PYTHON": "python3",
        "PAGEINDEX_WORKSPACE": "/home/user/.pageindex-local-mcp",
        "PAGEINDEX_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
        "PAGEINDEX_LLM_API_KEY": "lm-studio",
        "PAGEINDEX_MODEL": "local-model",
        "PAGEINDEX_ALLOWED_ROOTS": "/home/user/Documents:/home/user/Downloads"
      }
    }
  }
}
```

**Windows** — config file: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pageindex-local": {
      "command": "node",
      "args": ["C:\\Users\\user\\pageindex-local-mcp\\dist\\index.js"],
      "env": {
        "PAGEINDEX_REPO_PATH": "C:\\Users\\user\\PageIndex",
        "PAGEINDEX_PYTHON": "C:\\Users\\user\\miniconda3\\envs\\pageindex\\python.exe",
        "PAGEINDEX_WORKSPACE": "C:\\Users\\user\\.pageindex-local-mcp",
        "PAGEINDEX_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
        "PAGEINDEX_LLM_API_KEY": "lm-studio",
        "PAGEINDEX_MODEL": "local-model",
        "PAGEINDEX_ALLOWED_ROOTS": "C:\\Users\\user\\Documents;C:\\Users\\user\\Downloads"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "pageindex-local": {
      "command": "node",
      "args": ["/home/user/pageindex-local-mcp/dist/index.js"],
      "env": {
        "PAGEINDEX_REPO_PATH": "/home/user/PageIndex",
        "PAGEINDEX_PYTHON": "python3",
        "PAGEINDEX_WORKSPACE": "/home/user/.pageindex-local-mcp",
        "PAGEINDEX_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
        "PAGEINDEX_LLM_API_KEY": "lm-studio",
        "PAGEINDEX_MODEL": "local-model"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.claude/settings.json` under `mcpServers`, using the same format as Cursor above.

### LM Studio (as MCP client)

LM Studio 0.3.17+ can act as an MCP host, meaning it can call this server's tools directly from its chat UI — no separate MCP client needed.

> **Note:** This section is about using LM Studio as the **MCP client**. For using LM Studio as the **LLM backend** for indexing and querying, see [Section 5](#5-lm-studio-setup) below.

**Requirements:**
- LM Studio 0.3.17 or later
- A tool-use-capable model loaded in LM Studio (e.g., Mistral Nemo Instruct, Qwen2.5 Instruct, LLaMA 3.1 Instruct, Gemma 3). Pure base models will not invoke tools reliably.

**Step 1 — Edit `mcp.json`**

Open LM Studio, switch to the **Program** tab in the right sidebar, then click **Install → Edit mcp.json**. This opens the config file in LM Studio's built-in editor.

The file lives at:
- **macOS / Linux:** `~/.lmstudio/mcp.json`
- **Windows:** `%USERPROFILE%\.lmstudio\mcp.json`

**Step 2 — Add the server**

Paste the following, adjusting paths for your system:

**macOS / Linux:**
```json
{
  "mcpServers": {
    "pageindex-local": {
      "command": "node",
      "args": ["/home/user/pageindex-local-mcp/dist/index.js"],
      "timeout": 600,
      "env": {
        "PAGEINDEX_REPO_PATH": "/home/user/PageIndex",
        "PAGEINDEX_PYTHON": "python3",
        "PAGEINDEX_WORKSPACE": "/home/user/.pageindex-local-mcp",
        "PAGEINDEX_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
        "PAGEINDEX_LLM_API_KEY": "lm-studio",
        "PAGEINDEX_MODEL": "your-loaded-model-name",
        "PAGEINDEX_TOOL_TIMEOUT_MS": "600000",
        "PAGEINDEX_LOG_LEVEL": "info"
      }
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "pageindex-local": {
      "command": "node",
      "args": ["C:\\Users\\user\\pageindex-local-mcp\\dist\\index.js"],
      "timeout": 600,
      "env": {
        "PAGEINDEX_REPO_PATH": "C:\\Users\\user\\PageIndex",
        "PAGEINDEX_PYTHON": "C:\\Users\\user\\miniconda3\\envs\\pageindex\\python.exe",
        "PAGEINDEX_WORKSPACE": "C:\\Users\\user\\.pageindex-local-mcp",
        "PAGEINDEX_LLM_BASE_URL": "http://127.0.0.1:1234/v1",
        "PAGEINDEX_LLM_API_KEY": "lm-studio",
        "PAGEINDEX_MODEL": "your-loaded-model-name",
        "PAGEINDEX_TOOL_TIMEOUT_MS": "600000",
        "PAGEINDEX_LOG_LEVEL": "info"
      }
    }
  }
}
```

Set `PAGEINDEX_MODEL` to the exact model name shown in LM Studio's server status bar (e.g., `mistral-nemo-instruct-2407`). Save the file — LM Studio picks up changes immediately.

**Timeout configuration**

`pageindex_local_index_document` and `pageindex_local_reindex_document` now run indexing in the **background** — the tool call returns in under a second with `status: "indexing"` and a `documentId`. The Python subprocess continues running server-side, and you poll `pageindex_local_get_document` until status changes to `"indexed"` or `"failed"`. This completely eliminates client-side `-32001` timeout errors for indexing.

`pageindex_local_search` is still synchronous. For very large document trees, you can raise the client timeout:

| Setting | Where | What it controls |
|---|---|---|
| `"timeout": 600` | `mcp.json` (Cursor-notation) | Client-side wait in seconds. |
| `PAGEINDEX_TOOL_TIMEOUT_MS=600000` | `env` block or `.env` file | Server-side subprocess limit (milliseconds). |

**Step 3 — Enable tool use**

Go to **App Settings → Tools & Integrations** and ensure tool calling is enabled. You can allow individual tools once or permanently when the confirmation dialog appears.

**Step 4 — Start the LM Studio local server**

The MCP server's query engine calls LM Studio's OpenAI-compatible endpoint (`http://127.0.0.1:1234/v1`) to reason over document trees. Make sure the local server is running: **Developer tab → Start Server** (default port 1234).

**Step 5 — Chat with your documents**

Load a tool-capable model, open a new chat, and ask naturally:

```
Index the file at /home/user/Documents/research-paper.pdf
```
```
Search my indexed documents for information about climate feedback loops
```
```
List all my indexed documents
```

When the model decides to call a tool, LM Studio will show a confirmation dialog with the tool name and arguments. Review and approve. Results are returned inline in the chat.

> **Tip:** Run `pageindex_local_health` first to confirm the server, PageIndex repo, and Python environment are all reachable before attempting to index.

---

## 5. LM Studio Setup

1. Download and install [LM Studio](https://lmstudio.ai/).
2. Load a model (e.g., Mistral 7B Instruct, LLaMA 3, Qwen 2.5).
3. Start the local server: **Server tab → Start Server** (default port 1234).
4. Set:
   ```dotenv
   PAGEINDEX_LLM_BASE_URL=http://127.0.0.1:1234/v1
   PAGEINDEX_LLM_API_KEY=lm-studio
   PAGEINDEX_MODEL=<model-name-from-lm-studio>
   ```

### Ollama Setup

```bash
ollama serve
ollama pull llama3
```

```dotenv
PAGEINDEX_LLM_BASE_URL=http://127.0.0.1:11434/v1
PAGEINDEX_LLM_API_KEY=ollama
PAGEINDEX_MODEL=llama3
```

---

## 6. Using the MCP Tools

### Check Health

```
pageindex_local_health
```

Verifies the PageIndex repo, Python, workspace, and LLM config. Run this first.

### Index a PDF

Indexing runs in the background. The tool returns immediately with `status: "indexing"` and a `documentId`. Poll `pageindex_local_get_document` until status is `"indexed"` (or `"failed"`).

```json
{
  "tool": "pageindex_local_index_document",
  "arguments": {
    "path": "/home/user/Documents/research-paper.pdf",
    "addNodeSummary": true,
    "addNodeId": true,
    "addDocDescription": true
  }
}
```

Response:
```json
{
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "indexing",
  "fileName": "research-paper.pdf",
  "message": "Indexing started in the background. Call pageindex_local_get_document with this documentId to poll for status."
}
```

Then poll:
```json
{ "tool": "pageindex_local_get_document", "arguments": { "documentId": "550e8400-..." } }
```

Index with node text (larger output, enables source text in search results):
```json
{
  "path": "/home/user/Documents/research-paper.pdf",
  "addNodeText": true
}
```

### Index a Markdown File

```json
{
  "tool": "pageindex_local_index_document",
  "arguments": {
    "path": "/home/user/notes/project-spec.md"
  }
}
```

### List Indexed Documents

```json
{
  "tool": "pageindex_local_list_documents",
  "arguments": { "status": "indexed", "limit": 20 }
}
```

### Get Tree Structure

```json
{
  "tool": "pageindex_local_get_tree",
  "arguments": {
    "documentId": "550e8400-e29b-41d4-a716-446655440000",
    "maxDepth": 3
  }
}
```

### Query (Vectorless Search)

```json
{
  "tool": "pageindex_local_search",
  "arguments": {
    "query": "What are the main conclusions about climate change?",
    "maxResults": 5,
    "includeReasoningPath": true
  }
}
```

Search across specific documents:
```json
{
  "query": "What is the recommended dosage?",
  "documentIds": ["doc-id-1", "doc-id-2"],
  "includeSourceText": true
}
```

### Remove a Document

```json
{
  "tool": "pageindex_local_remove_document",
  "arguments": {
    "documentId": "550e8400-e29b-41d4-a716-446655440000",
    "deleteFiles": true
  }
}
```

### Re-index a Document

Like `index_document`, this returns immediately with `status: "indexing"`. Poll `pageindex_local_get_document` for completion.

```json
{
  "tool": "pageindex_local_reindex_document",
  "arguments": {
    "documentId": "550e8400-e29b-41d4-a716-446655440000",
    "addNodeText": true
  }
}
```

---

## 7. Workspace Layout

The server stores all artifacts under `PAGEINDEX_WORKSPACE`:

```
~/.pageindex-local-mcp/
  registry.json                       ← document registry
  documents/
    <document-id>/
      original/
        source.pdf                    ← copy of original file
      index/
        tree.json                     ← PageIndex tree structure
        metadata.json                 ← indexing metadata
        stdout.log                    ← PageIndex stdout
        stderr.log                    ← PageIndex stderr
      queries/
        <query-id>.json               ← query results (future)
```

---

## 8. Development and Testing

```bash
# Type-check only
npm run typecheck

# Run tests
npm test

# Run smoke tests (requires configured .env and PageIndex repo)
npm run smoke:health
npm run smoke:index -- /absolute/path/to/document.pdf
npm run smoke:list
npm run smoke:query -- "What is this document about?"

# Dev mode (runs from TypeScript source, no build needed)
npm run dev
```

---

## 9. Troubleshooting

**`run_pageindex.py` not found**
Verify `PAGEINDEX_REPO_PATH` points to the root of the cloned PageIndex repository and that `run_pageindex.py` exists there.

**Python import errors during indexing**
Make sure the PageIndex Python dependencies are installed in the Python environment pointed to by `PAGEINDEX_PYTHON`:
```bash
pip install -r /path/to/PageIndex/requirements.txt
```

**Tree file not found after indexing**
PageIndex saves output to `<PAGEINDEX_REPO_PATH>/results/<filename>_structure.json`. If your version saves elsewhere, check `stdout.log` in the document workspace for the actual output path and open an issue.

**LLM connection failed during search**
Verify your local LLM server is running and that `PAGEINDEX_LLM_BASE_URL` is correct. Test manually:
```bash
curl http://127.0.0.1:1234/v1/models
```

**File outside allowed roots**
Add the file's parent directory to `PAGEINDEX_ALLOWED_ROOTS` in your environment config.

**Low-quality indexing results on scanned PDFs**
PageIndex uses PyPDF2 for local PDF parsing, which does not perform OCR. Scanned PDFs without embedded text will produce poor results. For scanned documents, consider pre-processing with an OCR tool or using the PageIndex cloud service.

**`MCP error -32001: Request timed out` during search**
Indexing no longer blocks — it runs in the background and returns immediately, so this error should not occur for `index_document` or `reindex_document`. If you still see it during `pageindex_local_search` (which is synchronous), add `"timeout": 600` to your `mcp.json` server entry and set `PAGEINDEX_TOOL_TIMEOUT_MS=600000` in the `env` block.

**MCP server logs**
All logs go to stderr (not stdout, which is reserved for the MCP protocol). Check your MCP client's stderr console or increase log level:
```dotenv
PAGEINDEX_LOG_LEVEL=debug
```

---

## 10. Security Notes

- **`PAGEINDEX_ALLOWED_ROOTS`**: When set, only files within these directories can be indexed. Always configure this in shared or multi-user environments.
- **No shell interpolation**: All Python subprocess calls use argument arrays (`shell: false`). Path arguments are never interpolated into shell strings.
- **No cloud calls**: This server never contacts `api.pageindex.ai`, `chat.pageindex.ai`, or any PageIndex cloud endpoint.
- **Secrets**: Never place API keys in document paths or document IDs. All config comes from environment variables.
- **Trusted clients only**: The MCP protocol grants tool invocation to any connected client. Run this server only in trusted local environments.

---

## 11. Known Limitations

- **SQLite registry backend**: The `sqlite` option for `PAGEINDEX_REGISTRY_BACKEND` is planned but not yet implemented. Use the default `json` backend.
- **Concurrent indexing**: Only one indexing job should run per server instance at a time. Concurrent calls are not prevented but may produce race conditions in the registry.
- **Source text extraction**: Full source text in search results (`includeSourceText: true`) only works when the document was indexed with `addNodeText: true`. Otherwise, results include node summaries only.
- **Markdown line references**: PageIndex uses line numbers (not pages) for Markdown files. Search results will show line ranges instead of page numbers.
- **Large documents**: Indexing very large PDFs may exceed LLM context windows. Adjust `maxPagesPerNode` and `maxTokensPerNode` to reduce node size.
- **Model compatibility**: The query engine uses a simple JSON-structured prompt. Some smaller local models may not reliably output valid JSON. Use instruction-tuned models (Mistral Instruct, LLaMA Instruct, Qwen Instruct, etc.).

---

## MCP Tools Reference

| Tool | Description |
|---|---|
| `pageindex_local_health` | Check configuration and connectivity |
| `pageindex_local_index_document` | Index a local PDF or Markdown file |
| `pageindex_local_list_documents` | List all registered documents |
| `pageindex_local_get_document` | Get full metadata for one document |
| `pageindex_local_get_tree` | Retrieve the PageIndex tree structure |
| `pageindex_local_search` | Vectorless reasoning-based search |
| `pageindex_local_remove_document` | Remove a document from the registry |
| `pageindex_local_reindex_document` | Re-run indexing for an existing document |

---

## License

MIT
