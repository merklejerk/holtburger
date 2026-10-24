import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	characterVisualFileSchema,
	type CharacterVisualRead,
} from "../src/client/client-visual-cache-contract.js";
import {
	playerVisualCaptureSchema,
	type PlayerVisualCapture,
} from "../src/client/client-object-preview-contract.js";
import type { ClientLaunchConfiguration } from "./client-launch.js";
import { clientCharacterProfileKey } from "./client-profile-key.js";
import { replaceLocalFile } from "./replace-local-file.js";

/** Main owns admission and debounce; accepted captures outlive the renderer window. */
export class ClientVisualCacheStore {
	readonly #directory: string;
	readonly #endpoint: Pick<ClientLaunchConfiguration, "host" | "port">;
	readonly #delayMs: number;
	readonly #reportFailure: (message: string) => void;
	/** Immutable identity and value are staged together, never sampled from later selection. */
	readonly #pending = new Map<string, PlayerVisualCapture>();
	#timer: ReturnType<typeof setTimeout> | null = null;
	#tail: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(
		directory: string,
		endpoint: Pick<ClientLaunchConfiguration, "host" | "port">,
		delayMs: number,
		reportFailure: (message: string) => void,
	) {
		this.#directory = directory;
		this.#endpoint = { host: endpoint.host, port: endpoint.port };
		this.#delayMs = delayMs;
		this.#reportFailure = reportFailure;
	}

	/** Synchronous staging is the IPC acceptance boundary, before any debounce or disk I/O. */
	stage(value: PlayerVisualCapture): void {
		if (this.#closed)
			throw new Error(
				"Character visual cache is closing; capture was not accepted.",
			);
		const capture = playerVisualCaptureSchema.parse(value);
		this.#pending.set(this.#path(capture.guid), capture);
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.flush().catch((error: unknown) =>
				this.#reportFailure(
					`Character appearance could not be saved: ${String(error)}`,
				),
			);
		}, this.#delayMs);
	}

	/** Read only the selected identity; corrupt and future files cannot poison application startup. */
	async read(guid: number): Promise<CharacterVisualRead> {
		const path = this.#path(guid);
		const pending = this.#pending.get(path);
		if (pending !== undefined)
			return {
				kind: "ready",
				capture: playerVisualCaptureSchema.parse(pending),
			};
		try {
			const decoded: unknown = JSON.parse(await readFile(path, "utf8"));
			const parsed = characterVisualFileSchema.safeParse(decoded);
			if (!parsed.success)
				return {
					kind: "unavailable",
					message: `Saved appearance at ${path} has an unsupported version or malformed visual. Enter this character to save a new appearance.`,
				};
			if (parsed.data.capture.guid !== guid)
				return {
					kind: "unavailable",
					message: `Saved appearance at ${path} belongs to a different character. Enter this character to replace it.`,
				};
			return { kind: "ready", capture: parsed.data.capture };
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return { kind: "missing" };
			return {
				kind: "unavailable",
				message: `Saved appearance at ${path} could not be read: ${String(error)}`,
			};
		}
	}

	/** Serialize batches; a failed character remains pending without blocking siblings or newer captures. */
	flush(): Promise<void> {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		const operation = this.#tail.then(async () => {
			const failures: unknown[] = [];
			for (const [path, capture] of [...this.#pending]) {
				try {
					await replaceLocalFile(
						path,
						`${JSON.stringify({ version: 1, capture })}\n`,
					);
					if (this.#pending.get(path) === capture) this.#pending.delete(path);
				} catch (error) {
					failures.push(
						new Error(`Cannot write ${path}: ${String(error)}`, {
							cause: error,
						}),
					);
				}
			}
			if (failures.length > 0)
				throw new AggregateError(
					failures,
					`${failures.length} character appearance write(s) failed: ${failures.map(String).join("; ")}`,
				);
		});
		this.#tail = operation.catch(() => undefined);
		return operation;
	}

	/** Closes admission synchronously, then drains every value already accepted by main. */
	close(): Promise<void> {
		this.#closed = true;
		return this.flush();
	}

	#path(guid: number): string {
		const identity = clientCharacterProfileKey(this.#endpoint, guid);
		return join(
			this.#directory,
			`${createHash("sha256").update(identity).digest("hex")}.json`,
		);
	}
}
