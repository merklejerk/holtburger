import { z } from "zod";
import type { HostTransport } from "../lib/host/host-transport";

/** Bound static lookup work independently from image preparation. */
export const MAX_SPELL_REFERENCE_BATCH = 128;
const id = z.number().int().positive().max(0xffff_ffff);
const spellSpec = z
	.object({
		kind: z.literal("spell"),
		base: id,
		background: id,
		effects: id,
		overlay: id.nullable(),
	})
	.strict()
	.readonly();
const referenceSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("missing"), id })
		.strict()
		.readonly(),
	z
		.object({
			kind: z.literal("known"),
			id,
			name: z.string(),
			details: z
				.object({
					castingRoute: z.enum([
						"self-target",
						"untargeted",
						"selected-target",
					]),
					classification: z
						.object({
							beneficial: z.boolean(),
							level: z.number().int().min(1).max(8).nullable(),
							recipient: z.enum(["creature", "item"]).nullable(),
							fellowship: z.boolean(),
							damage: z
								.enum([
									"direct",
									"misc",
									"acid",
									"bludgeoning",
									"frost",
									"lightning",
									"fire",
									"piercing",
									"slashing",
									"nether",
								])
								.nullable(),
						})
						.strict()
						.readonly(),
					description: z.string(),
					school: z.number().int().nonnegative().max(0xffff_ffff),
					baseMana: z.number().int().nonnegative().max(0xffff_ffff),
					manaPerTarget: z.number().int().nonnegative().max(0xffff_ffff),
					durationSeconds: z.number().finite().positive().nullable(),
				})
				.strict()
				.readonly(),
			artwork: z.discriminatedUnion("kind", [
				z
					.object({ kind: z.literal("ready"), spec: spellSpec })
					.strict()
					.readonly(),
				z
					.object({
						kind: z.literal("failed"),
						detail: z.string().min(1).max(1024),
					})
					.strict()
					.readonly(),
			]),
		})
		.strict()
		.readonly(),
]);

/** Component metadata uses the same artwork availability contract as spell definitions. */
const componentSchema = z
	.object({
		id,
		name: z.string(),
		artwork: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("ready"),
					spec: z
						.object({ kind: z.literal("spell-component"), base: id })
						.strict()
						.readonly(),
				})
				.strict()
				.readonly(),
			z
				.object({ kind: z.literal("failed"), detail: z.string().min(1) })
				.strict()
				.readonly(),
		]),
	})
	.strict()
	.readonly();
export type SpellComponentReference = z.infer<typeof componentSchema>;

/** Static details consumed by inline inspection and independent inspectors. */
export type SpellDetails = Extract<
	z.infer<typeof referenceSchema>,
	{ kind: "known" }
>["details"];

/** Per-identity failures remain visible alongside successful static references. */
export type SpellReference =
	| z.infer<typeof referenceSchema>
	| {
			readonly kind: "failed";
			readonly id: number;
			readonly detail: string;
	  };

/** One content-transport lifetime. Static definitions are independent of known membership. */
export class SpellReferences {
	readonly #transport: Pick<HostTransport, "invoke">;
	readonly #entries = new Map<number, Promise<SpellReference>>();
	#tail: Promise<void> = Promise.resolve();
	#disposed = false;
	#components: Promise<ReadonlyMap<number, SpellComponentReference>> | null =
		null;

	constructor(transport: Pick<HostTransport, "invoke">) {
		this.#transport = transport;
	}

	async load(ids: readonly number[]): Promise<readonly SpellReference[]> {
		if (this.#disposed) throw new Error("Spell references are disposed.");
		const missing = [...new Set(ids)].filter((id) => !this.#entries.has(id));
		for (
			let offset = 0;
			offset < missing.length;
			offset += MAX_SPELL_REFERENCE_BATCH
		) {
			const batch = missing.slice(offset, offset + MAX_SPELL_REFERENCE_BATCH);
			const task = this.#tail.then(() => this.#loadBatch(batch));
			this.#tail = task.then(() => undefined);
			for (const id of batch)
				this.#entries.set(
					id,
					task.then((results) => {
						const result = results.find((result) => result.id === id);
						if (result === undefined)
							throw new Error(`Missing validated spell reference ${id}.`);
						return result;
					}),
				);
		}
		return Promise.all(
			ids.map((id) => {
				const entry = this.#entries.get(id);
				if (entry === undefined) throw new Error(`Missing spell lookup ${id}.`);
				return entry;
			}),
		);
	}

	/** One small dictionary per content lifetime; no PNGs are prepared by this lookup. */
	components(): Promise<ReadonlyMap<number, SpellComponentReference>> {
		if (this.#disposed)
			return Promise.reject(new Error("Spell references are disposed."));
		if (this.#components === null) this.#components = this.#loadComponents();
		return this.#components;
	}

	async #loadComponents(): Promise<
		ReadonlyMap<number, SpellComponentReference>
	> {
		const value = await this.#transport.invoke("load_spell_components");
		if (this.#disposed) throw new Error("Spell reference source retired.");
		const references = z.array(componentSchema).parse(value);
		const result = new Map(
			references.map((reference) => [reference.id, reference]),
		);
		if (result.size !== references.length)
			throw new Error("Duplicate spell component identity.");
		return result;
	}

	dispose(): void {
		this.#disposed = true;
		this.#entries.clear();
		this.#components = null;
	}

	async #loadBatch(ids: readonly number[]): Promise<readonly SpellReference[]> {
		try {
			if (this.#disposed) throw new Error("Spell reference source retired.");
			const value = await this.#transport.invoke("load_spell_references", {
				request: { spellIds: ids },
			});
			if (this.#disposed) throw new Error("Spell reference source retired.");
			const results = z.array(referenceSchema).parse(value);
			if (results.length !== ids.length)
				throw new Error(
					"Spell reference response count does not match the request.",
				);
			if (new Set(results.map((result) => result.id)).size !== results.length)
				throw new Error("Duplicate spell reference response identity.");
			if (results.some((result) => !ids.includes(result.id)))
				throw new Error("Unexpected spell reference response identity.");
			return results;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return ids.map((id) => ({ kind: "failed", id, detail }));
		}
	}
}
