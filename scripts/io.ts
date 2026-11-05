import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { z } from "zod";

/** Lowercase SHA-256 byte identity, shared by external artifact and notice receipts. */
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Repository automation resolves checked-in inputs independently of the caller's cwd. */
export const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Captured commands include binary CLI content downloads, exceeding Node's default 1 MiB. */
const captureLimit = 1024 * 1024 * 1024;

/** Injectable command boundary for artifact and publication tests without external mutations. */
export type Runner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => string;

/** Native probes distinguish an expected rejected operation from failure to execute. */
export interface CommandResult {
  /** Numeric process status; signal termination is an execution failure. */
  readonly exitCode: number;
  /** Unmodified output, including binary downloads. */
  readonly stdout: Buffer;
  /** Diagnostics kept separate from machine-readable stdout. */
  readonly stderr: Buffer;
}

/** Capture a native operation whose nonzero status may be part of the test contract. */
export function runResult(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
): CommandResult {
  const result = spawn.sync(command, [...args], {
    cwd,
    maxBuffer: captureLimit,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status === null)
    throw new Error(`${command} terminated by signal ${result.signal}`);
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Capture exact bytes, propagating execution and nonzero-exit failures. */
export function runBytes(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
): Buffer {
  const result = runResult(command, args, cwd, timeoutMs);
  if (result.exitCode !== 0)
    throw new Error(
      `${command} exited ${result.exitCode}: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
  return result.stdout;
}

/** Capture textual native-tool output; whitespace is not part of these contracts. */
export function run(
  command: string,
  args: readonly string[],
  cwd: string,
): string {
  return runBytes(command, args, cwd).toString("utf8").trim();
}

/** External documents remain unknown until the owning boundary validates their shape. */
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Deterministic JSON matches release receipts' recursively sorted key convention. */
export function writeJson(path: string, value: unknown): void {
  const json = JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item))
        return Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
      return item;
    },
    2,
  );
  writeFileSync(path, `${json}\n`);
}

export { digest, sha256 } from "./filesystem.ts";
