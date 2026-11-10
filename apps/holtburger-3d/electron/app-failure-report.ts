import { z } from "zod";
import { readFile } from "node:fs/promises";
import { replaceLocalFile } from "./replace-local-file.js";

/** Bound incoming renderer evidence and native error text independently. */
export const MAX_RENDERER_EVIDENCE_BYTES = 64 * 1024;
const MAX_MESSAGE_LENGTH = 4096;
const rendererEvidenceSchema = z.looseObject({ reason: z.string() });

/** App-wide report categories used by the launcher clipboard action. */
export type AppFailureKind =
	"startup" | "content" | "session" | "process" | "renderer";

/** One latest report, with ordered writes and GPU evidence scoped to the current document. */
export class AppFailureReportStore {
	readonly #path: string;
	#pending = Promise.resolve();
	#rendererEvidence: z.infer<typeof rendererEvidenceSchema> | null = null;

	constructor(path: string) {
		this.#path = path;
	}

	beginDocument(): void {
		this.#rendererEvidence = null;
	}

	/** Retain validated evidence and expose its reason to the application report. */
	retainRendererEvidence(report: string): string {
		const evidence = rendererEvidenceSchema.parse(JSON.parse(report));
		this.#rendererEvidence = evidence;
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
				renderer: this.#rendererEvidence,
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
