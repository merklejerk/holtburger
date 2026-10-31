import { z } from "zod";

const ordinal = z.number().int().nonnegative().max(0xffff_ffff);
const shade = z.number().finite().min(0).max(1);

/** Authored body/face choices shared by creation and in-world appearance editing. */
export const bodyAppearanceSchema = z
	.object({
		eyes: ordinal,
		nose: ordinal,
		mouth: ordinal,
		hairColor: ordinal,
		eyeColor: ordinal,
		hairStyle: ordinal,
		skinHue: shade,
		hairHue: shade,
	})
	.strict();

export type BodyAppearanceChoices = z.infer<typeof bodyAppearanceSchema>;
