import { z } from "zod";
import { bodyAppearanceSchema } from "./client-body-appearance-contract";
import { entityAppearanceSchema } from "../lib/game/runtime/entity-appearance-contract";

const word = z.number().int().nonnegative().max(0xffff_ffff);
const count = z.number().int().nonnegative();
const rgb = z.tuple([
	z.number().int().min(0).max(255),
	z.number().int().min(0).max(255),
	z.number().int().min(0).max(255),
]);

/** Exactly one applicable heritage-specific option, interpreted by the shared content resolver. */
const racial = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("standard") }).strict(),
	z.object({ kind: z.literal("empyrean"), earthbound: z.boolean() }).strict(),
	z.object({ kind: z.literal("undead"), flames: z.boolean() }).strict(),
	z.object({ kind: z.literal("umbraen"), crown: z.boolean() }).strict(),
	z.object({ kind: z.literal("penumbraen"), crown: z.boolean() }).strict(),
]);

/** Semantic draft contains no raw texture/model/palette DIDs. */
const barberChoicesSchema = z
	.object({ body: bodyAppearanceSchema, racial })
	.strict();

const particles = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("preserve") }).strict(),
	z.object({ kind: z.literal("replace"), script: word.nullable() }).strict(),
]);

const subject = z.object({ guid: word, instance: word.max(0xffff) }).strict();
const catalog = z
	.object({
		styles: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("editable"),
					hair: count,
					eyes: count,
					noses: count,
					mouths: count,
				})
				.strict(),
			z.object({ kind: z.literal("fixed") }).strict(),
		]),
		hairColors: z.array(z.array(rgb).min(1)).min(1),
		skinColors: z.array(rgb).min(1),
		eyeColors: z.array(rgb).min(1),
	})
	.strict();

const phase = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("loading") }).strict(),
	z
		.object({
			kind: z.literal("editing"),
			/** Recreated editors must supersede core's retained revision. */
			revision: word,
			original: barberChoicesSchema,
			catalog,
		})
		.strict(),
	z.object({ kind: z.literal("sending") }).strict(),
	z.object({ kind: z.literal("unavailable"), message: z.string() }).strict(),
]);

/** Recovery level retains interaction identity and committed effects independently of the draft. */
export const barberSnapshotSchema = z
	.object({
		interaction: z.object({ id: word, subject, phase }).strict().nullable(),
		result: z
			.object({
				id: word,
				outcome: z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("submitted") }).strict(),
					z
						.object({ kind: z.literal("rejected"), message: z.string() })
						.strict(),
					z
						.object({ kind: z.literal("uncertain"), message: z.string() })
						.strict(),
				]),
			})
			.strict()
			.nullable(),
		particles: z
			.object({ revision: word, subject, script: word.nullable() })
			.strict()
			.nullable(),
	})
	.strict();

/** Candidate visuals are imperative presentation inputs; do not store them in the Svelte graph. */
export const barberPreviewSchema = z
	.object({
		id: word,
		subject,
		revision: word,
		outcome: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("ready"),
					setup: word,
					appearance: entityAppearanceSchema,
					particles,
				})
				.strict(),
			z.object({ kind: z.literal("rejected"), message: z.string() }).strict(),
		]),
	})
	.strict();

const draft = z
	.object({ revision: word, choices: barberChoicesSchema })
	.strict();

/** Same exact-candidate command admission used by all shared client frontends. */
export const barberRequestSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("preview"), id: word, draft }).strict(),
	z.object({ kind: z.literal("apply"), id: word, draft }).strict(),
	z.object({ kind: z.literal("cancel"), id: word }).strict(),
]);

export type BarberSnapshot = z.infer<typeof barberSnapshotSchema>;
export type BarberChoices = z.infer<typeof barberChoicesSchema>;
export type BarberPreview = z.infer<typeof barberPreviewSchema>;
export type BarberRequest = z.infer<typeof barberRequestSchema>;
