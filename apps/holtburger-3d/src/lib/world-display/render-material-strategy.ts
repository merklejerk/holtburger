import type {
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import { formatAtlasReadyPreparedTextureAssetId } from "../assets/types";
import { resolveNormalizedPreparedTextureAssetIds } from "../assets/material-texture-preparation-policy";
import { formatHex32 } from "../landblocks";
import {
	deriveLegacyMaterialBehaviorDto,
	type LegacyMaterialBehaviorDto,
} from "./material-behavior";
import {
	createBaseMaterialAppearanceContext,
	type MaterialAppearanceContext,
} from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import { formatMaterialAssetId } from "./material-signatures";
import { resolveFirstMaterialRenderSurface } from "./material-texture-resolution";
import {
	isIndexedTextureFormat,
	resolveIndexedMaterialData,
	type IndexedMaterialDataCache,
	type ResolvedIndexedMaterialData,
} from "./indexed-material-data";
import {
	hasSourceAlpha,
	isSupportedCompressedFormat,
	isSupportedDirectColorFormat,
} from "./render-surface-texture-data";
import {
	prepareRenderSurfaceTextureUploadData,
	type MaterialTextureCapabilities,
	type RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import {
	createDefaultMaterialTextureSamplingPolicy,
	selectVariantTextureSamplingPolicy,
	type TextureFilteringMode,
	type TextureWrapMode,
} from "./texture-pages/texture-sampling-policy";
import {
	planAtlasLayout,
	type AtlasTexturePage,
} from "./texture-pages/atlas-layout-planner";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

export type RenderMaterialRenderableKind =
	| "static"
	| "structured-interior"
	| "dynamic"
	| "terrain"
	| "unknown";

export type RenderMaterialStrategyFallbackReason =
	| "missing-material-recipe"
	| "solid-color-material"
	| "missing-render-surface"
	| "unsupported-surface-flags"
	| "blended-transparency"
	| "animated-uv"
	| "indexed-paletted-deferred"
	| "unsupported-render-surface-format"
	| "direct-color-normalization-deferred"
	| "missing-decompressed-prepared-texture"
	| "invalid-decompressed-prepared-texture"
	| "source-texture-too-large"
	| "atlas-full"
	| "material-table-overflow";

export interface RenderMaterialStrategyPolicy {
	maxAtlasTextureSize: number;
	maxAtlasTextureCount: number;
	baseGutterPixels: number;
	maxMaterialSlotsPerDraw: number;
}

const DEFAULT_RENDER_MATERIAL_STRATEGY_POLICY: RenderMaterialStrategyPolicy = {
	maxAtlasTextureSize: 4096,
	maxAtlasTextureCount: 8,
	baseGutterPixels: 2,
	maxMaterialSlotsPerDraw: 128,
};

export interface RenderMaterialStrategyInput {
	slot: ResolvedMaterialSlot;
	renderableKind: RenderMaterialRenderableKind;
	appearance?: MaterialAppearanceContext | null;
	textureVelocitySignature?: string | null;
}

type RenderMaterialStrategy =
	| RenderAtlasMaterialStrategy
	| RenderDirectTextureMaterialStrategy
	| RenderIndexedPalettedMaterialStrategy
	| RenderMaterialFallbackStrategy;

interface RenderAtlasMaterialStrategy {
	kind: "atlas";
	slot: ResolvedMaterialSlot;
	renderableKind: RenderMaterialRenderableKind;
	materialAssetId: string;
	materialSlotKey: string;
	materialTableSlotIndex: number;
	atlasEntryKey: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	samplingKey: string;
	behavior: LegacyMaterialBehaviorDto;
}

interface RenderAtlasCandidateStrategy extends RenderAtlasMaterialStrategy {
	atlasEntry: {
		renderSurfaceId: number;
		preparedTextureAssetId: string;
		level: PreparedTexturePayload["levels"][number];
		sourceHash: string;
		sourceFormatRaw: number;
	};
}

export interface RenderMaterialTexturePageReadiness {
	materialSlotKey: string;
	atlasEntryKey: string;
	renderStateKey: string;
	samplingKey: string;
	samplingPolicy: RenderAtlasSamplingPolicy;
	atlasEntry: RenderAtlasCandidateStrategy["atlasEntry"];
}

interface RenderAtlasSamplingPolicy {
	wrapS: TextureWrapMode;
	wrapT: TextureWrapMode;
}

export interface RenderDirectTextureMaterialStrategy {
	kind: "direct-texture";
	slot: ResolvedMaterialSlot;
	renderableKind: RenderMaterialRenderableKind;
	materialAssetId: string;
	key: string;
	textureKey: string;
	textureUpload: RenderSurfaceTextureUploadPreparation & { status: "ready" };
	renderStateKey: string;
	samplingKey: string;
	behavior: LegacyMaterialBehaviorDto;
	reason: RenderMaterialStrategyFallbackReason | null;
	detail: string | null;
	texturePageReadiness: RenderMaterialTexturePageReadiness | null;
}

export interface RenderIndexedPalettedMaterialStrategy {
	kind: "indexed-paletted";
	slot: ResolvedMaterialSlot;
	renderableKind: RenderMaterialRenderableKind;
	materialAssetId: string;
	key: string;
	indexedMaterial: ResolvedIndexedMaterialData;
	renderStateKey: string;
	samplingKey: string;
	behavior: LegacyMaterialBehaviorDto;
	reason: RenderMaterialStrategyFallbackReason | null;
	detail: string | null;
}

export interface RenderMaterialFallbackStrategy {
	kind: "flat-fallback" | "unsupported";
	slot: ResolvedMaterialSlot;
	renderableKind: RenderMaterialRenderableKind;
	materialAssetId: string;
	reason: RenderMaterialStrategyFallbackReason;
	detail: string;
	behavior: LegacyMaterialBehaviorDto | null;
}

interface RenderAtlasEntryPlan {
	key: string;
	renderSurfaceId: number;
	preparedTextureAssetId: string;
	width: number;
	height: number;
	sourceHash: string;
	sourceFormatRaw: number;
	transfer: "linear";
}

type RenderAtlasTexturePlan = AtlasTexturePage;

interface RenderAtlasDrawSlicePlan {
	key: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: string[];
}

interface RenderAtlasSetGenerationPlan {
	key: string;
	generation: number;
	policy: RenderMaterialStrategyPolicy;
	atlasEntries: RenderAtlasEntryPlan[];
	atlasTextures: RenderAtlasTexturePlan[];
	drawSlices: RenderAtlasDrawSlicePlan[];
}

export interface RenderMaterialStrategyPlan {
	atlasSet: RenderAtlasSetGenerationPlan;
	atlasLayoutDecisions: RenderMaterialStrategy[];
	fallbackReasonCounts: Partial<
		Record<RenderMaterialStrategyFallbackReason, number>
	>;
}

interface AtlasCandidate {
	input: RenderMaterialStrategyInput;
	materialAssetId: string;
	materialSlotKey: string;
	atlasEntryKey: string;
	renderStateKey: string;
	samplingKey: string;
	behavior: LegacyMaterialBehaviorDto;
	entry: RenderAtlasEntryPlan;
}

export function planRenderMaterialStrategies(options: {
	assetReadModel: RendererAssetReadModel;
	requirements: readonly RenderMaterialStrategyInput[];
	policy?: Partial<RenderMaterialStrategyPolicy>;
	generation?: number;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
}): RenderMaterialStrategyPlan {
	const policy = normalizePolicy(options.policy);
	const candidates: AtlasCandidate[] = [];
	const atlasLayoutDecisions: RenderMaterialStrategy[] = [];
	for (const input of options.requirements) {
		const candidate = evaluateAtlasCandidate({
			assetReadModel: options.assetReadModel,
			input,
			policy,
			textureCapabilities:
				options.textureCapabilities ??
				defaultRenderMaterialTextureCapabilities(),
			textureFilteringMode: options.textureFilteringMode,
		});
		if (candidate.kind === "candidate") {
			candidates.push(candidate.candidate);
		} else {
			atlasLayoutDecisions.push(candidate.requirement);
		}
	}

	const entries = dedupeAtlasEntries(candidates);
	const layoutPlan = planAtlasLayout({
		entries,
		policy: {
			maxTextureSize: policy.maxAtlasTextureSize,
			maxTextureCount: policy.maxAtlasTextureCount,
			gutterPixels: policy.baseGutterPixels,
		},
	});
	const placedCandidates = candidates.filter((candidate) =>
		layoutPlan.placementsByEntryKey.has(candidate.atlasEntryKey),
	);
	const materialTableSlotByKey = assignMaterialTableSlots(
		placedCandidates,
		policy,
	);
	for (const candidate of candidates) {
		const placement = layoutPlan.placementsByEntryKey.get(
			candidate.atlasEntryKey,
		);
		if (!placement) {
			const overflow = layoutPlan.overflowsByEntryKey.get(
				candidate.atlasEntryKey,
			);
			atlasLayoutDecisions.push(
				createFallbackRequirement({
					input: candidate.input,
					materialAssetId: candidate.materialAssetId,
					behavior: candidate.behavior,
					kind: "flat-fallback",
					reason:
						overflow?.reason === "source-too-large"
							? "source-texture-too-large"
							: "atlas-full",
					detail:
						overflow?.detail ??
						`atlas entry ${candidate.atlasEntryKey} did not fit in ${policy.maxAtlasTextureCount} atlas textures`,
				}),
			);
			continue;
		}
		const materialTableSlotIndex = materialTableSlotByKey.get(
			candidate.materialSlotKey,
		);
		if (materialTableSlotIndex === undefined) {
			atlasLayoutDecisions.push(
				createFallbackRequirement({
					input: candidate.input,
					materialAssetId: candidate.materialAssetId,
					behavior: candidate.behavior,
					kind: "flat-fallback",
					reason: "material-table-overflow",
					detail: `material table exceeded ${policy.maxMaterialSlotsPerDraw} slots`,
				}),
			);
			continue;
		}
		atlasLayoutDecisions.push({
			kind: "atlas",
			slot: candidate.input.slot,
			renderableKind: candidate.input.renderableKind,
			materialAssetId: candidate.materialAssetId,
			materialSlotKey: candidate.materialSlotKey,
			materialTableSlotIndex,
			atlasEntryKey: candidate.atlasEntryKey,
			atlasTextureIndex: placement.textureIndex,
			renderStateKey: candidate.renderStateKey,
			samplingKey: candidate.samplingKey,
			behavior: candidate.behavior,
		});
	}

	const sortedRequirements = sortMaterialStrategies(atlasLayoutDecisions);
	const drawSlices = createDrawSlicePlans(sortedRequirements);
	return {
		atlasSet: {
			key: describeAtlasSetKey({
				entries,
				policy,
				materialSlots: [...materialTableSlotByKey.keys()],
			}),
			generation: options.generation ?? 0,
			policy,
			atlasEntries: entries,
			atlasTextures: [...layoutPlan.texturePages],
			drawSlices,
		},
		atlasLayoutDecisions: sortedRequirements,
		fallbackReasonCounts: countFallbackReasons(sortedRequirements),
	};
}

function evaluateAtlasCandidate(options: {
	assetReadModel: RendererAssetReadModel;
	input: RenderMaterialStrategyInput;
	policy: RenderMaterialStrategyPolicy;
	textureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
}):
	| { kind: "candidate"; candidate: AtlasCandidate }
	| { kind: "strategy"; requirement: RenderMaterialStrategy } {
	const resolvedStrategy = resolveRenderMaterialStrategy({
		assetReadModel: options.assetReadModel,
		input: options.input,
		textureCapabilities: options.textureCapabilities,
		textureFilteringMode: options.textureFilteringMode,
	});
	if (
		resolvedStrategy.kind !== "direct-texture" ||
		resolvedStrategy.reason !== null ||
		!resolvedStrategy.texturePageReadiness
	) {
		return { kind: "strategy", requirement: resolvedStrategy };
	}
	const texturePageReadiness = resolvedStrategy.texturePageReadiness;
	const level = texturePageReadiness.atlasEntry.level;
	return {
		kind: "candidate",
		candidate: {
			input: options.input,
			materialAssetId: resolvedStrategy.materialAssetId,
			materialSlotKey: texturePageReadiness.materialSlotKey,
			atlasEntryKey: texturePageReadiness.atlasEntryKey,
			renderStateKey: texturePageReadiness.renderStateKey,
			samplingKey: texturePageReadiness.samplingKey,
			behavior: resolvedStrategy.behavior,
			entry: {
				key: texturePageReadiness.atlasEntryKey,
				renderSurfaceId: texturePageReadiness.atlasEntry.renderSurfaceId,
				preparedTextureAssetId:
					texturePageReadiness.atlasEntry.preparedTextureAssetId,
				width: level.width,
				height: level.height,
				sourceHash: texturePageReadiness.atlasEntry.sourceHash,
				sourceFormatRaw: texturePageReadiness.atlasEntry.sourceFormatRaw,
				transfer: "linear",
			},
		},
	};
}

export function resolveRenderMaterialStrategy(options: {
	assetReadModel: RendererAssetReadModel;
	input: RenderMaterialStrategyInput;
	textureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
}):
	| RenderDirectTextureMaterialStrategy
	| RenderIndexedPalettedMaterialStrategy
	| RenderMaterialFallbackStrategy {
	const materialAssetId =
		options.input.slot.materialAssetId ||
		formatMaterialAssetId(options.input.slot.surfaceId);
	const recipeAsset = options.assetReadModel.get(materialAssetId);
	if (recipeAsset?.payload.kind !== "material-recipe") {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId,
			behavior: null,
			kind: "flat-fallback",
			reason: "missing-material-recipe",
			detail: `missing material recipe ${materialAssetId}`,
		});
	}
	const recipe = recipeAsset.payload;
	const behavior = deriveLegacyMaterialBehaviorDto({ recipe });
	const fallbackReason = atlasFallbackReasonForRecipe({
		input: options.input,
		recipe,
		behavior,
	});
	const blendedTransparencyReason =
		fallbackReason?.reason === "blended-transparency" ? fallbackReason : null;
	if (fallbackReason && fallbackReason.reason !== "blended-transparency") {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId,
			behavior,
			kind:
				fallbackReason.reason === "solid-color-material"
					? "flat-fallback"
					: "unsupported",
			reason: fallbackReason.reason,
			detail: fallbackReason.detail,
		});
	}

	const resolvedSurface = resolveFirstMaterialRenderSurface({
		recipe,
		assetReadModel: options.assetReadModel,
	});
	if (!resolvedSurface) {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId,
			behavior,
			kind: "flat-fallback",
			reason: "missing-render-surface",
			detail: `material ${materialAssetId} has no prepared render surface`,
		});
	}

	const surface = resolvedSurface.renderSurface;
	if (!isSupportedCompressedFormat(surface.formatRaw)) {
		if (isSupportedDirectColorFormat(surface.formatRaw)) {
			return resolveDirectTextureStrategy({
				assetReadModel: options.assetReadModel,
				behaviorReason: blendedTransparencyReason,
				input: options.input,
				materialAssetId,
				recipe,
				textureCapabilities:
					options.textureCapabilities ??
					defaultRenderMaterialTextureCapabilities(),
				textureFilteringMode: options.textureFilteringMode,
			});
		}
		if (isIndexedTextureFormat(surface.formatRaw)) {
			return resolveIndexedPalettedTextureStrategy({
				assetReadModel: options.assetReadModel,
				input: options.input,
				materialAssetId,
				recipe,
				textureCapabilities:
					options.textureCapabilities ??
					defaultRenderMaterialTextureCapabilities(),
				indexedMaterialDataCache: options.indexedMaterialDataCache,
			});
		}
		return createFallbackRequirement({
			input: options.input,
			materialAssetId,
			behavior: deriveLegacyMaterialBehaviorDto({
				recipe,
				hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
			}),
			kind: "unsupported",
			reason: "unsupported-render-surface-format",
			detail: `render surface ${formatHex32(surface.renderSurfaceId)} format ${surface.format} is not atlas-ready`,
		});
	}

	const preparedTextureAssetId = formatAtlasReadyPreparedTextureAssetId({
		renderSurfaceId: surface.renderSurfaceId,
		usage: "raw",
	});
	const preparedTextureAsset = options.assetReadModel.get(
		preparedTextureAssetId,
	);
	if (preparedTextureAsset?.payload.kind !== "prepared-texture") {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId,
			behavior: deriveLegacyMaterialBehaviorDto({
				recipe,
				hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
			}),
			kind: "flat-fallback",
			reason: "missing-decompressed-prepared-texture",
			detail: `missing atlas-ready prepared texture ${preparedTextureAssetId}`,
		});
	}

	const preparedTexture = preparedTextureAsset.payload;
	const validTexture = validateAtlasPreparedTexture(surface, preparedTexture);
	if (validTexture !== null) {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId,
			behavior: deriveLegacyMaterialBehaviorDto({
				recipe,
				hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
			}),
			kind: "flat-fallback",
			reason: "invalid-decompressed-prepared-texture",
			detail: validTexture,
		});
	}

	const level = preparedTexture.levels[0];
	if (!level) {
		throw new Error(
			`Prepared texture ${preparedTextureAssetId} passed validation without a level-0 payload.`,
		);
	}
	const behaviorWithAlpha = deriveLegacyMaterialBehaviorDto({
		recipe,
		hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
	});
	const samplingPolicy = selectVariantTextureSamplingPolicy(
		surface,
		createDefaultMaterialTextureSamplingPolicy(
			options.textureCapabilities ?? defaultRenderMaterialTextureCapabilities(),
			options.textureFilteringMode,
		),
		options.input.slot.materialVariantSignature,
	);
	const atlasSamplingPolicy = {
		wrapS: samplingPolicy.wrapS,
		wrapT: samplingPolicy.wrapT,
	} satisfies RenderAtlasSamplingPolicy;
	const samplingKey = describeAtlasSamplingKey(atlasSamplingPolicy);
	const renderStateKey = describeAtlasRenderStateKey(behaviorWithAlpha);
	const atlasEntryKey = describeAtlasEntryKey({
		renderSurface: surface,
		preparedTexture,
	});
	return resolveDirectTextureStrategy({
		assetReadModel: options.assetReadModel,
		behaviorReason: blendedTransparencyReason,
		input: options.input,
		materialAssetId,
		recipe,
		textureCapabilities:
			options.textureCapabilities ?? defaultRenderMaterialTextureCapabilities(),
		textureFilteringMode: options.textureFilteringMode,
		texturePageReadiness: {
			materialSlotKey: describeMaterialSlotKey({
				materialAssetId,
				atlasEntryKey,
				behavior: behaviorWithAlpha,
				samplingKey,
				renderStateKey,
				materialVariantSignature:
					options.input.slot.materialVariantSignature ?? null,
			}),
			atlasEntryKey,
			renderStateKey,
			samplingKey,
			samplingPolicy: atlasSamplingPolicy,
			atlasEntry: {
				renderSurfaceId: surface.renderSurfaceId,
				preparedTextureAssetId,
				level,
				sourceHash: preparedTexture.sourceHash,
				sourceFormatRaw: preparedTexture.sourceFormatRaw,
			},
		},
	});
}

