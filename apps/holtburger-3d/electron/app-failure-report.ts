import { z } from "zod";
import { readFile } from "node:fs/promises";
import { replaceLocalFile } from "./replace-local-file.js";

/** Bound incoming renderer evidence and native error text independently. */
export const MAX_RENDERER_EVIDENCE_BYTES = 64 * 1024;
const MAX_MESSAGE_LENGTH = 4096;
const MAX_WEBGL_WARNINGS = 16;
const MAX_WEBGL_WARNING_LENGTH = 1024;
const rendererEvidenceSchema = z.looseObject({ reason: z.string() });

/** One run of consecutive identical Chromium WebGL warnings. */
interface WebGLWarning {
	readonly message: string;
	readonly firstSeenAt: string;
	readonly lastSeenAt: string;
	readonly count: number;
}

/** App-wide report categories used by the launcher clipboard action. */
export type AppFailureKind =
	"startup" | "content" | "session" | "process" | "renderer";

/** One latest report, with ordered writes and GPU evidence scoped to the current document. */
export class AppFailureReportStore {
	readonly #path: string;
	#pending = Promise.resolve();
	#rendererEvidence: {
		readonly report: z.infer<typeof rendererEvidenceSchema>;
		readonly webglWarnings: readonly WebGLWarning[];
	} | null = null;
	readonly #webglWarnings: WebGLWarning[] = [];

	constructor(path: string) {
		this.#path = path;
	}

	beginDocument(): void {
		this.#rendererEvidence = null;
		this.#webglWarnings.length = 0;
	}

	/** Keep recent browser diagnostics from the main frame of the current game document. */
	recordWebGLWarning(message: string): void {
		if (!message.startsWith("WebGL: ")) return;
		const boundedMessage = message.slice(0, MAX_WEBGL_WARNING_LENGTH);
		const timestamp = new Date().toISOString();
		const previous = this.#webglWarnings.at(-1);
		if (previous?.message === boundedMessage) {
			this.#webglWarnings[this.#webglWarnings.length - 1] = {
				...previous,
				lastSeenAt: timestamp,
				count: previous.count + 1,
			};
			return;
		}
		this.#webglWarnings.push({
			message: boundedMessage,
			firstSeenAt: timestamp,
			lastSeenAt: timestamp,
			count: 1,
		});
		if (this.#webglWarnings.length > MAX_WEBGL_WARNINGS)
			this.#webglWarnings.shift();
	}

	/** Retain validated evidence and expose its reason to the application report. */
	retainRendererEvidence(report: string): string {
		const evidence = rendererEvidenceSchema.parse(JSON.parse(report));
		// A later process failure can reuse this evidence after teardown emits more warnings.
		this.#rendererEvidence = {
			report: evidence,
			webglWarnings: this.#webglWarnings.slice(),
		};
		return evidence.reason;
	}

	save(
		kind: AppFailureKind,
		message: string,
		context: {
			readonly version: string;
			readonly document: string | null;
		},
	): Promise<void> {
		const report = JSON.stringify(
			{
				schemaVersion: 1,
				capturedAt: new Date().toISOString(),
				kind,
				message: message.slice(0, MAX_MESSAGE_LENGTH),
				...context,
				platform: process.platform,
				architecture: process.arch,
				renderer: this.#rendererEvidence?.report ?? null,
				webglWarnings:
					this.#rendererEvidence?.webglWarnings ?? this.#webglWarnings,
			},
			null,
			2,
		);
		const write = this.#pending.then(() =>
			replaceLocalFile(this.#path, report),
		);
		// A failed write is reported by its caller and does not poison later writes.
		this.#pending = write.catch(() => undefined);
		return write;
	}

	flush(): Promise<void> {
		return this.#pending;
	}

	async read(): Promise<string | null> {
		await this.flush();
		try {
			return await readFile(this.#path, "utf8");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return null;
			throw error;
		}
	}
}
