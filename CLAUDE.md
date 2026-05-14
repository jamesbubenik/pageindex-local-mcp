# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`pageindex-local-mcp` is a local-first MCP server that wraps a self-hosted [PageIndex](https://github.com/VectifyAI/PageIndex) installation, exposing 8 MCP tools for indexing and querying local PDF/Markdown files without any cloud API dependency.

## Key Commands

```bash
npm run build          # compile TypeScript → dist/
npm run typecheck      # type-check without emitting
npm test               # run vitest unit tests (36 tests)
npm run dev            # run server from source via tsx (requires .env)
npm run smoke:health   # check PageIndex/Python/LLM config
npm run smoke:index -- /absolute/path/to/file.pdf
npm run smoke:list
npm run smoke:query -- "What is this document about?"
```

## Architecture

**ESM TypeScript** (`"type": "module"`, `NodeNext` resolution). All relative imports in `src/` use `.js` extensions.

### Source layout

```
src/
  index.ts              — entry point, loads config, starts server
  config.ts             — env var config with singleton + resetConfig() for tests
  logger.ts             — stderr-only logger (stdout is reserved for MCP protocol)
  mcp/
    server.ts           — MCP Server with all 8 tool handlers (CallToolRequestSchema)
    tools.ts            — Zod input schemas + TOOL_DEFINITIONS array (JSON Schema for MCP)
  pageindex/
    types.ts            — all TypeScript interfaces (DocumentRecord, TreeNode, etc.)
    cliAdapter.ts       — CliAdapter class: wraps run_pageindex.py, discovers output tree
    registry.ts         — JSON registry with atomic writes (tmp → rename), write queue
    queryEngine.ts      — tree traversal query engine using OpenAI-compatible fetch()
    pathSafety.ts       — path resolution, allowed-roots check (resolve() both sides), extension validation
  utils/
    errors.ts           — PageIndexMcpError class with error codes
    fileHash.ts         — sha256File() streaming hash
    shell.ts            — runCommand() using child_process.spawn (shell: false always)
```

### How PageIndex CLI interaction works

1. `CliAdapter` calls `run_pageindex.py` via `runCommand()` with `cwd = PAGEINDEX_REPO_PATH`
2. Output is saved by PageIndex to `<PAGEINDEX_REPO_PATH>/results/<basename>_structure.json`
3. Source file is copied to `<workspace>/documents/<id>/original/source.{pdf,md}` — so the output filename is always `source_structure.json`
4. The tree JSON is then copied to `<workspace>/documents/<id>/index/tree.json`

### Query engine

Vectorless, LLM-driven tree traversal:
1. Load `tree.json` from workspace
2. Present top-level nodes to local LLM → get `{relevant_ids, reasons}` JSON
3. Recurse into children of selected nodes (up to 3 levels deep)
4. Collect leaf/near-leaf nodes as results
5. Synthesize answer from selected node summaries/text

LLM calls use `fetch()` to the OpenAI-compatible `/v1/chat/completions` endpoint with `temperature: 0`.

### Registry

Single `registry.json` file under workspace. Writes are serialized via a promise chain (`writeLock`). Atomic: write to `.tmp` then `renameSync`. In-memory cache invalidated via `invalidate()`.

### Security invariants

- `shell.ts` always passes `shell: false` to `spawn()`
- `pathSafety.ts` resolves both the input path and each allowed root with `resolve()` before comparing (handles drive letters on Windows)
- Document IDs are validated with `/^[a-zA-Z0-9_-]+$/` before use in filesystem paths

# Agent Instructions

You're working inside the **WAT framework** (Workflows, Agents, Tools). This architecture separates concerns so that probabilistic AI handles reasoning while deterministic code handles execution. That separation is what makes this system reliable.

## The WAT Architecture

**Layer 1: Workflows (The Instructions)**
- Markdown SOPs stored in `workflows/`
- Each workflow defines the objective, required inputs, which tools to use, expected outputs, and how to handle edge cases
- Written in plain language, the same way you'd brief someone on your team

**Layer 2: Agents (The Decision-Maker)**
- This is your role. You're responsible for intelligent coordination.
- Read the relevant workflow, run tools in the correct sequence, handle failures gracefully, and ask clarifying questions when needed
- You connect intent to execution without trying to do everything yourself
- Example: If you need to pull data from a website, don't attempt it directly. Read `workflows/scrape_website.md`, figure out the required inputs, then execute `tools/scrape_single_site.py`

**Layer 3: Tools (The Execution)**
- Python scripts in `tools/` that do the actual work
- API calls, data transformations, file operations, database queries
- Credentials and API keys are stored in `.env`
- These scripts are consistent, testable, and fast

**Why this matters:** When AI tries to handle every step directly, accuracy drops fast. If each step is 90% accurate, you're down to 59% success after just five steps. By offloading execution to deterministic scripts, you stay focused on orchestration and decision-making where you excel.

## How to Operate

**1. Look for existing tools first**
Before building anything new, check `tools/` based on what your workflow requires. Only create new scripts when nothing exists for that task.

**2. Learn and adapt when things fail**
- Read the full error message and trace
- Fix the script and retest (if it uses paid API calls and credits, check with me before running again)
- Document what you learned in the workflow (rate limits, timing quirks, unexpected behavior)
- Example: You get rate-limited on an API, so you dig into the docs, discover a batch endpoint, refactor the tool to use it, verify it works, then update the workflow so this never happens again

**3. Keep workflows current**
Workflows should evolve as you learn. When you find better methods, discover constraints, or encounter recurring issues, update the workflow. That said, don't create or overwrite workflows without asking unless I explicitly tell you to. These are my instructions and need to be preserved and refined, not tossed after one use.

## The Self-Improvement Loop

Every failure is a chance to make the system stronger:
1. Identify what broke
2. Fix the tool
3. Verify the fix works
4. Update the workflow with the new approach
5. Move on with a more robust system

This loop is how the framework improves over time.

## File Structure

**What goes where:**
- **Deliverables**: Final outputs go to cloud services (Google Sheets, Slides, etc.) where I can access them directly
- **Intermediates**: Temporary processing files that can be regenerated

**Directory layout:**
```
.tmp/          # Temporary files (scraped data, intermediate exports). Regenerated as needed.
tools/         # Python scripts for deterministic execution
workflows/     # Markdown SOPs defining what to do and how
.env           # API keys and environment variables (NEVER store secrets anywhere else)
credentials.json, token.json  # Google OAuth (gitignored)
```

**Core principle:** Local files are just for processing. Anything I need to see or use lives in cloud services. Everything in `.tmp/` is disposable.

## Bottom line

You sit between what I want (workflows) and what actually gets done (tools). Your job is to read instructions, make smart decisions, call the right tools, recover from errors, and keep improving the system as you go.

Stay pragmatic. Stay reliable. Keep learning.
