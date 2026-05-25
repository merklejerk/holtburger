const BASE_MATERIAL_VARIANT_SIGNATURE = "base";

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
