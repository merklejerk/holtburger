import type { ResolvedMaterial } from "./presentation";
import type { StaticDetailRole } from "./static-detail-role";
import {
	createAssetTextureKey,
	TextureFilteringMode,
	TexturePurpose,
	TextureWrapMode,
	type AssetTextureKey,
	type AssetTextureFact,
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
	/** Eligible active-region detail role selected by the static render domain. */
	readonly detailRole: StaticDetailRole | null;
	/** Complete logical source requirements; pixel request routing derives from these facts. */
	readonly textureRequirements: readonly AssetTextureFact[];
	/** Retail clip maps discard indexed palette entries below eight during later shader compilation. */
	readonly palettedClipMap: boolean;
}

const SURFACE_BASE1_CLIP_MAP = 0x04;
const SURFACE_TRANSLUCENT = 0x10;
const SURFACE_ALPHA = 0x100;
const SURFACE_INV_ALPHA = 0x200;
const SURFACE_ADDITIVE = 0x10000;
const SURFACE_DETAIL_OVERLAY = 0x20000;

/** Derive stable material binding facts without atlas placement or device state. */
export function planObjectMaterial(
	material: ResolvedMaterial,
	wrap: TextureWrapMode,
	domainDetailRole: StaticDetailRole,
): ObjectMaterialPlan {
	const ordering = classifyObjectMaterialOrdering(material);
	const detailRole =
		(flags(material) & SURFACE_DETAIL_OVERLAY) !== 0 ? domainDetailRole : null;
	if (material.kind === "solid-color") {
		return {
			id: bindingId(material, ordering, wrap, null, null, detailRole),
			material,
			ordering,
			baseTexture: null,
			detailRole,
			paletteTexture: null,
			sampler: sampler(wrap, TextureFilteringMode.Linear),
			textureRequirements: [],
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
	const baseTextureRequirement: AssetTextureFact = {
		kind: "asset",
		key: baseTexture,
		purpose,
		sourceAssetId: material.colorTextureId,
	};
	const paletteTexture = material.paletteTextureId
		? createAssetTextureKey(
				TexturePurpose.ObjectPalette,
				material.paletteTextureId,
			)
		: null;
	if (material.textureEncoding !== "direct-color" && paletteTexture === null) {
		throw new Error(
			`Indexed material ${material.id} has no palette dependency.`,
		);
	}
	const textureRequirements = [
		baseTextureRequirement,
		...(material.paletteTextureId === null
			? []
			: [
					{
						kind: "asset" as const,
						key: paletteTexture!,
						purpose: TexturePurpose.ObjectPalette,
						sourceAssetId: material.paletteTextureId,
					},
				]),
	];
	return {
		id: bindingId(
			material,
			ordering,
			wrap,
			baseTexture,
			paletteTexture,
			detailRole,
		),
		material,
		ordering,
		baseTexture,
		detailRole,
		paletteTexture,
		sampler: sampler(
			wrap,
			material.textureEncoding === "direct-color"
				? TextureFilteringMode.Linear
				: TextureFilteringMode.Nearest,
		),
		textureRequirements,
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
		(flags & (SURFACE_TRANSLUCENT | SURFACE_ALPHA | SURFACE_INV_ALPHA)) !== 0 ||
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

function bindingId(
	material: ResolvedMaterial,
	ordering: ObjectMaterialOrdering,
	wrap: TextureWrapMode,
	baseTexture: AssetTextureKey | null,
	paletteTexture: AssetTextureKey | null,
	detailRole: StaticDetailRole | null,
): string {
	return [
		material.id,
		material.kind === "texture"
			? material.renderSurfaceId
			: "no-render-surface",
		ordering,
		wrap,
		baseTexture ?? "none",
		paletteTexture ?? "none",
		detailRole ?? "no-detail",
	].join("|");
}
