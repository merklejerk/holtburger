import type { TextureUsagePurpose } from "../../../../textures/placement";

/** Bake-facing texture fact that does not imply renderer texture residency. */
export interface OpenWorldStreamingBakeTexturePlacementFact {
	readonly itemId: string;
	readonly pageCompatibilityKey: string;
	readonly purpose: TextureUsagePurpose;
}

export function createOpenWorldStreamingPageCompatibilityKey(input: {
	readonly pageId: string;
	readonly purpose: TextureUsagePurpose;
}): string {
	return `${input.purpose}:${input.pageId}`;
}
