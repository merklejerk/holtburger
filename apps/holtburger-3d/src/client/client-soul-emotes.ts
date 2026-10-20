import { z } from "zod";
import type { HostTransport } from "../lib/host/host-transport";

/** Static content facts; canonical identity is resolved by the content owner. */
const soulEmoteReferenceSchema = z
	.object({
		id: z.string().min(1),
		pose: z.string().min(1),
		aliases: z.array(z.string().min(1)).nonempty(),
		myEmote: z.string().nullable(),
		otherEmote: z.string().nullable(),
	})
	.strict();
export type SoulEmoteReference = z.infer<typeof soulEmoteReferenceSchema>;

/** Validated catalog with one indexed alias route and no presentation categories. */
export class ClientSoulEmotes {
	readonly #aliases = new Map<string, SoulEmoteReference>();
	readonly #poses = new Map<string, SoulEmoteReference>();
	readonly references: readonly SoulEmoteReference[];

	constructor(value: unknown) {
		this.references = z.array(soulEmoteReferenceSchema).nonempty().parse(value);
		for (const reference of this.references) {
			if (this.#poses.has(reference.id))
				throw new Error(`Duplicate soul-emote pose: ${reference.id}`);
			this.#poses.set(reference.id, reference);
			for (const alias of reference.aliases) {
				const key = alias.toLowerCase();
				if (this.#aliases.has(key))
					throw new Error(`Duplicate soul-emote alias: ${alias}`);
				this.#aliases.set(key, reference);
			}
		}
	}

	resolve(alias: string): SoulEmoteReference | undefined {
		return this.#aliases.get(alias.toLowerCase());
	}

	pose(id: string): SoulEmoteReference | undefined {
		return this.#poses.get(id);
	}
}

/** One cold static query, independent of world presentation and session event cadence. */
export async function loadSoulEmotes(
	transport: HostTransport,
): Promise<ClientSoulEmotes> {
	return new ClientSoulEmotes(await transport.invoke("load_soul_emotes"));
}
