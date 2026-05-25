const BASE_MATERIAL_VARIANT_SIGNATURE = "base";
const LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE = "sampler=clamp";
const LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE = "sampler=repeat";

type LegacySamplerMaterialVariant = "clamp" | "repeat";

export function normalizeMaterialVariantSignature(
	signature: string | null | undefined,
): string {
	return signature && signature.length > 0
		? signature
		: BASE_MATERIAL_VARIANT_SIGNATURE;
}

export function describeMaterialVariantSignature(
	signature: string | null | undefined,
): string {
	return `variant=${normalizeMaterialVariantSignature(signature)}`;
}

export function parseLegacySamplerMaterialVariantSignature(
	signature: string | null | undefined,
): LegacySamplerMaterialVariant | null {
	const normalized = normalizeMaterialVariantSignature(signature);
	if (normalized === LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE) {
		return "repeat";
	}
	if (normalized === LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE) {
		return "clamp";
	}
	return null;
}