function resolveIndexedPalettedTextureStrategy(options: {
	assetReadModel: RendererAssetReadModel;
	input: RenderMaterialStrategyInput;
	materialAssetId: string;
	recipe: PreparedMaterialRecipePayload;
	textureCapabilities: MaterialTextureCapabilities;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
}): RenderIndexedPalettedMaterialStrategy | RenderMaterialFallbackStrategy {
	const resolvedSurface = resolveFirstMaterialRenderSurface({
		recipe: options.recipe,
		assetReadModel: options.assetReadModel,
	});
	if (!resolvedSurface) {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId: options.materialAssetId,
			behavior: deriveLegacyMaterialBehaviorDto({
				recipe: options.recipe,
				usesIndexedClipDiscard: true,
			}),
			kind: "flat-fallback",
			reason: "missing-render-surface",
			detail: `material ${options.materialAssetId} has no prepared indexed render surface`,
		});
	}
	const samplingPolicy = selectVariantTextureSamplingPolicy(
		resolvedSurface.renderSurface,
		createDefaultMaterialTextureSamplingPolicy(options.textureCapabilities),
		options.input.slot.materialVariantSignature,
	);
	let indexedMaterial: ResolvedIndexedMaterialData | null = null;
	let resolveError: unknown = null;
	try {
		indexedMaterial = resolveIndexedMaterialData({
			assetReadModel: options.assetReadModel,
			slot: options.input.slot,
			appearance:
				options.input.appearance ?? createBaseMaterialAppearanceContext("base"),
			samplingPolicy,
			cache: options.indexedMaterialDataCache,
		});
	} catch (error) {
		resolveError = error;
	}
	if (!indexedMaterial) {
		const behavior = deriveLegacyMaterialBehaviorDto({
			recipe: options.recipe,
			usesIndexedClipDiscard: true,
		});
		return createFallbackRequirement({
			input: options.input,
			materialAssetId: options.materialAssetId,
			behavior,
			kind: "flat-fallback",
			reason: "indexed-paletted-deferred",
			detail: [
				`render surface ${formatHex32(resolvedSurface.renderSurface.renderSurfaceId)} format ${resolvedSurface.renderSurface.format} could not resolve indexed palette resources`,
				resolveError instanceof Error ? resolveError.message : null,
			]
				.filter((part) => part !== null)
				.join(": "),
		});
	}
	const renderStateKey = describeIndexedRenderStateKey(
		indexedMaterial.behavior,
	);
	const samplingKey = describeIndexedSamplingKey(indexedMaterial);
	return {
		kind: "indexed-paletted",
		slot: options.input.slot,
		renderableKind: options.input.renderableKind,
		materialAssetId: options.materialAssetId,
		key: [
			"indexed-paletted",
			options.materialAssetId,
			indexedMaterial.renderSurfaceAssetId,
			describeIndexedPaletteKey(indexedMaterial.palette),
			indexedMaterial.neighborPackedTexture.format,
			renderStateKey,
			samplingKey,
		].join("|"),
		indexedMaterial,
		renderStateKey,
		samplingKey,
		behavior: indexedMaterial.behavior,
		reason:
			indexedMaterial.samplingPolicy.generateMipmaps ||
			indexedMaterial.samplingPolicy.mipFilter !== "none"
				? "indexed-paletted-deferred"
				: null,
		detail:
			indexedMaterial.samplingPolicy.generateMipmaps ||
			indexedMaterial.samplingPolicy.mipFilter !== "none"
				? "indexed materials intentionally disable hardware mipmapping until a palette-safe mip policy exists"
				: null,
	};
}

