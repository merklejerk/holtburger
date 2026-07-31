/** Filterable texture quality modes exposed by the client render settings. */
export const TEXTURE_FILTERING_POLICIES = [
	"nearest",
	"linear",
	"anisotropic-2x",
	"anisotropic-4x",
	"anisotropic-8x",
] as const;

/** Closed filterable texture quality policy with anisotropy encoded in the discriminant. */
export type TextureFilteringPolicy =
	(typeof TEXTURE_FILTERING_POLICIES)[number];

/** Test untrusted UI or harness input against the closed policy vocabulary. */
export function isTextureFilteringPolicy(
	value: string,
): value is TextureFilteringPolicy {
	return (TEXTURE_FILTERING_POLICIES as readonly string[]).includes(value);
}

/** Default requested filtering quality before device capability resolution. */
export const DEFAULT_TEXTURE_FILTERING_POLICY: TextureFilteringPolicy =
	"anisotropic-2x";

/** Device-independent texture filtering limits reported to renderer and frontend consumers. */
export interface TextureFilteringCapabilities {
	/** Maximum supported anisotropy, where one means anisotropic filtering is unavailable. */
	readonly maximumAnisotropy: number;
}

/** Validate and retain the hardware anisotropy limit without applying app policy. */
export function createTextureFilteringCapabilities(
	maximumAnisotropy: number,
): TextureFilteringCapabilities {
	if (!Number.isFinite(maximumAnisotropy) || maximumAnisotropy < 1) {
		throw new Error(
			`Maximum texture anisotropy must be finite and at least one; got ${maximumAnisotropy}.`,
		);
	}
	return { maximumAnisotropy };
}

/** Return modes whose requested effect is distinct on the supplied device. */
export function supportedTextureFilteringPolicies(
	capabilities: TextureFilteringCapabilities,
): readonly TextureFilteringPolicy[] {
	const maximum = capabilities.maximumAnisotropy;
	return TEXTURE_FILTERING_POLICIES.filter(
		(policy) =>
			policy === "nearest" ||
			policy === "linear" ||
			textureFilteringAnisotropy(policy) <= maximum,
	);
}

/** Resolve a requested mode to the strongest admitted mode no greater than device capability. */
export function resolveTextureFilteringPolicy(
	requested: TextureFilteringPolicy,
	capabilities: TextureFilteringCapabilities,
): TextureFilteringPolicy {
	if (requested === "nearest" || requested === "linear") return requested;
	const maximum = Math.min(
		textureFilteringAnisotropy(requested),
		capabilities.maximumAnisotropy,
	);
	if (maximum >= 8) return "anisotropic-8x";
	if (maximum >= 4) return "anisotropic-4x";
	if (maximum >= 2) return "anisotropic-2x";
	return "linear";
}

/** Return the requested anisotropy multiplier, with nearest and linear represented as one. */
export function textureFilteringAnisotropy(
	policy: TextureFilteringPolicy,
): 1 | 2 | 4 | 8 {
	switch (policy) {
		case "nearest":
		case "linear":
			return 1;
		case "anisotropic-2x":
			return 2;
		case "anisotropic-4x":
			return 4;
		case "anisotropic-8x":
			return 8;
	}
}

/** Return the concise user-facing label for one admitted policy. */
export function textureFilteringPolicyLabel(
	policy: TextureFilteringPolicy,
): string {
	switch (policy) {
		case "nearest":
			return "Nearest";
		case "linear":
			return "Linear";
		case "anisotropic-2x":
			return "Anisotropic 2x";
		case "anisotropic-4x":
			return "Anisotropic 4x";
		case "anisotropic-8x":
			return "Anisotropic 8x";
	}
}
