import { z } from "zod";
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
		name: z.string(),
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
const gender = namedChoice
	.extend({
		hairStyles: index,
		hairColors: index,
		eyes: index,
		eyeColors: index,
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
const skill = namedChoice
	.extend({
		description: z.string(),
		trainedCost: index.nullable(),
		specializationUpgradeCost: index.nullable(),
		minimumAdvancement: index.max(3),
	})
	.strict();

/** Static UI choices with costs and baseline advancement already interpreted by shared rules. */
const catalogSchema = z
	.object({
		minimumAttribute: word,
		maximumAttribute: word,
		skillSlots: index,
		startAreas: z.array(namedChoice.strict()),
		heritages: z.array(
			namedChoice
				.extend({
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
