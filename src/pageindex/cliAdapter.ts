import { join, basename, extname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import type { Config } from "../config.js";
import type { CommandResult, HealthResult, IndexOptions } from "./types.js";
import { runCommand, checkExecutable } from "../utils/shell.js";
import { PageIndexMcpError } from "../utils/errors.js";
import { logger } from "../logger.js";

const RUN_SCRIPT = "run_pageindex.py";
const REQUIREMENTS_FILE = "requirements.txt";
const RESULTS_DIR = "results";

export class CliAdapter {
  constructor(private config: Config) {}

  private get repoPath(): string {
    return this.config.pageindexRepoPath;
  }

  private get python(): string {
    return this.config.python;
  }

  private get runScript(): string {
    return join(this.repoPath, RUN_SCRIPT);
  }

  /** Health check: verify repo, python, and workspace */
  async checkInstall(): Promise<HealthResult> {
    const warnings: string[] = [];

    if (!this.repoPath) {
      return {
        ok: false,
        server: { name: "pageindex-local-mcp", version: "0.1.0", workspace: this.config.workspace },
        pageindex: {
          repoPath: "(not set)",
          python: this.python,
          runPageIndexExists: false,
          requirementsDetected: false,
          version: null,
        },
        llm: { baseUrl: this.config.llmBaseUrl, model: this.config.model },
        warnings: ["PAGEINDEX_REPO_PATH is not configured."],
      };
    }

    const repoExists = existsSync(this.repoPath);
    const runScriptExists = existsSync(this.runScript);
    const requirementsExists = existsSync(join(this.repoPath, REQUIREMENTS_FILE));

    if (!repoExists) warnings.push(`PageIndex repo not found: ${this.repoPath}`);
    if (!runScriptExists) warnings.push(`run_pageindex.py not found in repo.`);
    if (!requirementsExists) warnings.push("requirements.txt not found in repo.");

    const pythonOk = await checkExecutable(this.python);
    if (!pythonOk) warnings.push(`Python executable not callable: ${this.python}`);

    // Get python version
    let pythonVersion: string | null = null;
    try {
      const r = await runCommand(this.python, ["--version"], { allowFailure: true, timeoutMs: 8_000 });
      pythonVersion = (r.stdout || r.stderr).trim();
    } catch {
      //
    }

    // Ensure workspace dir exists
    let workspaceOk = true;
    try {
      mkdirSync(this.config.workspace, { recursive: true });
    } catch {
      workspaceOk = false;
      warnings.push(`Could not create workspace: ${this.config.workspace}`);
    }

    if (!this.config.llmBaseUrl) warnings.push("PAGEINDEX_LLM_BASE_URL is not set. Query tool will fail.");

    const ok =
      repoExists &&
      runScriptExists &&
      pythonOk &&
      workspaceOk;

    return {
      ok,
      server: {
        name: "pageindex-local-mcp",
        version: "0.1.0",
        workspace: this.config.workspace,
      },
      pageindex: {
        repoPath: this.repoPath,
        python: pythonVersion ?? this.python,
        runPageIndexExists: runScriptExists,
        requirementsDetected: requirementsExists,
        version: null,
      },
      llm: {
        baseUrl: this.config.llmBaseUrl,
        model: this.config.model,
      },
      warnings,
    };
  }

  /**
   * Run run_pageindex.py for a PDF file.
   * Returns the CommandResult. Caller is responsible for locating output.
   */
  async indexPdf(options: {
    pdfPath: string;
    model?: string;
    tocCheckPages?: number;
    maxPagesPerNode?: number;
    maxTokensPerNode?: number;
    addNodeId?: boolean;
    addNodeSummary?: boolean;
    addDocDescription?: boolean;
    addNodeText?: boolean;
  }): Promise<CommandResult> {
    this.assertRepoReady();
    const args = this.buildPdfArgs(options);
    return this.runPython(args);
  }

  /**
   * Run run_pageindex.py for a Markdown file.
   */
  async indexMarkdown(options: {
    mdPath: string;
    model?: string;
    addNodeId?: boolean;
    addNodeSummary?: boolean;
    addDocDescription?: boolean;
    addNodeText?: boolean;
    ifThinning?: boolean;
    thinningThreshold?: number;
    summaryTokenThreshold?: number;
  }): Promise<CommandResult> {
    this.assertRepoReady();
    const args = this.buildMdArgs(options);
    return this.runPython(args);
  }

  /**
   * Run a Python command in the PageIndex repo directory.
   * Uses argument array (no shell interpolation) for safety.
   */
  async runPython(args: string[], extraEnv?: Record<string, string>): Promise<CommandResult> {
    this.assertRepoReady();
    logger.debug("Running python command", { python: this.python, args });
    try {
      return await runCommand(this.python, args, {
        cwd: this.repoPath,
        env: { ...this.getSubprocessEnv(), ...extraEnv },
        timeoutMs: this.config.toolTimeoutMs,
      });
    } catch (e: unknown) {
      const err = e as { result?: CommandResult; message?: string };
      if (err.result) return err.result; // already-structured failure
      throw new PageIndexMcpError("INDEX_FAILED", "Python execution failed", String(e));
    }
  }

  /**
   * Discover the tree JSON file generated by PageIndex for a given source file.
   * PageIndex saves output to: <repoPath>/results/<basename_no_ext>_structure.json
   */
  discoverGeneratedTree(sourceFileName: string): string {
    const base = basename(sourceFileName, extname(sourceFileName));
    return join(this.repoPath, RESULTS_DIR, `${base}_structure.json`);
  }

  /**
   * Copy the generated tree into the document workspace and return the new path.
   */
  async storeTreeInWorkspace(
    generatedTreePath: string,
    documentWorkspacePath: string
  ): Promise<string> {
    const indexDir = join(documentWorkspacePath, "index");
    mkdirSync(indexDir, { recursive: true });
    const destPath = join(indexDir, "tree.json");
    await copyFile(generatedTreePath, destPath);
    return destPath;
  }

  /** Copy source file into workspace original/ directory */
  async copySourceToWorkspace(sourcePath: string, documentWorkspacePath: string): Promise<string> {
    const originalDir = join(documentWorkspacePath, "original");
    mkdirSync(originalDir, { recursive: true });
    const ext = extname(sourcePath);
    const destPath = join(originalDir, `source${ext}`);
    await copyFile(sourcePath, destPath);
    return destPath;
  }

  /** Write stdout/stderr logs to document workspace */
  writeLogs(documentWorkspacePath: string, stdout: string, stderr: string): void {
    const indexDir = join(documentWorkspacePath, "index");
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, "stdout.log"), stdout, "utf8");
    writeFileSync(join(indexDir, "stderr.log"), stderr, "utf8");
  }

  // ---- Private helpers ----

  /**
   * litellm requires a provider-prefixed model name (e.g. "openai/my-model").
   * Auto-prefix with "openai/" when the name has no "/" for local endpoints.
   */
  private litellmModel(model: string): string {
    return model.includes("/") ? model : `openai/${model}`;
  }

  /**
   * Build env vars that litellm needs to reach the local LLM endpoint.
   * These are merged into the Python subprocess environment.
   */
  private getSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.config.llmBaseUrl) {
      env["OPENAI_API_BASE"] = this.config.llmBaseUrl;
      env["OPENAI_BASE_URL"] = this.config.llmBaseUrl;
    }
    if (this.config.llmApiKey) {
      env["OPENAI_API_KEY"] = this.config.llmApiKey;
    }
    return env;
  }

  private assertRepoReady(): void {
    if (!this.repoPath) {
      throw new PageIndexMcpError(
        "CONFIG_MISSING_PAGEINDEX_REPO",
        "PAGEINDEX_REPO_PATH is not configured."
      );
    }
    if (!existsSync(this.runScript)) {
      throw new PageIndexMcpError(
        "PAGEINDEX_RUNNER_NOT_FOUND",
        `run_pageindex.py not found at: ${this.runScript}`
      );
    }
  }

  private yesNo(val: boolean | undefined, defaultVal = true): string {
    return (val ?? defaultVal) ? "yes" : "no";
  }

  private buildPdfArgs(o: {
    pdfPath: string;
    model?: string;
    tocCheckPages?: number;
    maxPagesPerNode?: number;
    maxTokensPerNode?: number;
    addNodeId?: boolean;
    addNodeSummary?: boolean;
    addDocDescription?: boolean;
    addNodeText?: boolean;
  }): string[] {
    const c = this.config;
    const args = [RUN_SCRIPT, "--pdf_path", o.pdfPath];

    const model = o.model ?? c.model;
    if (model) args.push("--model", this.litellmModel(model));

    const toc = o.tocCheckPages ?? c.tocCheckPages;
    if (toc) args.push("--toc-check-pages", String(toc));

    const maxPages = o.maxPagesPerNode ?? c.maxPagesPerNode;
    if (maxPages) args.push("--max-pages-per-node", String(maxPages));

    const maxTokens = o.maxTokensPerNode ?? c.maxTokensPerNode;
    if (maxTokens) args.push("--max-tokens-per-node", String(maxTokens));

    args.push("--if-add-node-id", this.yesNo(o.addNodeId, true));
    args.push("--if-add-node-summary", this.yesNo(o.addNodeSummary, true));
    args.push("--if-add-doc-description", this.yesNo(o.addDocDescription, true));

    if (o.addNodeText !== undefined) {
      args.push("--if-add-node-text", this.yesNo(o.addNodeText, false));
    }

    return args;
  }

  private buildMdArgs(o: {
    mdPath: string;
    model?: string;
    addNodeId?: boolean;
    addNodeSummary?: boolean;
    addDocDescription?: boolean;
    addNodeText?: boolean;
    ifThinning?: boolean;
    thinningThreshold?: number;
    summaryTokenThreshold?: number;
  }): string[] {
    const c = this.config;
    const args = [RUN_SCRIPT, "--md_path", o.mdPath];

    const model = o.model ?? c.model;
    if (model) args.push("--model", this.litellmModel(model));

    args.push("--if-add-node-id", this.yesNo(o.addNodeId, true));
    args.push("--if-add-node-summary", this.yesNo(o.addNodeSummary, true));
    args.push("--if-add-doc-description", this.yesNo(o.addDocDescription, true));

    if (o.addNodeText !== undefined) {
      args.push("--if-add-node-text", this.yesNo(o.addNodeText, false));
    }

    if (o.ifThinning !== undefined) {
      args.push("--if-thinning", o.ifThinning ? "yes" : "no");
    }
    if (o.thinningThreshold !== undefined) {
      args.push("--thinning-threshold", String(o.thinningThreshold));
    }
    if (o.summaryTokenThreshold !== undefined) {
      args.push("--summary-token-threshold", String(o.summaryTokenThreshold));
    }

    return args;
  }
}
