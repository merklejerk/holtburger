import type { ResolvedMaterial } from "./presentation";
import type { StaticDetailRole } from "./static-detail-role";
import {
	createAssetTextureKey,
	TexturePurpose,
	TextureWrapMode,
	type AssetTextureKey,
	type AssetTextureFact,
	type TextureSamplerPolicy,
} from "../textures/types";

/** Renderer-neutral ordering constraint derived from retail surface facts. */
export type ObjectMaterialOrdering =
	"opaque" | "alpha-test" | "transparent" | "additive";

/** Stable source-local plan for one complete object material binding. */
export interface ObjectMaterialPlan {
	readonly id: string;
	readonly material: ResolvedMaterial;
	readonly ordering: ObjectMaterialOrdering;
	readonly baseTexture: AssetTextureKey | null;
	readonly paletteTexture: AssetTextureKey | null;
	readonly sampler: TextureSamplerPolicy;
	/** Active-region detail role selected by the owning static render domain. */
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

/** Derive stable material binding facts without atlas placement or device state. */
export function planObjectMaterial(
	material: ResolvedMaterial,
	wrap: TextureWrapMode,
	detailRole: StaticDetailRole | null,
): ObjectMaterialPlan {
	const ordering = classifyObjectMaterialOrdering(material);
	if (material.kind === "solid-color") {
		return {
			id: bindingId(material, ordering, wrap, null, null, detailRole),
			material,
			ordering,
			baseTexture: null,
			detailRole,
			paletteTexture: null,
			sampler: sampler(wrap),
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
	// A composition replaces the authored palette outright, so it is the palette source whenever
	// the host resolved one for this material.
	const paletteSourceId =
		material.paletteComposite?.identity ?? material.paletteTextureId;
	const paletteRequirement: AssetTextureFact | null =
		paletteSourceId === null
			? null
			: {
					kind: "asset",
					key: createAssetTextureKey(
						TexturePurpose.ObjectPalette,
						paletteSourceId,
					),
					purpose: TexturePurpose.ObjectPalette,
					sourceAssetId: paletteSourceId,
					...(material.paletteComposite === null
						? {}
						: { paletteComposite: material.paletteComposite }),
				};
	const paletteTexture = paletteRequirement?.key ?? null;
	if (material.textureEncoding !== "direct-color" && paletteTexture === null) {
		throw new Error(
			`Indexed material ${material.id} has no palette dependency.`,
		);
	}
	const textureRequirements =
		paletteRequirement === null
			? [baseTextureRequirement]
			: [baseTextureRequirement, paletteRequirement];
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
		sampler: sampler(wrap),
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

function sampler(wrap: TextureWrapMode): TextureSamplerPolicy {
	return { wrap };
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