export function defaultRenderMaterialTextureCapabilities(): MaterialTextureCapabilities {
	return {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
		supportsPackedRgb565: false,
		supportsPackedRgba4444: false,
		maxAnisotropy: 1,
	};
}

function describeRenderMaterialDirectTextureKey(
	upload: Extract<
		RenderSurfaceTextureUploadPreparation,
		{ status: "ready" }
	>["upload"],
): string {
	return [
		"texture",
		formatHex32(upload.renderSurfaceId),
		upload.sourceFormatRaw,
		upload.width,
		upload.height,
		upload.samplingPolicy.colorSpace,
		upload.samplingPolicy.wrapS,
		upload.samplingPolicy.wrapT,
		upload.samplingPolicy.minFilter,
		upload.samplingPolicy.magFilter,
		upload.samplingPolicy.mipFilter,
	].join("/");
}

function resolveDirectTextureStrategy(options: {
	assetReadModel: RendererAssetReadModel;
	behaviorReason: {
		reason: RenderMaterialStrategyFallbackReason;
		detail: string;
	} | null;
	input: RenderMaterialStrategyInput;
	materialAssetId: string;
	recipe: PreparedMaterialRecipePayload;
	textureCapabilities: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	texturePageReadiness?: RenderMaterialTexturePageReadiness | null;
}): RenderDirectTextureMaterialStrategy | RenderMaterialFallbackStrategy {
	const resolvedSurface = resolveFirstMaterialRenderSurface({
		recipe: options.recipe,
		assetReadModel: options.assetReadModel,
	});
	if (!resolvedSurface) {
		return createFallbackRequirement({
			input: options.input,
			materialAssetId: options.materialAssetId,
			behavior: deriveLegacyMaterialBehaviorDto({ recipe: options.recipe }),
			kind: "flat-fallback",
			reason: "missing-render-surface",
			detail: `material ${options.materialAssetId} has no prepared render surface`,
		});
	}
	const directRenderSurface = resolvedSurface.renderSurface;
	const samplingPolicy = selectVariantTextureSamplingPolicy(
		directRenderSurface,
		createDefaultMaterialTextureSamplingPolicy(
			options.textureCapabilities,
			options.textureFilteringMode,
		),
		options.input.slot.materialVariantSignature,
	);
	const textureUpload = prepareRenderSurfaceTextureUploadData(
		directRenderSurface,
		samplingPolicy,
		options.textureCapabilities,
		resolvePreparedTexture({
			assetReadModel: options.assetReadModel,
			renderSurface: directRenderSurface,
		}),
	);
	if (textureUpload.status !== "ready") {
		const behavior = deriveLegacyMaterialBehaviorDto({
			recipe: options.recipe,
			hasSourceAlpha: hasSourceAlpha(directRenderSurface.formatRaw),
		});
		return createFallbackRequirement({
			input: options.input,
			materialAssetId: options.materialAssetId,
			behavior,
			kind: "flat-fallback",
			reason:
				options.behaviorReason?.reason ??
				"missing-decompressed-prepared-texture",
			detail: `material ${options.materialAssetId} texture ${formatHex32(directRenderSurface.renderSurfaceId)} is ${textureUpload.reason}`,
		});
	}
	if (textureUpload.upload.kind !== "direct") {
		const behavior = deriveLegacyMaterialBehaviorDto({
			recipe: options.recipe,
			hasSourceAlpha: textureUpload.upload.hasSourceAlpha,
		});
		return createFallbackRequirement({
			input: options.input,
			materialAssetId: options.materialAssetId,
			behavior,
			kind: "unsupported",
			reason: "unsupported-render-surface-format",
			detail: `material ${options.materialAssetId} texture ${formatHex32(directRenderSurface.renderSurfaceId)} resolved a compressed upload, which WebGL2 direct rendering does not support`,
		});
	}
	const behavior = deriveLegacyMaterialBehaviorDto({
		recipe: options.recipe,
		hasSourceAlpha: textureUpload.upload.hasSourceAlpha,
	});
	const textureKey = describeRenderMaterialDirectTextureKey(
		textureUpload.upload,
	);
	const renderStateKey = describeDirectRenderStateKey(behavior);
	const samplingKey = describeDirectSamplingKey(textureUpload.upload);
	return {
		kind: "direct-texture",
		slot: options.input.slot,
		renderableKind: options.input.renderableKind,
		materialAssetId: options.materialAssetId,
		key: [
			"direct-texture",
			options.materialAssetId,
			textureKey,
			behavior.blend.mode,
			behavior.alphaTest,
			behavior.blend.depthWrite ? "depth-write" : "depth-read",
		].join("|"),
		textureKey,
		textureUpload,
		renderStateKey,
		samplingKey,
		behavior,
		reason: options.behaviorReason?.reason ?? null,
		detail: options.behaviorReason?.detail ?? null,
		texturePageReadiness: options.texturePageReadiness ?? null,
	};
}

