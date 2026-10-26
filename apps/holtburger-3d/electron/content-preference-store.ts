import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
	contentFailureSchema,
	type ContentFailure,
} from "../src/app/content-startup-contract.js";
import { replaceLocalFile } from "./replace-local-file.js";

const savedContentSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unselected") }),
	z.object({
		kind: z.literal("selected"),
		location: z.string().min(1),
		health: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("ready") }),
			z.object({
				kind: z.literal("needs_attention"),
				failure: contentFailureSchema,
			}),
		]),
	}),
]);
const contentPreferenceSchema = z.object({
	version: z.literal(1),
	selection: savedContentSchema,
});

/** Last successful selection and its recovery reason, independent of character settings. */
export type SavedContent = z.infer<typeof savedContentSchema>;

/** One serialized owner ensures a later failure cannot be overwritten by an older success. */
export class ContentPreferenceStore {
	readonly #path: string;
	#selection: SavedContent = { kind: "unselected" };
	#pending: Promise<void> = Promise.resolve();
	#lastWrite: Promise<void> = Promise.resolve();

	constructor(path: string) {
		this.#path = path;
	}

	/** Missing preferences are expected on first launch; malformed/unreadable files are errors. */
	async load(): Promise<SavedContent> {
		let contents: string;
		try {
			contents = await readFile(this.#path, "utf8");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return this.#selection;
			throw new Error(`Could not read content preference at ${this.#path}`, {
				cause: error,
			});
		}
		try {
			this.#selection = contentPreferenceSchema.parse(
				JSON.parse(contents),
			).selection;
		} catch (error) {
			throw new Error(
				`Invalid content preference at ${this.#path}; choose an asset location to replace it.`,
				{ cause: error },
			);
		}
		return this.#selection;
	}

	/** Explicit launch action replaces any saved path and attention marker, even if unreadable. */
	clear(): Promise<void> {
		return this.#write(() => ({ kind: "unselected" }));
	}

	/** Record only a successfully initialized, canonical selection. */
	select(location: string): Promise<void> {
		return this.#write(() => ({
			kind: "selected",
			location,
			health: { kind: "ready" },
		}));
	}

	/** Match inside the write queue so a preceding successful save is visible to this failure. */
	markFailure(location: string, failure: ContentFailure): Promise<void> {
		return this.#write((selection) =>
			selection.kind === "selected" &&
			selection.location === location &&
			selection.health.kind === "ready"
				? {
						kind: "selected",
						location,
						health: { kind: "needs_attention", failure },
					}
				: selection,
		);
	}

	/** Join admitted writes before native shutdown; operation owners surface individual failures. */
	flush(): Promise<void> {
		return this.#lastWrite;
	}

	#write(update: (selection: SavedContent) => SavedContent): Promise<void> {
		const operation = this.#pending.then(async () => {
			const next = update(this.#selection);
			if (next === this.#selection) return;
			await replaceLocalFile(
				this.#path,
				JSON.stringify({ version: 1, selection: next }, null, 2) + "\n",
			);
			this.#selection = next;
		});
		// Keep the queue usable for explicit retries; the returned operation still rejects.
		this.#pending = operation.catch(() => undefined);
		this.#lastWrite = operation;
		return operation;
	}
}
