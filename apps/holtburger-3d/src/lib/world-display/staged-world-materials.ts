import type { AssetChannelState } from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import {
	createBaseMaterialAppearanceContext,
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import type { RenderVec4 } from "./render-math";
import type {
	IndexedMaterialDataCache,
	ResolvedIndexedMaterialData,
} from "./indexed-material-data";
import type { ResolvedRegionDetailOverlayPlan } from "./region-detail-overlays";
import type { TerrainBlendPlan } from "./terrain-blend-plan";
import {
	defaultStagedWorldMaterialTextureCapabilities,
	resolveStagedWorldMaterialStrategy,
	type StagedWorldMaterialAtlasEligibility,
	type StagedWorldMaterialStrategyFallbackReason,
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

export interface StagedWorldMaterialPlanCacheRecord {
	plan: StagedWorldMaterialPlan;
	dependencyAssetIds: readonly string[];
	dependencyState: string;
}

export interface StagedWorldMaterialPlanCache {
	get(key: string): StagedWorldMaterialPlanCacheRecord | undefined;
	set(key: string, value: StagedWorldMaterialPlanCacheRecord): void;
	clear(): void;
}

interface StagedWorldFlatMaterialPlan {
	kind: "flat";
	key: string;
	color: RenderVec4;
	behavior: LegacyMaterialBehaviorDto | null;
	fallbackReason: string | null;
	fallbackReasonCode: StagedWorldMaterialStrategyFallbackReason | null;
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
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
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
		indexedMaterialDataCache: options.indexedMaterialDataCache,
		materialPlanCache: options.materialPlanCache,
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
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
}): StagedWorldMaterialPlan {
	const inputCacheKey = describeStagedWorldMaterialPlanCacheKey(options);
	const cached = options.materialPlanCache?.get(inputCacheKey);
	if (
		cached &&
		cached.dependencyState ===
			describeMaterialPlanDependencyState(
				options.assetState,
				cached.dependencyAssetIds,
			)
	) {
		return cached.plan;
	}
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
		indexedMaterialDataCache: options.indexedMaterialDataCache,
	});
	const materialAssetIds = collectMaterialPlanDependencyAssetIds(
		options.slot.materialAssetId,
		options.detailOverlay ?? null,
		strategy.kind === "direct-texture"
			? null
			: strategy.kind === "indexed-paletted"
				? null
				: strategy.materialAssetId,
	);
	if (strategy.kind !== "direct-texture") {
		if (strategy.kind === "indexed-paletted") {
			return cacheStagedWorldMaterialPlan(
				options.materialPlanCache,
				inputCacheKey,
				{
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
				},
				materialAssetIds,
				options.assetState,
			);
		}
		return cacheStagedWorldMaterialPlan(
			options.materialPlanCache,
			inputCacheKey,
			createFallbackMaterialPlan({
				key: `${strategy.kind}/${strategy.materialAssetId}/${options.fallbackColorKey}`,
				colorKey: options.fallbackColorKey,
				behavior: strategy.behavior,
				reason: strategy.detail,
				reasonCode: strategy.reason,
				preparedAssetIds: collectStrategyPreparedAssetIds(strategy),
			}),
			materialAssetIds,
			options.assetState,
		);
	}
	return cacheStagedWorldMaterialPlan(
		options.materialPlanCache,
		inputCacheKey,
		{
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
		},
		materialAssetIds,
		options.assetState,
	);
}

function cacheStagedWorldMaterialPlan<TPlan extends StagedWorldMaterialPlan>(
	cache: StagedWorldMaterialPlanCache | undefined,
	cacheKey: string,
	plan: TPlan,
	extraDependencyAssetIds: readonly string[],
	assetState: AssetChannelState,
): TPlan {
	if (!cache || isTransientStagedMaterialPlan(plan)) {
		return plan;
	}
	const dependencyAssetIds = uniqueNonEmptySortedStrings([
		...plan.preparedAssetIds,
		...extraDependencyAssetIds,
	]);
	cache.set(cacheKey, {
		plan,
		dependencyAssetIds,
		dependencyState: describeMaterialPlanDependencyState(
			assetState,
			dependencyAssetIds,
		),
	});
	return plan;
}

