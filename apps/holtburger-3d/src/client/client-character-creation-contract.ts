import { z } from "zod";
import { creationNameSchema } from "./client-character-creation-name";
import type { HostTransport } from "../lib/host/host-transport";
import { objectPreviewVisualSchema } from "./client-object-preview-contract";

const index = z.number().int().nonnegative();
const word = index.max(0xffff_ffff);
const hue = z.number().finite().min(0).max(1);
const attributes = z.tuple([word, word, word, word, word, word]);
const skills = z.array(index.max(3));

/** Style ordinals, clothing palette-template keys and shades; the host resolves all DAT identities and substitutions. */
const creationAppearanceSchema = z
	.object({
		eyes: word,
		nose: word,
		mouth: word,
		hairColor: word,
		eyeColor: word,
		hairStyle: word,
		headgearStyle: word,
		headgearColor: word,
		shirtStyle: word,
		shirtColor: word,
		pantsStyle: word,
		pantsColor: word,
		footwearStyle: word,
		footwearColor: word,
		skinHue: hue,
		hairHue: hue,
		headgearHue: hue,
		shirtHue: hue,
		pantsHue: hue,
		footwearHue: hue,
	})
	.strict();

/** Semantic user build. Wire constants, account, slot and privilege flags are absent. */
export const characterCreationDraftSchema = z
	.object({
		heritage: word,
		gender: word,
		appearance: creationAppearanceSchema,
		/** Strength, endurance, coordination, quickness, focus, self. */
		attributes,
		skills,
		name: creationNameSchema,
		startArea: word,
	})
	.strict();
export type CharacterCreationDraft = z.infer<
	typeof characterCreationDraftSchema
>;

const namedChoice = z.object({ id: word, name: z.string() });
const garment = z
	.object({
		name: z.string(),
		paletteTemplateIds: z.array(word).min(1),
	})
	.strict();
/** Host-resolved CSS swatches from the substituted DAT palette intervals. */
const swatch = z.string().regex(/^#[0-9a-f]{6}$/);
const gender = namedChoice
	.extend({
		hairStyles: index,
		hairColors: z.array(z.array(swatch).min(1)),
		skinColors: z.array(swatch).min(1),
		eyes: index,
		eyeColors: z.array(swatch),
		noses: index,
		mouths: index,
		headgear: z.array(garment),
		shirts: z.array(garment),
		pants: z.array(garment),
		footwear: z.array(garment),
	})
	.strict();
const creationDefaults = z
	.object({
		attributes,
		skills,
	})
	.strict();
/** Creation attribute order matches the protocol tuple, independent of DAT attribute IDs. */
export const CREATION_ATTRIBUTES = [
	"Strength",
	"Endurance",
	"Coordination",
	"Quickness",
	"Focus",
	"Self",
] as const;
const skillFormula = z
	.object({
		first: z.enum(CREATION_ATTRIBUTES),
		second: z.enum(CREATION_ATTRIBUTES).nullable(),
		divisor: word.min(1),
	})
	.strict();
const skill = namedChoice
	.extend({
		description: z.string(),
		formula: skillFormula.nullable(),
		trainedCost: index.nullable(),
		specializationUpgradeCost: index.nullable(),
		minimumAdvancement: index.max(3),
	})
	.strict();

/** Static UI choices with costs and baseline advancement already interpreted by shared rules. */
const catalogSchema = z
	.object({
		attributeDescriptions: z.tuple([
			z.string(),
			z.string(),
			z.string(),
			z.string(),
			z.string(),
			z.string(),
		]),
		minimumAttribute: word,
		maximumAttribute: word,
		skillSlots: index,
		startAreas: z.array(namedChoice.strict()),
		heritages: z.array(
			namedChoice
				.extend({
					lore: z.array(z.string().min(1)).min(1),
					benefits: z
						.object({
							descriptions: z.array(z.string().min(1)),
							skillGroups: z.array(
								z
									.object({
										label: z.string().min(1),
										skills: z.array(z.string().min(1)).min(1),
									})
									.strict(),
							),
						})
						.strict(),
					attributeCredits: word,
					skillCredits: word,
					startAreaIds: z.array(word),
					usesStarterClothing: z.boolean(),
					genders: z.array(gender),
					defaults: creationDefaults,
					skills: z.array(skill),
				})
				.strict(),
		),
	})
	.strict();
export type CharacterCreationCatalog = z.infer<typeof catalogSchema>;

/** Only appearance choices participate in static visual resolution. */
export const characterCreationAppearanceRequestSchema =
	characterCreationDraftSchema.pick({
		heritage: true,
		gender: true,
		appearance: true,
	});
export type CharacterCreationAppearanceRequest = z.infer<
	typeof characterCreationAppearanceRequestSchema
>;

const creationPreviewSchema = z
	.object({
		body: objectPreviewVisualSchema,
		backgroundSetupDid: word.nullable(),
	})
	.strict();
export type CharacterCreationPreview = z.infer<typeof creationPreviewSchema>;

/** Only allocation fields can affect starting stats. */
export const characterCreationStatsRequestSchema =
	characterCreationDraftSchema.pick({
		heritage: true,
		attributes: true,
		skills: true,
	});
export type CharacterCreationStatsRequest = z.infer<
	typeof characterCreationStatsRequestSchema
>;

/** The host owns both numerical calculation and whether a race supports it. */
export const characterCreationStatsSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("olthoi") }).strict(),
	z
		.object({
			kind: z.literal("standard"),
			vitals: z.tuple([word, word, word]),
			skills: z.array(
				z.object({ id: word, value: word, usable: z.boolean() }).strict(),
			),
		})
		.strict(),
]);
export type CharacterCreationStats = z.infer<
	typeof characterCreationStatsSchema
>;

/** Resolve starting values through the same static host capability in every frontend transport. */
export async function resolveCharacterCreationStats(
	transport: Pick<HostTransport, "invoke">,
	request: CharacterCreationStatsRequest,
): Promise<CharacterCreationStats> {
	return characterCreationStatsSchema.parse(
		await transport.invoke("resolve_character_creation_stats", {
			request: characterCreationStatsRequestSchema.parse(request),
		}),
	);
}

/** Resolve content directly, independently of world presentation or creation submission. */
export async function resolveCharacterCreationAppearance(
	transport: Pick<HostTransport, "invoke">,
	request: CharacterCreationAppearanceRequest,
): Promise<CharacterCreationPreview> {
	return creationPreviewSchema.parse(
		await transport.invoke("resolve_character_creation_appearance", {
			request: characterCreationAppearanceRequestSchema.parse(request),
		}),
	);
}

/** Load choices directly from static content; world presentation is not a prerequisite. */
export async function loadCharacterCreationCatalog(
	transport: Pick<HostTransport, "invoke">,
): Promise<CharacterCreationCatalog> {
	return catalogSchema.parse(
		await transport.invoke("load_character_creation_catalog"),
	);
}
