import type {
	AssetChannelState,
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import { formatAtlasReadyPreparedTextureAssetId } from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	deriveLegacyMaterialBehaviorDto,
	type LegacyMaterialBehaviorDto,
} from "./material-behavior";
import type { ResolvedMaterialSlot } from "./material-plan";
import { formatMaterialAssetId } from "./material-signatures";
import { resolveFirstMaterialRenderSurface } from "./material-texture-resolution";
import {
	hasSourceAlpha,
	isSupportedCompressedFormat,
	isSupportedDirectColorFormat,
} from "./render-surface-texture-resources";

type LumaAtlasPlannerRenderableKind =
	| "static"
	| "structured-interior"
	| "dynamic"
	| "terrain"
	| "unknown";

type LumaAtlasFallbackReason =
	| "missing-material-recipe"
	| "solid-color-material"
	| "missing-render-surface"
	| "unsupported-surface-flags"
	| "blended-transparency"
	| "animated-uv"
	| "unsupported-render-surface-format"
	| "direct-color-normalization-deferred"
	| "missing-decompressed-prepared-texture"
	| "invalid-decompressed-prepared-texture"
	| "source-texture-too-large"
	| "atlas-full"
	| "material-table-overflow";

export interface LumaAtlasPlannerPolicy {
	maxAtlasTextureSize: number;
	maxAtlasTextureCount: number;
	baseGutterPixels: number;
	maxMaterialSlotsPerDraw: number;
}

const DEFAULT_LUMA_ATLAS_PLANNER_POLICY: LumaAtlasPlannerPolicy = {
	maxAtlasTextureSize: 4096,
	maxAtlasTextureCount: 8,
	baseGutterPixels: 2,
	maxMaterialSlotsPerDraw: 128,
};

export interface LumaAtlasMaterialRequirementInput {
	slot: ResolvedMaterialSlot;
	renderableKind: LumaAtlasPlannerRenderableKind;
	textureVelocitySignature?: string | null;
}

type LumaAtlasMaterialRequirement =
	| LumaAtlasReadyMaterialRequirement
	| LumaAtlasFallbackMaterialRequirement;

interface LumaAtlasReadyMaterialRequirement {
	kind: "atlas";
	slot: ResolvedMaterialSlot;
	renderableKind: LumaAtlasPlannerRenderableKind;
	materialAssetId: string;
	materialSlotKey: string;
	materialTableSlotIndex: number;
	atlasEntryKey: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	samplingKey: string;
	behavior: LegacyMaterialBehaviorDto;
}

interface LumaAtlasFallbackMaterialRequirement {
	kind: "fallback";
	slot: ResolvedMaterialSlot;
	renderableKind: LumaAtlasPlannerRenderableKind;
	materialAssetId: string;
	reason: LumaAtlasFallbackReason;
	detail: string;
	behavior: LegacyMaterialBehaviorDto | null;
}

interface LumaAtlasEntryPlan {
	key: string;
	renderSurfaceId: number;
	preparedTextureAssetId: string;
	width: number;
	height: number;
	sourceHash: string;
	sourceFormatRaw: number;
	transfer: "linear";
}

interface LumaAtlasTexturePlacement {
	atlasEntryKey: string;
	x: number;
	y: number;
	width: number;
	height: number;
	gutterPixels: number;
}

interface LumaAtlasTexturePlan {
	textureIndex: number;
	width: number;
	height: number;
	placements: LumaAtlasTexturePlacement[];
}

interface LumaAtlasDrawSlicePlan {
	key: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: string[];
}

interface LumaAtlasSetGenerationPlan {
	key: string;
	generation: number;
	policy: LumaAtlasPlannerPolicy;
	atlasEntries: LumaAtlasEntryPlan[];
	atlasTextures: LumaAtlasTexturePlan[];
	drawSlices: LumaAtlasDrawSlicePlan[];
}

export interface LumaMaterialAtlasPlan {
	atlasSet: LumaAtlasSetGenerationPlan;
	materialRequirements: LumaAtlasMaterialRequirement[];
	fallbackReasonCounts: Partial<Record<LumaAtlasFallbackReason, number>>;
}

interface AtlasCandidate {
	input: LumaAtlasMaterialRequirementInput;
	materialAssetId: string;
	materialSlotKey: string;
	atlasEntryKey: string;
	renderStateKey: string;
	samplingKey: string;
	behavior: LegacyMaterialBehaviorDto;
	entry: LumaAtlasEntryPlan;
}