export function isTransientStagedMaterialPlan(
	material: StagedWorldMaterialPlan,
): boolean {
	if (material.kind !== "flat" || material.fallbackReasonCode === null) {
		return false;
	}
	return TRANSIENT_STAGED_MATERIAL_FALLBACK_REASONS.has(
		material.fallbackReasonCode,
	);
}

const TRANSIENT_STAGED_MATERIAL_FALLBACK_REASONS: ReadonlySet<string> = new Set(
	[
		"missing-material-recipe",
		"missing-render-surface",
		"indexed-paletted-deferred",
		"direct-color-normalization-deferred",
		"missing-decompressed-prepared-texture",
		"invalid-decompressed-prepared-texture",
	],
);

function describeStagedWorldMaterialPlanCacheKey(options: {
	slot: ResolvedMaterialSlot;
	fallbackColorKey: string;
	renderableKind?: StagedWorldMaterialRenderableKind;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	appearance?: MaterialAppearanceContext | null;
	detailOverlay?: ResolvedRegionDetailOverlayPlan | null;
}): string {
	const appearance =
		options.appearance ?? createBaseMaterialAppearanceContext("base");
	const capabilities =
		options.textureCapabilities ??
		defaultStagedWorldMaterialTextureCapabilities();
	return [
		`renderable=${options.renderableKind ?? "unknown"}`,
		`slot=${options.slot.slotIndex}`,
		`surface=${formatHex32(options.slot.surfaceId)}`,
		`material=${options.slot.materialAssetId}`,
		`variant=${options.slot.materialVariantSignature ?? "base"}`,
		`fallback=${options.fallbackColorKey}`,
		`appearance=${describeMaterialAppearanceSignature(appearance)}`,
		`textureFilter=${options.textureFilteringMode ?? "default"}`,
		`caps=${describeMaterialTextureCapabilities(capabilities)}`,
		`detail=${options.detailOverlay?.signature ?? "none"}`,
	].join("|");
}

function describeMaterialTextureCapabilities(
	capabilities: MaterialTextureCapabilities,
): string {
	return [
		`s3tc=${capabilities.supportsS3tc ? "1" : "0"}`,
		`s3tcSrgb=${capabilities.supportsS3tcSrgb ? "1" : "0"}`,
		`rgb565=${capabilities.supportsPackedRgb565 ? "1" : "0"}`,
		`rgba4444=${capabilities.supportsPackedRgba4444 ? "1" : "0"}`,
		`aniso=${capabilities.maxAnisotropy ?? "default"}`,
	].join(",");
}

function collectMaterialPlanDependencyAssetIds(
	materialAssetId: string,
	detailOverlay: ResolvedRegionDetailOverlayPlan | null,
	fallbackMaterialAssetId: string | null,
): readonly string[] {
	return uniqueNonEmptySortedStrings([
		materialAssetId,
		fallbackMaterialAssetId ?? "",
		detailOverlay?.profileAssetId ?? "",
		detailOverlay?.role.textureAssetId ?? "",
		detailOverlay
			? `render-surface/${formatHex32(detailOverlay.renderSurface.renderSurfaceId)}`
			: "",
	]);
}

function uniqueNonEmptySortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function describeMaterialPlanDependencyState(
	assetState: AssetChannelState,
	assetIds: readonly string[],
): string {
	return assetIds
		.map((assetId) => {
			const asset = assetState.preparedByAssetId[assetId];
			if (!asset) {
				return `${assetId}:missing`;
			}
			return [
				assetId,
				asset.payload.kind,
				asset.preparedAt,
				asset.payload.provenance.errorCode ?? "ok",
			].join(":");
		})
		.join("|");
}

function createFallbackMaterialPlan(options: {
	key: string;
	colorKey: string;
	behavior?: LegacyMaterialBehaviorDto | null;
	reason: string;
	reasonCode?: StagedWorldMaterialStrategyFallbackReason | null;
	preparedAssetIds?: readonly string[];
}): StagedWorldFlatMaterialPlan {
	return {
		kind: "flat",
		key: `flat/${options.key}`,
		color: buildFallbackColor(options.colorKey),
		behavior: options.behavior ?? null,
		fallbackReason: options.reason,
		fallbackReasonCode: options.reasonCode ?? null,
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
