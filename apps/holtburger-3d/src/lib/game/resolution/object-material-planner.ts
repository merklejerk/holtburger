import type { ResolvedMaterial } from "./presentation";
import type {
	ObjectPalettePreparationServiceRequest,
	ObjectTexturePreparationServiceRequest,
} from "../textures/texture-preparer";
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
	/** Closed app-local pixel requests; atlas placement and device state remain absent. */
	readonly textureRequests: readonly (
		| ObjectTexturePreparationServiceRequest
		| ObjectPalettePreparationServiceRequest
	)[];
	/** Retail clip maps discard indexed palette entries below eight during later shader compilation. */
	readonly palettedClipMap: boolean;
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
			sampler: sampler(wrap, TextureFilteringMode.Linear),
			textureRequests: [],
			palettedClipMap: false,
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
	const textureRequests: Array<
		ObjectTexturePreparationServiceRequest | ObjectPalettePreparationServiceRequest
	> = [
		{
			kind: "prepared-object-texture",
			purpose,
			sourceAssetId: surfaceTextureAssetId(material.colorTextureId),
			renderSurfaceId: material.renderSurfaceId,
		},
	];
	if (material.paletteTextureId !== null) {
		textureRequests.push({
			kind: "prepared-object-palette",
			purpose: TexturePurpose.ObjectPalette,
			sourceAssetId: paletteAssetId(material.paletteTextureId),
			paletteDomain:
				material.textureEncoding === "index8" ? "index8" : "index16",
		});
	}
	return {
		id: bindingId(material, ordering, wrap, baseTexture, paletteTexture),
		material,
		ordering,
		baseTexture,
		paletteTexture,
		sampler: sampler(
			wrap,
			material.textureEncoding === "direct-color"
				? TextureFilteringMode.Linear
				: TextureFilteringMode.Nearest,
		),
		textureRequests,
		palettedClipMap:
			material.textureEncoding !== "direct-color" &&
			(flags(material) & SURFACE_BASE1_CLIP_MAP) !== 0,
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

function sampler(
	wrap: TextureWrapMode,
	filtering: TextureFilteringMode,
): TextureSamplerPolicy {
	return { filtering, wrap };
}

function flags(material: ResolvedMaterial): number {
	return material.rawSurfaceFlags;
}

function surfaceTextureAssetId(id: string): `surface-texture/${string}` {
	return `surface-texture/${id}`;
}

function paletteAssetId(id: string): `palette/${string}` {
	return `palette/${id}`;
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
		material.kind === "texture" ? material.renderSurfaceId : "no-render-surface",
		ordering,
		wrap,
		baseTexture ?? "none",
		paletteTexture ?? "none",
	].join("|");
}
