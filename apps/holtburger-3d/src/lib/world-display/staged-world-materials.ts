import type { AssetChannelState } from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import {
	createBaseMaterialAppearanceContext,
	type MaterialAppearanceContext,
} from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import type { RenderVec4 } from "./render-math";
import type { ResolvedIndexedMaterialData } from "./indexed-material-data";
import type { ResolvedRegionDetailOverlayPlan } from "./region-detail-overlays";
import type { TerrainBlendPlan } from "./terrain-blend-plan";
import {
	defaultStagedWorldMaterialTextureCapabilities,
	resolveStagedWorldMaterialStrategy,
	type StagedWorldMaterialAtlasEligibility,
	type StagedWorldMaterialRenderableKind,
} from "./staged-world-material-strategy";
import type {
	MaterialTextureCapabilities,
	RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import type { TextureFilteringMode } from "./texture-sampling-policy";

export type StagedWorldMaterialPlan =
	| StagedWorldFlatMaterialPlan
	| StagedWorldDirectTextureMaterialPlan
	| StagedWorldIndexedPalettedMaterialPlan
	| StagedWorldTerrainBlendMaterialPlan;

interface StagedWorldFlatMaterialPlan {
	kind: "flat";
	key: string;
	color: RenderVec4;
	behavior: LegacyMaterialBehaviorDto | null;
	fallbackReason: string | null;
	preparedAssetIds: readonly string[];
}

export interface StagedWorldDirectTextureMaterialPlan {
	kind: "direct-texture";
	key: string;
	color: RenderVec4;
	textureKey: string;
	textureUpload: RenderSurfaceTextureUploadPreparation & { status: "ready" };
	behavior: LegacyMaterialBehaviorDto;
	fallbackReason: string | null;
	atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
	detailOverlay: ResolvedRegionDetailOverlayPlan | null;
	preparedAssetIds: readonly string[];
}

export interface StagedWorldIndexedPalettedMaterialPlan {
	kind: "indexed-paletted";
	key: string;
	color: RenderVec4;
	indexedMaterial: ResolvedIndexedMaterialData;
	behavior: LegacyMaterialBehaviorDto;
	fallbackReason: string | null;
	detailOverlay: ResolvedRegionDetailOverlayPlan | null;
	preparedAssetIds: readonly string[];
}

export interface StagedWorldTerrainBlendMaterialPlan {
	kind: "terrain-blend";
	key: string;
	color: RenderVec4;
	plan: TerrainBlendPlan;
	behavior: null;
	fallbackReason: string | null;
	preparedAssetIds: readonly string[];
}

export function resolveStagedWorldSurfaceMaterialPlan(options: {
	assetState: AssetChannelState;
	surfaceId: number | null;
	fallbackColorKey: string;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	appearance?: MaterialAppearanceContext | null;
}): StagedWorldMaterialPlan {
	if (options.surfaceId === null) {
		return createFallbackMaterialPlan({
			key: `missing-surface/${options.fallbackColorKey}`,
			colorKey: options.fallbackColorKey,
			reason: "missing surface id",
			preparedAssetIds: [],
		});
	}
	const materialAssetId = `material/${formatHex32(options.surfaceId)}`;
	return resolveStagedWorldMaterialSlotPlan({
		assetState: options.assetState,
		slot: {
			slotIndex: 0,
			surfaceId: options.surfaceId,
			materialAssetId,
			materialVariantSignature: null,
		},
		fallbackColorKey: options.fallbackColorKey,
		renderableKind: "unknown",
		textureCapabilities: options.textureCapabilities,
		textureFilteringMode: options.textureFilteringMode,
		appearance: options.appearance,
	});
}

export function resolveStagedWorldMaterialSlotPlan(options: {
	assetState: AssetChannelState;
	slot: ResolvedMaterialSlot;
	fallbackColorKey: string;
	renderableKind?: StagedWorldMaterialRenderableKind;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	appearance?: MaterialAppearanceContext | null;
	detailOverlay?: ResolvedRegionDetailOverlayPlan | null;
}): StagedWorldMaterialPlan {
	const strategy = resolveStagedWorldMaterialStrategy({
		assetState: options.assetState,
		input: {
			slot: options.slot,
			renderableKind: options.renderableKind ?? "unknown",
			appearance:
				options.appearance ?? createBaseMaterialAppearanceContext("base"),
		},
		textureCapabilities:
			options.textureCapabilities ??
			defaultStagedWorldMaterialTextureCapabilities(),
		textureFilteringMode: options.textureFilteringMode,
	});
	if (strategy.kind !== "direct-texture") {
		if (strategy.kind === "indexed-paletted") {
			return {
				kind: "indexed-paletted",
				key: strategy.key,
				color: new Float32Array([
					strategy.behavior.color[0],
					strategy.behavior.color[1],
					strategy.behavior.color[2],
					strategy.behavior.opacity,
				]),
				indexedMaterial: strategy.indexedMaterial,
				behavior: strategy.behavior,
				fallbackReason: strategy.detail,
				detailOverlay: options.detailOverlay ?? null,
				preparedAssetIds: collectStrategyPreparedAssetIds(
					strategy,
					options.detailOverlay ?? null,
				),
			};
		}
		return createFallbackMaterialPlan({
			key: `${strategy.kind}/${strategy.materialAssetId}/${options.fallbackColorKey}`,
			colorKey: options.fallbackColorKey,
			behavior: strategy.behavior,
			reason: strategy.detail,
			preparedAssetIds: collectStrategyPreparedAssetIds(strategy),
		});
	}
	return {
		kind: "direct-texture",
		key: strategy.key,
		color: new Float32Array([
			strategy.behavior.color[0],
			strategy.behavior.color[1],
			strategy.behavior.color[2],
			strategy.behavior.opacity,
		]),
		textureKey: strategy.textureKey,
		textureUpload: strategy.textureUpload,
		behavior: strategy.behavior,
		fallbackReason: null,
		atlasEligibility: strategy.atlasEligibility,
		detailOverlay: options.detailOverlay ?? null,
		preparedAssetIds: collectStrategyPreparedAssetIds(
			strategy,
			options.detailOverlay ?? null,
		),
	};
}

function createFallbackMaterialPlan(options: {
	key: string;
	colorKey: string;
	behavior?: LegacyMaterialBehaviorDto | null;
	reason: string;
	preparedAssetIds?: readonly string[];
}): StagedWorldFlatMaterialPlan {
	return {
		kind: "flat",
		key: `flat/${options.key}`,
		color: buildFallbackColor(options.colorKey),
		behavior: options.behavior ?? null,
		fallbackReason: options.reason,
		preparedAssetIds: options.preparedAssetIds ?? [],
	};
}

function collectStrategyPreparedAssetIds(
	strategy: ReturnType<typeof resolveStagedWorldMaterialStrategy>,
	detailOverlay: ResolvedRegionDetailOverlayPlan | null = null,
): readonly string[] {
	const assetIds = new Set<string>();
	if (strategy.materialAssetId !== "material/fallback") {
		assetIds.add(strategy.materialAssetId);
	}
	if (strategy.kind === "direct-texture") {
		assetIds.add(
			`render-surface/${formatHex32(strategy.textureUpload.upload.renderSurfaceId)}`,
		);
		if (strategy.atlasEligibility) {
			assetIds.add(strategy.atlasEligibility.atlasEntry.preparedTextureAssetId);
		}
	}
	if (strategy.kind === "indexed-paletted") {
		for (const assetId of strategy.indexedMaterial.preparedAssetIds) {
			assetIds.add(assetId);
		}
	}
	if (detailOverlay) {
		assetIds.add(detailOverlay.profileAssetId);
		assetIds.add(detailOverlay.role.textureAssetId);
		assetIds.add(
			`render-surface/${formatHex32(detailOverlay.renderSurface.renderSurfaceId)}`,
		);
	}
	return [...assetIds].sort();
}

function buildFallbackColor(colorKey: string): RenderVec4 {
	let hash = 0x811c9dc5;
	for (let index = 0; index < colorKey.length; index += 1) {
		hash ^= colorKey.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return new Float32Array([
		((hash >>> 16) & 0xff) / 255,
		((hash >>> 8) & 0xff) / 255,
		(hash & 0xff) / 255,
		1,
	]);
}
