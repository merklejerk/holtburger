import { z } from "zod";
import { worldPositionSchema } from "../lib/game/runtime/dynamic-entity-feed";

/** On-demand queries over core-owned historical facts. */
export type DeathLocationQuery = "last-outdoor" | "recent";
/** Incoming permission operations; outgoing grants use their own action. */
export type CorpseConsentAction =
	| { readonly kind: "list" | "clear" }
	| { readonly kind: "remove"; readonly playerName: string };

export const deathLocationResultSchema = z
	.object({
		character: z.number().int().nonnegative().max(0xffffffff),
		locations: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("last-outdoor"),
					position: worldPositionSchema.nullable(),
				})
				.strict(),
			z
				.object({
					kind: z.literal("recent"),
					positions: z.array(worldPositionSchema.nullable()),
				})
				.strict(),
		]),
	})
	.strict();
/** The character identity retires stale responses without retaining frontend history. */
export type DeathLocationResult = z.infer<typeof deathLocationResultSchema>;
