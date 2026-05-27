export const BASE_MATERIAL_VARIANT_SIGNATURE = "base";
export const LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE = "sampler=clamp";
export const LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE =
	"sampler=repeat";

export type LegacySamplerMaterialVariant = "clamp" | "repeat";

export function formatLegacySamplerMaterialVariantSignature(
	variant: LegacySamplerMaterialVariant,
): string {
	return variant === "repeat"
		? LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE
		: LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE;
}
