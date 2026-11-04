import { z } from "zod";

const nonNegativeInteger = z.number().int().nonnegative();
const dataId = nonNegativeInteger.max(0xffff_ffff);

/** Lossless ordered setup substitutions shared by scene and isolated-model consumers. */
export const entityAppearanceSchema = z.object({
	paletteDid: dataId.nullable(),
	subPalettes: z.array(
		z.object({
			paletteDid: dataId,
			offset: nonNegativeInteger,
			colorCount: nonNegativeInteger,
		}),
	),
	textureChanges: z.array(
		z.object({
			partIndex: nonNegativeInteger.max(0xff),
			oldTextureDid: dataId,
			newTextureDid: dataId,
		}),
	),
	partChanges: z.array(
		z.object({
			partIndex: nonNegativeInteger.max(0xff),
			gfxObjDid: dataId,
		}),
	),
});
