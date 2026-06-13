import { resolveNormalizedPreparedTextureAssetIds } from "../assets/material-texture-preparation-policy";
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
import {
	defaultRenderMaterialTextureCapabilities,
	resolveRenderMaterialStrategy,
	type RenderMaterialTexturePageReadiness,
	type RenderMaterialStrategyFallbackReason,
	type RenderMaterialRenderableKind,
} from "./render-material-strategy";
import type {
	MaterialTextureCapabilities,
	RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import type { TextureFilteringMode } from "./texture-pages/texture-sampling-policy";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

export type RenderMaterialPlan =
	| RenderFlatMaterialPlan
	| RenderDirectTextureMaterialPlan
	| RenderIndexedPalettedMaterialPlan;

interface RenderMaterialPlanCacheRecord {
	plan: RenderMaterialPlan;
	dependencyAssetIds: readonly string[];
	dependencyState: string;
}

export interface RenderMaterialPlanCache {
	get(key: string): RenderMaterialPlanCacheRecord | undefined;
	set(key: string, value: RenderMaterialPlanCacheRecord): void;
	clear(): void;
}

interface RenderFlatMaterialPlan {
	kind: "flat";
	key: string;
	color: RenderVec4;
	behavior: LegacyMaterialBehaviorDto | null;
	fallbackReason: string | null;
	fallbackReasonCode: RenderMaterialStrategyFallbackReason | null;
	preparedAssetIds: readonly string[];
}

export interface RenderDirectTextureMaterialPlan {
	kind: "direct-texture";
	key: string;
	color: RenderVec4;
	textureKey: string;
	textureUpload: RenderSurfaceTextureUploadPreparation & { status: "ready" };
	behavior: LegacyMaterialBehaviorDto;
	fallbackReason: string | null;
	texturePageReadiness: RenderMaterialTexturePageReadiness | null;
	detailOverlay: ResolvedRegionDetailOverlayPlan | null;
	preparedAssetIds: readonly string[];
}

export interface RenderIndexedPalettedMaterialPlan {
	kind: "indexed-paletted";
	key: string;
	color: RenderVec4;
	indexedMaterial: ResolvedIndexedMaterialData;
	behavior: LegacyMaterialBehaviorDto;
	fallbackReason: string | null;
	detailOverlay: ResolvedRegionDetailOverlayPlan | null;
	preparedAssetIds: readonly string[];
}

export function resolveRenderMaterialSlotPlan(options: {
	assetReadModel: RendererAssetReadModel;
	slot: ResolvedMaterialSlot;
	fallbackColorKey: string;
	renderableKind?: RenderMaterialRenderableKind;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	appearance?: MaterialAppearanceContext | null;
	detailOverlay?: ResolvedRegionDetailOverlayPlan | null;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: RenderMaterialPlanCache;
}): RenderMaterialPlan {
	const inputCacheKey = describeRenderMaterialPlanCacheKey(options);
	const cached = options.materialPlanCache?.get(inputCacheKey);
	if (
		cached &&
		cached.dependencyState ===
			describeMaterialPlanDependencyState(
				options.assetReadModel,
				cached.dependencyAssetIds,
			)
	) {
		return cached.plan;
	}
	const strategy = resolveRenderMaterialStrategy({
		assetReadModel: options.assetReadModel,
		input: {
			slot: options.slot,
			renderableKind: options.renderableKind ?? "unknown",
			appearance:
				options.appearance ?? createBaseMaterialAppearanceContext("base"),
		},
		textureCapabilities:
			options.textureCapabilities ?? defaultRenderMaterialTextureCapabilities(),
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
			return cacheRenderMaterialPlan(
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
				options.assetReadModel,
			);
		}
		return cacheRenderMaterialPlan(
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
			options.assetReadModel,
		);
	}
	return cacheRenderMaterialPlan(
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
			texturePageReadiness: strategy.texturePageReadiness,
			detailOverlay: options.detailOverlay ?? null,
			preparedAssetIds: collectStrategyPreparedAssetIds(
				strategy,
				options.detailOverlay ?? null,
			),
		},
		materialAssetIds,
		options.assetReadModel,
	);
}

function cacheRenderMaterialPlan<TPlan extends RenderMaterialPlan>(
	cache: RenderMaterialPlanCache | undefined,
	cacheKey: string,
	plan: TPlan,
	extraDependencyAssetIds: readonly string[],
	assetReadModel: RendererAssetReadModel,
): TPlan {
	if (!cache || isTransientRenderMaterialPlan(plan)) {
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
			assetReadModel,
			dependencyAssetIds,
		),
	});
	return plan;
}

function isTransientRenderMaterialPlan(material: RenderMaterialPlan): boolean {
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

function describeRenderMaterialPlanCacheKey(options: {
	slot: ResolvedMaterialSlot;
	fallbackColorKey: string;
	renderableKind?: RenderMaterialRenderableKind;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	appearance?: MaterialAppearanceContext | null;
	detailOverlay?: ResolvedRegionDetailOverlayPlan | null;
}): string {
	const appearance =
		options.appearance ?? createBaseMaterialAppearanceContext("base");
	const capabilities =
		options.textureCapabilities ?? defaultRenderMaterialTextureCapabilities();
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
	assetReadModel: RendererAssetReadModel,
	assetIds: readonly string[],
): string {
	return assetIds
		.map((assetId) => {
			const asset = assetReadModel.get(assetId);
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
	reasonCode?: RenderMaterialStrategyFallbackReason | null;
	preparedAssetIds?: readonly string[];
}): RenderFlatMaterialPlan {
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
	strategy: ReturnType<typeof resolveRenderMaterialStrategy>,
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
		if (strategy.texturePageReadiness) {
			assetIds.add(
				strategy.texturePageReadiness.atlasEntry.preparedTextureAssetId,
			);
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
		for (const assetId of resolveNormalizedPreparedTextureAssetIds({
			renderSurface: detailOverlay.renderSurface,
			usage: "detail",
		})) {
			assetIds.add(assetId);
		}
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