function atlasFallbackReasonForRecipe(options: {
	input: RenderMaterialStrategyInput;
	recipe: PreparedMaterialRecipePayload;
	behavior: LegacyMaterialBehaviorDto;
}): {
	reason: RenderMaterialStrategyFallbackReason;
	detail: string;
} | null {
	if (options.recipe.source.kind !== "texture") {
		return {
			reason: "solid-color-material",
			detail: `material ${formatHex32(options.recipe.surfaceId)} is solid color`,
		};
	}
	if (options.behavior.unsupportedSurfaceFlags.length > 0) {
		return {
			reason: "unsupported-surface-flags",
			detail: `unsupported material flags: ${options.behavior.unsupportedSurfaceFlags.join(", ")}`,
		};
	}
	if (options.input.textureVelocitySignature) {
		return {
			reason: "animated-uv",
			detail: `texture velocity ${options.input.textureVelocitySignature} is not atlas-batchable yet`,
		};
	}
	if (
		options.behavior.blend.enabled &&
		options.behavior.blend.mode !== "clipmap"
	) {
		return {
			reason: "blended-transparency",
			detail: `blend mode ${options.behavior.blend.mode} stays on direct/fallback path`,
		};
	}
	return null;
}

function validateAtlasPreparedTexture(
	renderSurface: PreparedRenderSurfacePayload,
	preparedTexture: PreparedTexturePayload,
): string | null {
	if (preparedTexture.renderSurfaceId !== renderSurface.renderSurfaceId) {
		return `prepared texture render surface ${formatHex32(preparedTexture.renderSurfaceId)} does not match ${formatHex32(renderSurface.renderSurfaceId)}`;
	}
	if (
		preparedTexture.outputFormat !== "rgba8" ||
		preparedTexture.mipPolicy !== "none" ||
		preparedTexture.colorSpace !== "linear"
	) {
		return `prepared texture ${formatHex32(renderSurface.renderSurfaceId)} is ${preparedTexture.outputFormat}/${preparedTexture.mipPolicy}/${preparedTexture.colorSpace}, expected rgba8/none/linear`;
	}
	if (preparedTexture.levels.length !== 1) {
		return `prepared texture ${formatHex32(renderSurface.renderSurfaceId)} has ${preparedTexture.levels.length} levels, expected 1`;
	}
	const level = preparedTexture.levels[0];
	if (!level || level.width <= 0 || level.height <= 0) {
		return `prepared texture ${formatHex32(renderSurface.renderSurfaceId)} has invalid level-0 dimensions`;
	}
	if (level.bytes.byteLength !== level.width * level.height * 4) {
		return `prepared texture ${formatHex32(renderSurface.renderSurfaceId)} expected ${level.width * level.height * 4} rgba8 bytes, got ${level.bytes.byteLength}`;
	}
	return null;
}