interface AtlasPlacementState {
	textures: LumaAtlasTexturePlan[];
	placementByEntryKey: Map<string, { textureIndex: number }>;
	failedEntryKeys: Set<string>;
}

export function planLumaMaterialAtlasSet(options: {
	assetState: AssetChannelState;
	requirements: readonly LumaAtlasMaterialRequirementInput[];
	policy?: Partial<LumaAtlasPlannerPolicy>;
	generation?: number;
}): LumaMaterialAtlasPlan {
	const policy = normalizePolicy(options.policy);
	const candidates: AtlasCandidate[] = [];
	const materialRequirements: LumaAtlasMaterialRequirement[] = [];
	for (const input of options.requirements) {
		const candidate = evaluateAtlasCandidate({
			assetState: options.assetState,
			input,
			policy,
		});
		if (candidate.kind === "candidate") {
			candidates.push(candidate.candidate);
		} else {
			materialRequirements.push(candidate.requirement);
		}
	}

	const entries = dedupeAtlasEntries(candidates);
	const placementState = packAtlasEntries(entries, policy);
	const placedCandidates = candidates.filter(
		(candidate) => !placementState.failedEntryKeys.has(candidate.atlasEntryKey),
	);
	const materialTableSlotByKey = assignMaterialTableSlots(
		placedCandidates,
		policy,
	);
	for (const candidate of candidates) {
		const placement = placementState.placementByEntryKey.get(
			candidate.atlasEntryKey,
		);
		if (!placement) {
			materialRequirements.push(
				createFallbackRequirement({
					input: candidate.input,
					materialAssetId: candidate.materialAssetId,
					behavior: candidate.behavior,
					reason: "atlas-full",
					detail: `atlas entry ${candidate.atlasEntryKey} did not fit in ${policy.maxAtlasTextureCount} atlas textures`,
				}),
			);
			continue;
		}
		const materialTableSlotIndex = materialTableSlotByKey.get(
			candidate.materialSlotKey,
		);
		if (materialTableSlotIndex === undefined) {
			materialRequirements.push(
				createFallbackRequirement({
					input: candidate.input,
					materialAssetId: candidate.materialAssetId,
					behavior: candidate.behavior,
					reason: "material-table-overflow",
					detail: `material table exceeded ${policy.maxMaterialSlotsPerDraw} slots`,
				}),
			);
			continue;
		}
		materialRequirements.push({
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

	const sortedRequirements = sortMaterialRequirements(materialRequirements);
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
			atlasTextures: placementState.textures,
			drawSlices,
		},
		materialRequirements: sortedRequirements,
		fallbackReasonCounts: countFallbackReasons(sortedRequirements),
	};
}

function evaluateAtlasCandidate(options: {
	assetState: AssetChannelState;
	input: LumaAtlasMaterialRequirementInput;
	policy: LumaAtlasPlannerPolicy;
}):
	| { kind: "candidate"; candidate: AtlasCandidate }
	| { kind: "fallback"; requirement: LumaAtlasFallbackMaterialRequirement } {
	const materialAssetId =
		options.input.slot.materialAssetId ||
		formatMaterialAssetId(options.input.slot.surfaceId);
	const recipeAsset = options.assetState.preparedByAssetId[materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior: null,
				reason: "missing-material-recipe",
				detail: `missing material recipe ${materialAssetId}`,
			}),
		};
	}
	const recipe = recipeAsset.payload;
	const behavior = deriveLegacyMaterialBehaviorDto({ recipe });
	const fallbackReason = atlasFallbackReasonForRecipe({
		input: options.input,
		recipe,
		behavior,
	});
	if (fallbackReason) {
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior,
				reason: fallbackReason.reason,
				detail: fallbackReason.detail,
			}),
		};
	}

	const resolvedSurface = resolveFirstMaterialRenderSurface({
		recipe,
		assetState: options.assetState,
	});
	if (!resolvedSurface) {
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior,
				reason: "missing-render-surface",
				detail: `material ${materialAssetId} has no prepared render surface`,
			}),
		};
	}

	const surface = resolvedSurface.renderSurface;
	if (!isSupportedCompressedFormat(surface.formatRaw)) {
		const reason = isSupportedDirectColorFormat(surface.formatRaw)
			? "direct-color-normalization-deferred"
			: "unsupported-render-surface-format";
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior: deriveLegacyMaterialBehaviorDto({
					recipe,
					hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
				}),
				reason,
				detail: `render surface ${formatHex32(surface.renderSurfaceId)} format ${surface.format} is not atlas-ready`,
			}),
		};
	}

	const preparedTextureAssetId = formatAtlasReadyPreparedTextureAssetId({
		renderSurfaceId: surface.renderSurfaceId,
		usage: "raw",
	});
	const preparedTextureAsset =
		options.assetState.preparedByAssetId[preparedTextureAssetId];
	if (preparedTextureAsset?.payload.kind !== "prepared-texture") {
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior: deriveLegacyMaterialBehaviorDto({
					recipe,
					hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
				}),
				reason: "missing-decompressed-prepared-texture",
				detail: `missing atlas-ready prepared texture ${preparedTextureAssetId}`,
			}),
		};
	}

	const preparedTexture = preparedTextureAsset.payload;
	const validTexture = validateAtlasPreparedTexture(surface, preparedTexture);
	if (validTexture !== null) {
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior: deriveLegacyMaterialBehaviorDto({
					recipe,
					hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
				}),
				reason: "invalid-decompressed-prepared-texture",
				detail: validTexture,
			}),
		};
	}

	const level = preparedTexture.levels[0];
	if (!level) {
		throw new Error(
			`Prepared texture ${preparedTextureAssetId} passed validation without a level-0 payload.`,
		);
	}
	if (
		level.width + options.policy.baseGutterPixels * 2 >
			options.policy.maxAtlasTextureSize ||
		level.height + options.policy.baseGutterPixels * 2 >
			options.policy.maxAtlasTextureSize
	) {
		return {
			kind: "fallback",
			requirement: createFallbackRequirement({
				input: options.input,
				materialAssetId,
				behavior: deriveLegacyMaterialBehaviorDto({
					recipe,
					hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
				}),
				reason: "source-texture-too-large",
				detail: `texture ${preparedTextureAssetId} is ${level.width}x${level.height}, exceeding atlas capacity`,
			}),
		};
	}

	const behaviorWithAlpha = deriveLegacyMaterialBehaviorDto({
		recipe,
		hasSourceAlpha: hasSourceAlpha(surface.formatRaw),
	});
	const samplingKey = describeAtlasSamplingKey();
	const renderStateKey = describeAtlasRenderStateKey(behaviorWithAlpha);
	const atlasEntryKey = describeAtlasEntryKey({
		renderSurface: surface,
		preparedTexture,
	});
	return {
		kind: "candidate",
		candidate: {
			input: options.input,
			materialAssetId,
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
			behavior: behaviorWithAlpha,
			entry: {
				key: atlasEntryKey,
				renderSurfaceId: surface.renderSurfaceId,
				preparedTextureAssetId,
				width: level.width,
				height: level.height,
				sourceHash: preparedTexture.sourceHash,
				sourceFormatRaw: preparedTexture.sourceFormatRaw,
				transfer: "linear",
			},
		},
	};
}

