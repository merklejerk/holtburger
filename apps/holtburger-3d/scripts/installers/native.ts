import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** App-owned installer tooling needs only native executables, never npm shell shims. */
export const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Injectable native command boundary for installed-app and lifecycle checks. */
export type Runner = (
	program: string,
	args: readonly string[],
	cwd: string,
) => string;
/** Rejected native operations remain distinguishable from execution failures. */
export interface CommandResult {
	/** Numeric native status, including expected locked-file refusals. */
	readonly exitCode: number;
	/** Exact diagnostic output from the native program. */
	readonly stdout: Buffer;
	/** Error output is retained independently of structured stdout. */
	readonly stderr: Buffer;
}

/** Preserve native failures, signals and timeouts without depending on root npm modules. */
export function runResult(
	program: string,
	args: readonly string[],
	cwd: string,
	timeoutMs?: number,
): CommandResult {
	const result = spawnSync(program, args, {
		cwd,
		timeout: timeoutMs,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status === null)
		throw new Error(`${program} terminated by signal ${result.signal}`);
	return {
		exitCode: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

/** Default command policy requires success; explicit refusal probes inspect runResult. */
export const run: Runner = (program, args, cwd) => {
	const result = runResult(program, args, cwd);
	if (result.exitCode !== 0)
		throw new Error(
			`${program} exited ${result.exitCode}: ${result.stdout.toString()}${result.stderr.toString()}`,
		);
	return result.stdout.toString("utf8").trim();
};

/** External native metadata remains unknown until the app boundary admits its fields. */
export function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}