function resolvePreparedTexture(options: {
	assetReadModel: RendererAssetReadModel;
	renderSurface: PreparedRenderSurfacePayload;
}): PreparedTexturePayload | null {
	for (const assetId of resolveNormalizedPreparedTextureAssetIds({
		renderSurface: options.renderSurface,
		usage: "raw",
	})) {
		const asset = options.assetReadModel.get(assetId);
		if (asset?.payload.kind === "prepared-texture") {
			return asset.payload;
		}
	}
	return null;
}

function dedupeAtlasEntries(
	candidates: readonly AtlasCandidate[],
): RenderAtlasEntryPlan[] {
	const entriesByKey = new Map<string, RenderAtlasEntryPlan>();
	for (const candidate of candidates) {
		entriesByKey.set(candidate.entry.key, candidate.entry);
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function assignMaterialTableSlots(
	candidates: readonly AtlasCandidate[],
	policy: RenderMaterialStrategyPolicy,
): Map<string, number> {
	const keys = [
		...new Set(candidates.map((candidate) => candidate.materialSlotKey)),
	].sort();
	const slotByKey = new Map<string, number>();
	for (const [index, key] of keys
		.slice(0, policy.maxMaterialSlotsPerDraw)
		.entries()) {
		slotByKey.set(key, index);
	}
	return slotByKey;
}

function createFallbackRequirement(options: {
	input: RenderMaterialStrategyInput;
	materialAssetId: string;
	kind: RenderMaterialFallbackStrategy["kind"];
	reason: RenderMaterialStrategyFallbackReason;
	detail: string;
	behavior: LegacyMaterialBehaviorDto | null;
}): RenderMaterialFallbackStrategy {
	return {
		kind: options.kind,
		slot: options.input.slot,
		renderableKind: options.input.renderableKind,
		materialAssetId: options.materialAssetId,
		reason: options.reason,
		detail: options.detail,
		behavior: options.behavior,
	};
}

function describeAtlasEntryKey(options: {
	renderSurface: PreparedRenderSurfacePayload;
	preparedTexture: PreparedTexturePayload;
}): string {
	return [
		"atlas-entry",
		formatHex32(options.renderSurface.renderSurfaceId),
		options.preparedTexture.sourceHash,
		options.preparedTexture.sourceFormatRaw,
		options.preparedTexture.sourceWidth,
		options.preparedTexture.sourceHeight,
		"rgba8",
		"linear",
	].join("|");
}

function describeAtlasSamplingKey(policy: RenderAtlasSamplingPolicy): string {
	return [
		`wrap=${policy.wrapS}/${policy.wrapT}`,
		"filter=linear/linear/linear",
		"color=linear",
		"mips=atlas",
	].join(";");
}

function describeAtlasRenderStateKey(
	behavior: LegacyMaterialBehaviorDto,
): string {
	return [
		"shader=atlas-color",
		`blend=${behavior.blend.mode}`,
		`depth=${behavior.blend.depthWrite ? "write" : "read"}`,
		`alphaTest=${behavior.alphaTest}`,
		`side=${behavior.side}`,
	].join(";");
}

function describeDirectRenderStateKey(
	behavior: LegacyMaterialBehaviorDto,
): string {
	return [
		"shader=direct-texture",
		`blend=${behavior.blend.mode}`,
		`depth=${behavior.blend.depthWrite ? "write" : "read"}`,
		`alphaTest=${behavior.alphaTest}`,
		`side=${behavior.side}`,
	].join(";");
}

function describeIndexedRenderStateKey(
	behavior: LegacyMaterialBehaviorDto,
): string {
	return [
		"shader=indexed-paletted",
		`blend=${behavior.blend.mode}`,
		`depth=${behavior.blend.depthWrite ? "write" : "read"}`,
		`alphaTest=${behavior.alphaTest}`,
		`side=${behavior.side}`,
	].join(";");
}

function describeIndexedSamplingKey(
	indexedMaterial: ResolvedIndexedMaterialData,
): string {
	const policy = indexedMaterial.samplingPolicy;
	return [
		"indexed-sampling",
		`format=${indexedMaterial.texture.format}`,
		`wrap=${policy.wrapS}/${policy.wrapT}`,
		"filter=shader-linear",
		"mips=deferred",
		`palette=${describeIndexedPaletteKey(indexedMaterial.palette)}`,
	].join(";");
}

function describeIndexedPaletteKey(
	palette: ResolvedIndexedMaterialData["palette"],
): string {
	return "key" in palette ? palette.key : palette.paletteAssetId;
}

function describeDirectSamplingKey(
	upload: Extract<
		RenderSurfaceTextureUploadPreparation,
		{ status: "ready" }
	>["upload"],
): string {
	const policy = upload.samplingPolicy;
	return [
		"direct-sampling",
		`wrap=${policy.wrapS}/${policy.wrapT}`,
		`filter=${policy.minFilter}/${policy.magFilter}/${policy.mipFilter}`,
		`color=${policy.colorSpace}`,
		`source=${formatHex32(upload.renderSurfaceId)}/${upload.sourceFormatRaw}`,
	].join(";");
}

function describeMaterialSlotKey(options: {
	materialAssetId: string;
	atlasEntryKey: string;
	behavior: LegacyMaterialBehaviorDto;
	samplingKey: string;
	renderStateKey: string;
	materialVariantSignature: string | null;
}): string {
	return [
		"atlas-material",
		options.materialAssetId,
		options.atlasEntryKey,
		options.samplingKey,
		options.renderStateKey,
		options.materialVariantSignature ?? "base",
		`color=${options.behavior.color.join("/")}`,
		`opacity=${options.behavior.opacity}`,
	].join("|");
}

function describeAtlasSetKey(options: {
	entries: readonly RenderAtlasEntryPlan[];
	policy: RenderMaterialStrategyPolicy;
	materialSlots: readonly string[];
}): string {
	return [
		"render-material-atlas-set",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		...options.entries.map((entry) => entry.key),
		...options.materialSlots,
	].join("|");
}

function sortMaterialStrategies(
	requirements: readonly RenderMaterialStrategy[],
): RenderMaterialStrategy[] {
	return [...requirements].sort(
		(left, right) =>
			left.slot.slotIndex - right.slot.slotIndex ||
			left.materialAssetId.localeCompare(right.materialAssetId) ||
			left.renderableKind.localeCompare(right.renderableKind) ||
			describeStrategySortKey(left).localeCompare(
				describeStrategySortKey(right),
			),
	);
}

function countFallbackReasons(
	requirements: readonly RenderMaterialStrategy[],
): Partial<Record<RenderMaterialStrategyFallbackReason, number>> {
	const counts: Partial<Record<RenderMaterialStrategyFallbackReason, number>> =
		{};
	for (const requirement of requirements) {
		if (
			requirement.kind !== "flat-fallback" &&
			requirement.kind !== "unsupported"
		) {
			continue;
		}
		counts[requirement.reason] = (counts[requirement.reason] ?? 0) + 1;
	}
	return counts;
}

function describeStrategySortKey(requirement: RenderMaterialStrategy): string {
	switch (requirement.kind) {
		case "atlas":
			return requirement.materialSlotKey;
		case "direct-texture":
			return requirement.key;
		case "indexed-paletted":
			return requirement.key;
		case "flat-fallback":
		case "unsupported":
			return requirement.reason;
	}
}

function createDrawSlicePlans(
	requirements: readonly RenderMaterialStrategy[],
): RenderAtlasDrawSlicePlan[] {
	const groupByKey = new Map<
		string,
		{
			atlasTextureIndex: number;
			renderStateKey: string;
			slotIndices: number[];
			materialSlotKeys: Set<string>;
		}
	>();
	for (const requirement of requirements) {
		if (requirement.kind !== "atlas") {
			continue;
		}
		const key = [
			requirement.atlasTextureIndex,
			requirement.renderStateKey,
		].join("|");
		const group = groupByKey.get(key) ?? {
			atlasTextureIndex: requirement.atlasTextureIndex,
			renderStateKey: requirement.renderStateKey,
			slotIndices: [],
			materialSlotKeys: new Set<string>(),
		};
		group.slotIndices.push(requirement.materialTableSlotIndex);
		group.materialSlotKeys.add(requirement.materialSlotKey);
		groupByKey.set(key, group);
	}
	return [...groupByKey.values()]
		.sort(
			(left, right) =>
				left.atlasTextureIndex - right.atlasTextureIndex ||
				left.renderStateKey.localeCompare(right.renderStateKey),
		)
		.map((group) => {
			const materialTableSlotStart = Math.min(...group.slotIndices);
			const materialTableSlotEnd = Math.max(...group.slotIndices);
			return {
				key: [
					"atlas-draw-slice",
					`texture=${group.atlasTextureIndex}`,
					group.renderStateKey,
					`table=${materialTableSlotStart}-${materialTableSlotEnd}`,
				].join("|"),
				atlasTextureIndex: group.atlasTextureIndex,
				renderStateKey: group.renderStateKey,
				materialTableSlotStart,
				materialTableSlotCount:
					materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys: [...group.materialSlotKeys].sort(),
			};
		});
}

function normalizePolicy(
	policy: Partial<RenderMaterialStrategyPolicy> | undefined,
): RenderMaterialStrategyPolicy {
	const normalized = {
		...DEFAULT_RENDER_MATERIAL_STRATEGY_POLICY,
		...policy,
	};
	if (normalized.maxAtlasTextureSize <= normalized.baseGutterPixels * 2) {
		throw new Error(
			"Render material atlas max texture size must exceed its gutters.",
		);
	}
	if (normalized.maxAtlasTextureCount <= 0) {
		throw new Error("Render material atlas texture count must be positive.");
	}
	if (normalized.maxMaterialSlotsPerDraw <= 0) {
		throw new Error(
			"Render material atlas material table size must be positive.",
		);
	}
	return normalized;
}