function atlasFallbackReasonForRecipe(options: {
	input: LumaAtlasMaterialRequirementInput;
	recipe: PreparedMaterialRecipePayload;
	behavior: LegacyMaterialBehaviorDto;
}): { reason: LumaAtlasFallbackReason; detail: string } | null {
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

function dedupeAtlasEntries(
	candidates: readonly AtlasCandidate[],
): LumaAtlasEntryPlan[] {
	const entriesByKey = new Map<string, LumaAtlasEntryPlan>();
	for (const candidate of candidates) {
		entriesByKey.set(candidate.entry.key, candidate.entry);
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function packAtlasEntries(
	entries: readonly LumaAtlasEntryPlan[],
	policy: LumaAtlasPlannerPolicy,
): AtlasPlacementState {
	if (entries.length === 0) {
		return {
			textures: [],
			placementByEntryKey: new Map(),
			failedEntryKeys: new Set(),
		};
	}
	const textures: LumaAtlasTexturePlan[] = [];
	const placementByEntryKey = new Map<string, { textureIndex: number }>();
	const failedEntryKeys = new Set<string>();
	let cursorX = policy.baseGutterPixels;
	let cursorY = policy.baseGutterPixels;
	let rowHeight = 0;
	let currentTexture = createAtlasTexturePlan(0, policy);
	textures.push(currentTexture);

	for (const entry of entries) {
		const paddedWidth = entry.width + policy.baseGutterPixels * 2;
		const paddedHeight = entry.height + policy.baseGutterPixels * 2;
		if (cursorX + paddedWidth > policy.maxAtlasTextureSize) {
			cursorX = policy.baseGutterPixels;
			cursorY += rowHeight + policy.baseGutterPixels;
			rowHeight = 0;
		}
		if (cursorY + paddedHeight > policy.maxAtlasTextureSize) {
			if (textures.length >= policy.maxAtlasTextureCount) {
				failedEntryKeys.add(entry.key);
				continue;
			}
			currentTexture = createAtlasTexturePlan(textures.length, policy);
			textures.push(currentTexture);
			cursorX = policy.baseGutterPixels;
			cursorY = policy.baseGutterPixels;
			rowHeight = 0;
		}
		currentTexture.placements.push({
			atlasEntryKey: entry.key,
			x: cursorX + policy.baseGutterPixels,
			y: cursorY + policy.baseGutterPixels,
			width: entry.width,
			height: entry.height,
			gutterPixels: policy.baseGutterPixels,
		});
		placementByEntryKey.set(entry.key, {
			textureIndex: currentTexture.textureIndex,
		});
		cursorX += paddedWidth;
		rowHeight = Math.max(rowHeight, paddedHeight);
	}

	return { textures, placementByEntryKey, failedEntryKeys };
}

function createAtlasTexturePlan(
	textureIndex: number,
	policy: LumaAtlasPlannerPolicy,
): LumaAtlasTexturePlan {
	return {
		textureIndex,
		width: policy.maxAtlasTextureSize,
		height: policy.maxAtlasTextureSize,
		placements: [],
	};
}

function assignMaterialTableSlots(
	candidates: readonly AtlasCandidate[],
	policy: LumaAtlasPlannerPolicy,
): Map<string, number> {
	const keys = [...new Set(candidates.map((candidate) => candidate.materialSlotKey))]
		.sort();
	const slotByKey = new Map<string, number>();
	for (const [index, key] of keys.slice(0, policy.maxMaterialSlotsPerDraw).entries()) {
		slotByKey.set(key, index);
	}
	return slotByKey;
}

function createFallbackRequirement(options: {
	input: LumaAtlasMaterialRequirementInput;
	materialAssetId: string;
	reason: LumaAtlasFallbackReason;
	detail: string;
	behavior: LegacyMaterialBehaviorDto | null;
}): LumaAtlasFallbackMaterialRequirement {
	return {
		kind: "fallback",
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

function describeAtlasSamplingKey(): string {
	return "wrap=vertex;filter=linear/linear/linear;color=linear;mips=atlas";
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
	entries: readonly LumaAtlasEntryPlan[];
	policy: LumaAtlasPlannerPolicy;
	materialSlots: readonly string[];
}): string {
	return [
		"luma-atlas-set",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		...options.entries.map((entry) => entry.key),
		...options.materialSlots,
	].join("|");
}

function sortMaterialRequirements(
	requirements: readonly LumaAtlasMaterialRequirement[],
): LumaAtlasMaterialRequirement[] {
	return [...requirements].sort(
		(left, right) =>
			left.slot.slotIndex - right.slot.slotIndex ||
			left.materialAssetId.localeCompare(right.materialAssetId) ||
			left.renderableKind.localeCompare(right.renderableKind) ||
			(left.kind === "atlas" ? left.materialSlotKey : left.reason).localeCompare(
				right.kind === "atlas" ? right.materialSlotKey : right.reason,
			),
	);
}

function countFallbackReasons(
	requirements: readonly LumaAtlasMaterialRequirement[],
): Partial<Record<LumaAtlasFallbackReason, number>> {
	const counts: Partial<Record<LumaAtlasFallbackReason, number>> = {};
	for (const requirement of requirements) {
		if (requirement.kind !== "fallback") {
			continue;
		}
		counts[requirement.reason] = (counts[requirement.reason] ?? 0) + 1;
	}
	return counts;
}

function createDrawSlicePlans(
	requirements: readonly LumaAtlasMaterialRequirement[],
): LumaAtlasDrawSlicePlan[] {
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
		const group =
			groupByKey.get(key) ??
			{
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
	policy: Partial<LumaAtlasPlannerPolicy> | undefined,
): LumaAtlasPlannerPolicy {
	const normalized = { ...DEFAULT_LUMA_ATLAS_PLANNER_POLICY, ...policy };
	if (normalized.maxAtlasTextureSize <= normalized.baseGutterPixels * 2) {
		throw new Error("Luma atlas max texture size must exceed its gutters.");
	}
	if (normalized.maxAtlasTextureCount <= 0) {
		throw new Error("Luma atlas texture count must be positive.");
	}
	if (normalized.maxMaterialSlotsPerDraw <= 0) {
		throw new Error("Luma atlas material table size must be positive.");
	}
	return normalized;
}
