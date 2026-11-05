import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { run, type Runner } from "./native.ts";

/** Stable application identity shared by installer compilation and registry inspection. */
export const WINDOWS_APP_ID = "io.github.merklejerk.holtburger-3d";
/** Start-menu identity intentionally remains unchanged between distribution versions. */
export const WINDOWS_APP_NAME = "Holtburger 3D";
const registryKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${WINDOWS_APP_ID}_is1`;

/** Keep OS API details in the app's narrow Python bridge, not in repository orchestration. */
export function registration(
	appRoot: string,
	command: Runner = run,
): { location: string; version: string } | null {
	return z
		.object({ location: z.string(), version: z.string() })
		.nullable()
		.parse(
			JSON.parse(
				command(
					"python",
					[
						join(appRoot, "scripts/windows-installer-native.py"),
						"registration",
						registryKey,
					],
					appRoot,
				),
			),
		);
}

/** Injectable owned child so the handle lifecycle can be checked without Windows APIs. */
export type LockLauncher = (path: string) => ChildProcessWithoutNullStreams;

/** Bound startup/cleanup waits; no successful callback may outlive the native lock owner. */
export async function withDeleteLock<T>(
	appRoot: string,
	path: string,
	operation: () => T | Promise<T>,
	launch: LockLauncher = (file) =>
		spawn(
			"python",
			[
				join(appRoot, "scripts/windows-installer-native.py"),
				"delete-lock",
				file,
			],
			{ cwd: appRoot, stdio: "pipe" },
		),
	timeoutMs = 10_000,
): Promise<T> {
	const child = launch(path),
		lines = createInterface({ input: child.stdout });
	let diagnostic = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		diagnostic += chunk;
	});
	// Resolve an explicit outcome so early helper failures cannot become unhandled rejections.
	const exited = new Promise<Error | null>((resolve) => {
		child.once("error", resolve);
		child.once("close", (code, signal) =>
			resolve(
				code === 0
					? null
					: new Error(
							`Windows lock helper exited ${code} (${signal}): ${diagnostic}`,
						),
			),
		);
	});
	let pipeError: Error | undefined;
	child.stdin.on("error", (error: Error) => {
		pipeError = error;
	});
	const release = async () => {
		lines.close();
		child.stdin.end();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const error = await Promise.race([
				exited,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() => reject(new Error("Windows lock helper cleanup timed out")),
						timeoutMs,
					);
				}),
			]);
			if (error !== null) throw error;
			if (pipeError !== undefined) throw pipeError;
		} finally {
			clearTimeout(timer);
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
				const error = await exited;
				if (error !== null) console.error(error.message);
			}
		}
	};
	let ready = false;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("Windows lock helper startup timed out")),
				timeoutMs,
			);
			const finish = (error?: Error) => {
				clearTimeout(timer);
				lines.removeListener("line", onLine);
				if (error === undefined) resolve();
				else reject(error);
			};
			const onLine = (line: string) => {
				if (line !== "locked")
					finish(new Error(`Unexpected Windows lock helper response: ${line}`));
				else {
					ready = true;
					finish();
				}
			};
			lines.on("line", onLine);
			void exited.then((error) => {
				if (!ready)
					finish(
						error === null
							? new Error(
									"Windows lock helper exited before acquiring its handle",
								)
							: error,
					);
			});
		});
		return await operation();
	} finally {
		await release();
	}
}
