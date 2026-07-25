import type { ResolvedMaterial } from "./presentation";
import {
	createAssetTextureKey,
	TextureFilteringMode,
	TexturePurpose,
	TextureWrapMode,
	type AssetTextureKey,
	type TextureSamplerPolicy,
} from "../textures/types";

/** Renderer-neutral ordering constraint derived from retail surface facts. */
export type ObjectMaterialOrdering =
	| "opaque"
	| "alpha-test"
	| "transparent"
	| "additive";

/** Stable source-local plan for one complete object material binding. */
export interface ObjectMaterialPlan {
	readonly id: string;
	readonly material: ResolvedMaterial;
	readonly ordering: ObjectMaterialOrdering;
	readonly baseTexture: AssetTextureKey | null;
	readonly paletteTexture: AssetTextureKey | null;
	readonly sampler: TextureSamplerPolicy;
}

const SURFACE_BASE1_CLIP_MAP = 0x04;
const SURFACE_TRANSLUCENT = 0x10;
const SURFACE_ALPHA = 0x100;
const SURFACE_INV_ALPHA = 0x200;
const SURFACE_ADDITIVE = 0x10000;

/** Derive stable material binding facts without atlas placement or device state. */
export function planObjectMaterial(
	material: ResolvedMaterial,
	wrap: TextureWrapMode,
): ObjectMaterialPlan {
	const ordering = classifyObjectMaterialOrdering(material);
	if (material.kind === "solid-color") {
		return {
			id: bindingId(material, ordering, wrap, null, null),
			material,
			ordering,
			baseTexture: null,
			paletteTexture: null,
			sampler: sampler(wrap),
		};
	}
	const purpose =
		material.textureEncoding === "direct-color"
			? TexturePurpose.ObjectDirectColor
			: material.textureEncoding === "index8"
				? TexturePurpose.ObjectIndex8
				: TexturePurpose.ObjectIndex16;
	const baseTexture = createAssetTextureKey(purpose, material.colorTextureId);
	const paletteTexture = material.paletteTextureId
		? createAssetTextureKey(TexturePurpose.ObjectPalette, material.paletteTextureId)
		: null;
	if (material.textureEncoding !== "direct-color" && paletteTexture === null) {
		throw new Error(`Indexed material ${material.id} has no palette dependency.`);
	}
	return {
		id: bindingId(material, ordering, wrap, baseTexture, paletteTexture),
		material,
		ordering,
		baseTexture,
		paletteTexture,
		sampler: sampler(wrap),
	};
}

/** Classify source surface facts without leaking WebGL blend policy upstream. */
export function classifyObjectMaterialOrdering(
	material: ResolvedMaterial,
): ObjectMaterialOrdering {
	const flags = material.rawSurfaceFlags;
	if ((flags & SURFACE_ADDITIVE) !== 0) return "additive";
	if (
		(flags & (SURFACE_TRANSLUCENT | SURFACE_ALPHA | SURFACE_INV_ALPHA)) !==
			0 ||
		material.translucency > 0
	) {
		return "transparent";
	}
	if ((flags & SURFACE_BASE1_CLIP_MAP) !== 0) return "alpha-test";
	return "opaque";
}

function sampler(wrap: TextureWrapMode): TextureSamplerPolicy {
	return { filtering: TextureFilteringMode.Linear, wrap };
}

function bindingId(
	material: ResolvedMaterial,
	ordering: ObjectMaterialOrdering,
	wrap: TextureWrapMode,
	baseTexture: AssetTextureKey | null,
	paletteTexture: AssetTextureKey | null,
): string {
	return [
		material.id,
		ordering,
		wrap,
		baseTexture ?? "none",
		paletteTexture ?? "none",
	].join("|");
}
