import { spawn } from "node:child_process";
import type { CommandResult } from "../pageindex/types.js";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** If true, don't throw on non-zero exit code */
  allowFailure?: boolean;
}

export async function runCommand(
  executable: string,
  args: string[],
  options: RunOptions = {}
): Promise<CommandResult> {
  const start = Date.now();
  const { cwd, env, timeoutMs = 300_000, allowFailure = false } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const exitCode = code ?? 1;
      const durationMs = Date.now() - start;

      if (timedOut) {
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${executable} ${args.join(" ")}`));
        return;
      }

      const result: CommandResult = { exitCode, stdout, stderr, success: exitCode === 0, durationMs };

      if (!allowFailure && exitCode !== 0) {
        const err = new Error(
          `Command failed (exit ${exitCode}): ${executable} ${args.join(" ")}\n${stderr || stdout}`
        );
        Object.assign(err, { result });
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/** Quick check: can we call the executable at all? */
export async function checkExecutable(executable: string): Promise<boolean> {
  try {
    const result = await runCommand(executable, ["--version"], { allowFailure: true, timeoutMs: 10_000 });
    return result.exitCode === 0 || result.stdout.length > 0 || result.stderr.length > 0;
  } catch {
    return false;
  }
}
