import type { LegacyMaterialBehaviorDto } from "../material-behavior";
import type { RenderVec4 } from "../render-math";
import type { RenderMaterialTexturePageReadiness } from "../render-material-strategy";
import type {
	TexturePageDescriptor,
	TexturePageUsageBucket,
} from "../texture-pages/texture-page-binding";
import {
	createEmptyTexturePageAtlasPlan,
	createTexturePageAtlasPlacementsByEntryKey,
	createTexturePageDetailAtlasPlacementsByEntryKey,
	planTexturePageAtlas,
	type TexturePageAtlasDetailCandidate,
	type TexturePageAtlasRgbaCandidate,
	type TexturePageAtlasPlan,
} from "../texture-pages/texture-page-atlas-planner";
import type { Webgl2SceneDomain } from "../webgl2-scene-domain-targets";

type CompactionFamilyBypassReason =
	| "non-static"
	| "missing-landblock-origin"
	| "unsupported-compacted-material-family"
	| "missing-uv-buffer"
	| "missing-texture-page-readiness"
	| "unsupported-transparent-blended-material"
	| "unsupported-opacity-translucent-material"
	| "unsupported-constant-color-material"
	| "unsupported-indexed-paletted-material"
	| "unsupported-indexed-texture-page-policy"
	| "indexed-alpha-policy-unsupported"
	| "debug-pipeline-material"
	| "unsupported-material-state"
	| "detail-overlay"
	| "missing-detail-atlas-entry"
	| "material-table-overflow";

type CompactionMaterialKind =
	| "flat"
	| "direct-texture"
	| "indexed-paletted";

export type CompactionMaterialFamily =
	| "flat-constant-color"
	| "textured-opaque"
	| "transparent-blended"
	| "opacity-translucent"
	| "indexed-paletted"
	| "debug-pipeline"
	| "unknown-unsupported";

export type CompactionAlphaPolicy =
	| "opaque"
	| "cutout"
	| "transparent-blend"
	| "opacity-translucent"
	| "unknown";

type CompactionMaterialBlocker =
	| "missing-base-texture-page"
	| "missing-indexed-texel-page"
	| "missing-indexed-palette-page"
	| "missing-texture-page-readiness"
	| "missing-compacted-constant-color-family"
	| "missing-compacted-indexed-paletted-family"
	| "indexed-alpha-policy-unsupported"
	| "missing-compacted-transparent-blended-family"
	| "missing-compacted-opacity-translucent-family"
	| "debug-pipeline-material"
	| "detail-overlay"
	| "missing-detail-atlas-entry"
	| "unsupported-material-state"
	| `unsupported-texture-page-usage:${TexturePageUsageBucket}`
	| "unsupported-texture-page-sample-class"
	| "unsupported-texture-page-sampling";

type CompactionGeometryBlocker =
	| "non-static"
	| "missing-landblock-origin"
	| "missing-uv-buffer";

export interface CompactionEligibility {
	decision: "compacted" | "direct-draw";
	material: {
		family: CompactionMaterialFamily;
		compatible: boolean;
		blockers: readonly CompactionMaterialBlocker[];
		alphaPolicy: CompactionAlphaPolicy;
		alphaTest: number;
		texturePageReadiness: RenderMaterialTexturePageReadiness | null;
		detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
	};
	geometry: {
		compatible: boolean;
		blockers: readonly CompactionGeometryBlocker[];
	};
}

export interface CompactionGeometryReadiness {
	kind: string;
	owningLandblockId: number | null;
	hasUvBuffer: boolean;
}

interface CompactionTexturePageReadiness {
	base: RenderMaterialTexturePageReadiness | null;
	bindings: readonly TexturePageDescriptor[];
}

interface CompactionDetailOverlayReadiness {
	hasOverlay: boolean;
	atlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface CompactionMaterialReadiness {
	kind: CompactionMaterialKind;
	behavior: LegacyMaterialBehaviorDto | null;
	texturePages: CompactionTexturePageReadiness;
	detailOverlay: CompactionDetailOverlayReadiness;
}

export interface CompactionFamilyPlanningPolicy {
	maxAtlasTextureSize: number;
	maxAtlasTextureCount: number;
	baseGutterPixels: number;
	maxMaterialSlotsPerDraw: number;
}

export interface CompactionFamilyCandidate {
	id: string;
	kind: string;
	owningLandblockId: number | null;
	sceneDomain: Webgl2SceneDomain | null;
	visibilityPartitionKey: string;
	materialKind: CompactionMaterialKind;
	materialKey: string;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
	indexedMaterialTableRecord: IndexedPalettedFamilyMaterialTableRecord | null;
	compactionEligibility: CompactionEligibility;
	triangleCount: number;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

interface CompactionFamilyBypass {
	candidateId: string;
	reason: CompactionFamilyBypassReason;
	blockerKind: "geometry" | "material" | "atlas";
	blocker: string;
	detail: string;
}

interface RgbaTexturePageFamilyMaterialSlot {
	key: string;
	sourceMaterialSlotKey: string;
	index: number;
	renderStateKey: string;
	samplingKey: string;
	samplingPolicy: RenderMaterialTexturePageReadiness["samplingPolicy"];
	atlasEntryKey: string;
	alphaPolicy: "opaque" | "cutout";
	alphaTest: number;
	detailAtlasEntryKey: string | null;
	detailTiling: number;
}

export interface IndexedPalettedFamilyMaterialTableRecord {
	key: string;
	sourceMaterialKey: string;
	indexPageKey: string;
	palettePageKey: string;
	indexFormat: "p8" | "index16";
	indexPageWidth: number;
	indexPageHeight: number;
	paletteColorCount: number;
	clipThreshold: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
	color: RenderVec4;
	detailAtlasEntryKey: string | null;
	detailTiling: number;
	alphaPolicy: "opaque";
	filteringMode: "shader-palette-linear";
}

interface IndexedPalettedFamilyDrawSlice {
	key: string;
	indexFormat: "p8" | "index16";
	indexPageKey: string;
	palettePageKey: string;
	indexAtlasTextureIndex: number | null;
	paletteAtlasTextureIndex: number | null;
	renderStateKey: "indexed-opaque";
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	candidateIds: readonly string[];
}

interface RgbaTexturePageFamilyDrawSlice {
	key: string;
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	candidateIds: readonly string[];
}

export interface RgbaTexturePageAtlasEntryRecord {
	key: string;
	entry: RenderMaterialTexturePageReadiness["atlasEntry"];
}

export interface RgbaTexturePageDetailAtlasEntry {
	key: string;
	renderSurfaceId: number;
	sourceFormatRaw: number;
	width: number;
	height: number;
	bytes: Uint8Array;
	format: "rgba8";
	tiling: number;
	blendMode: "dst-color" | "src-alpha";
}

export interface CompactionFamilyPlan {
	key: string;
	// Temporary migration debt: renderFamilies is the old RGBA-atlas-shaped
	// planning boundary. New compacted material work should replace this with
	// render family pipeline plans instead of adding more parallel submit-family
	// fields.
	renderFamilies: CompactionRenderFamilies;
	compactableCandidateIds: readonly string[];
	bypasses: readonly CompactionFamilyBypass[];
	texturePageAtlasPlan: TexturePageAtlasPlan;
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	indexedMaterialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
	staticObjectKeys: readonly string[];
	staticPartCount: number;
	triangleCount: number;
}

interface CompactionRenderFamilies {
	rgbaTexturePage: RgbaTexturePageRenderFamilyPlan;
	indexedPaletted: IndexedPalettedRenderFamilyPlan;
}

interface RgbaTexturePageRenderFamilyPlan {
	kind: "rgba-atlas";
	compactableCandidateIds: readonly string[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
	partitions: readonly RgbaTexturePageRenderFamilyPartition[];
}

interface IndexedPalettedRenderFamilyPlan {
	kind: "indexed-paletted";
	compactableCandidateIds: readonly string[];
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly IndexedPalettedFamilyDrawSlice[];
	partitions: readonly IndexedPalettedRenderFamilyPartition[];
}

interface RgbaTexturePageRenderFamilyPartition {
	key: string;
	compactableCandidateIds: readonly string[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
}

interface IndexedPalettedRenderFamilyPartition {
	key: string;
	compactableCandidateIds: readonly string[];
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly IndexedPalettedFamilyDrawSlice[];
}

interface EligibleCompactionFamilyCandidate {
	source: CompactionFamilyCandidate;
	eligibility: RenderMaterialTexturePageReadiness;
}

interface BoundedMaterialTablePartition<TCandidate, TMaterialRecord> {
	partitionIndex: number;
	materialRecords: readonly TMaterialRecord[];
	candidates: readonly TCandidate[];
}

export function createEmptyCompactionFamilyPlan(): CompactionFamilyPlan {
	return {
		key: "compaction-families/empty",
		renderFamilies: createCompactionRenderFamilies({
			compactableCandidateIds: [],
			materialSlots: [],
			indexedMaterialTableRecords: [],
			candidateMaterialSlots: [],
			drawSlices: [],
		}),
		compactableCandidateIds: [],
		bypasses: [],
		texturePageAtlasPlan: createEmptyTexturePageAtlasPlan(),
		materialSlots: [],
		indexedMaterialTableRecords: [],
		candidateMaterialSlots: [],
		drawSlices: [],
		staticObjectKeys: [],
		staticPartCount: 0,
		triangleCount: 0,
	};
}

export function planCompactionFamilies(options: {
	candidates: readonly CompactionFamilyCandidate[];
	policy: CompactionFamilyPlanningPolicy;
	extraRgbaAtlasCandidates?: readonly TexturePageAtlasRgbaCandidate[];
	extraDetailAtlasCandidates?: readonly TexturePageAtlasDetailCandidate[];
}): CompactionFamilyPlan {
	const rgbaAtlasCandidates = collectRgbaTexturePageAtlasCandidates(
		options.candidates,
	);
	const rgbaEligible: EligibleCompactionFamilyCandidate[] = [];
	const bypasses: CompactionFamilyBypass[] = [];
	for (const candidate of options.candidates) {
		const bypass = classifyCompactionFamilyBypass(candidate);
		if (bypass) {
			bypasses.push(bypass);
			continue;
		}
		if (candidate.compactionEligibility.material.family === "indexed-paletted") {
			continue;
		}
		const texturePageReadiness =
			candidate.compactionEligibility.material.texturePageReadiness;
		if (!texturePageReadiness) {
			throw new Error(
				`Compacted geometry candidate ${candidate.id} was accepted without packed texture-page eligibility.`,
			);
		}
		rgbaEligible.push({ source: candidate, eligibility: texturePageReadiness });
	}

	const uniqueRgbaAtlasCandidates =
		dedupeRgbaTexturePageCandidates(rgbaAtlasCandidates);
	const uniqueRgbaEligible = dedupeRgbaTexturePageCandidates(rgbaEligible);
	const indexedCandidates = collectIndexedPalettedCompactionCandidates(
		options.candidates,
	);
	const uniqueIndexedCandidates =
		dedupeIndexedPalettedCandidates(indexedCandidates);
	const texturePageAtlasPlan = planTexturePageAtlas({
		rgbaCandidates: [
			...uniqueRgbaAtlasCandidates.map((candidate) => ({
				candidateId: candidate.source.id,
				texturePageReadiness: candidate.eligibility,
				detailAtlasEntry: candidate.source.detailAtlasEntry,
			})),
			...(options.extraRgbaAtlasCandidates ?? []),
		],
		detailCandidates: [
			...uniqueIndexedCandidates.map((candidate) => ({
				candidateId: candidate.id,
				detailAtlasEntry: candidate.detailAtlasEntry,
			})),
			...(options.extraDetailAtlasCandidates ?? []),
		],
		policy: options.policy,
	});
	const rgbaAtlasReadyCandidateIds = new Set(
		texturePageAtlasPlan.rgbaAtlasReadyCandidateIds,
	);
	const detailAtlasReadyCandidateIds = new Set(
		texturePageAtlasPlan.detailAtlasReadyCandidateIds,
	);
	const detailPlaced = uniqueRgbaEligible.filter((candidate) =>
		rgbaAtlasReadyCandidateIds.has(candidate.source.id),
	);
	const detailReadyIndexedCandidates = uniqueIndexedCandidates.filter(
		(candidate) => detailAtlasReadyCandidateIds.has(candidate.id),
	);

	const indexedCompactable = detailReadyIndexedCandidates;
	const indexedMaterialTableRecords =
		assignIndexedPalettedFamilyMaterialTableRecords(indexedCompactable);
	const indexedPartitions = createIndexedPalettedFamilyPartitions({
		candidates: indexedCompactable,
		policy: options.policy,
	});
	const indexedCandidateMaterialSlots = indexedCompactable.map((candidate) => ({
		candidateId: candidate.id,
		materialSlotKey:
			requireIndexedPalettedFamilyMaterialTableRecord(candidate).key,
	}));
	const indexedDrawSlices = indexedPartitions.flatMap(
		(partition) => partition.drawSlices,
	);
	const compactable = detailPlaced;
	const placementsByEntryKey =
		createTexturePageAtlasPlacementsByEntryKey(texturePageAtlasPlan);
	const detailPlacementsByEntryKey =
		createTexturePageDetailAtlasPlacementsByEntryKey(texturePageAtlasPlan);
	const materialSlots = assignRgbaTexturePageFamilyMaterialSlots(compactable);
	const rgbaPartitions = createRgbaTexturePageFamilyPartitions({
		candidates: compactable,
		policy: options.policy,
		placementsByEntryKey,
		detailPlacementsByEntryKey,
	});
	const materialSlotByKey = new Map(
		materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const drawSlices = createRgbaTexturePageFamilyDrawSlices(
		compactable,
		materialSlotByKey,
		placementsByEntryKey,
		detailPlacementsByEntryKey,
	);
	const compactableCandidateIds = compactable.map(
		(candidate) => candidate.source.id,
	);
	const indexedCompactableCandidateIds = indexedCompactable.map(
		(candidate) => candidate.id,
	);
	const allCompactableCandidateIds = [
		...compactableCandidateIds,
		...indexedCompactableCandidateIds,
	];
	const candidateMaterialSlots = compactable.map((candidate) => ({
		candidateId: candidate.source.id,
		materialSlotKey: describeCompactionMaterialSlotKey(candidate),
	}));
	return {
		key: describeCompactionFamilyPlanKey({
			policy: options.policy,
			atlasPlanKey: texturePageAtlasPlan.key,
			materialSlotKeys: materialSlots.map((slot) => slot.key),
			indexedMaterialTableRecordKeys: indexedMaterialTableRecords.map(
				(record) => record.key,
			),
		}),
		compactableCandidateIds: allCompactableCandidateIds,
		renderFamilies: createCompactionRenderFamilies({
			compactableCandidateIds,
			materialSlots,
			indexedMaterialTableRecords,
			rgbaPartitions,
			indexedPartitions,
			indexedCompactableCandidateIds,
			indexedCandidateMaterialSlots,
			indexedDrawSlices,
			candidateMaterialSlots,
			drawSlices,
		}),
		bypasses,
		texturePageAtlasPlan,
		materialSlots,
		indexedMaterialTableRecords,
		candidateMaterialSlots,
		drawSlices,
		staticObjectKeys: uniqueSortedStrings([
			...compactable.flatMap(
				(candidate) => candidate.source.staticObjectKeys,
			),
			...indexedCompactable.flatMap((candidate) => candidate.staticObjectKeys),
		]),
		staticPartCount:
			compactable.reduce(
				(total, candidate) => total + candidate.source.staticPartCount,
				0,
			) +
			indexedCompactable.reduce(
				(total, candidate) => total + candidate.staticPartCount,
				0,
			),
		triangleCount:
			compactable.reduce(
				(total, candidate) => total + candidate.source.triangleCount,
				0,
			) +
			indexedCompactable.reduce(
				(total, candidate) => total + candidate.triangleCount,
				0,
			),
	};
}

function createCompactionRenderFamilies({
	compactableCandidateIds,
	materialSlots,
	indexedMaterialTableRecords,
	rgbaPartitions,
	indexedPartitions,
	indexedCompactableCandidateIds,
	indexedCandidateMaterialSlots,
	indexedDrawSlices,
	candidateMaterialSlots,
	drawSlices,
}: {
	compactableCandidateIds: readonly string[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	indexedMaterialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	rgbaPartitions?: readonly RgbaTexturePageRenderFamilyPartition[];
	indexedPartitions?: readonly IndexedPalettedRenderFamilyPartition[];
	indexedCompactableCandidateIds?: readonly string[];
	indexedCandidateMaterialSlots?: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	indexedDrawSlices?: readonly IndexedPalettedFamilyDrawSlice[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
}): CompactionRenderFamilies {
	return {
		rgbaTexturePage: {
			kind: "rgba-atlas",
			compactableCandidateIds,
			materialSlots,
			candidateMaterialSlots,
			drawSlices,
			partitions:
				rgbaPartitions ??
				createSingleRgbaTexturePageFamilyPartition({
					materialSlots,
					candidateMaterialSlots,
					drawSlices,
					compactableCandidateIds,
				}),
		},
		indexedPaletted: {
			kind: "indexed-paletted",
			compactableCandidateIds: indexedCompactableCandidateIds ?? [],
			materialTableRecords: indexedMaterialTableRecords,
			candidateMaterialSlots: indexedCandidateMaterialSlots ?? [],
			drawSlices: indexedDrawSlices ?? [],
			partitions:
				indexedPartitions ??
				createSingleIndexedPalettedFamilyPartition({
					materialTableRecords: indexedMaterialTableRecords,
					candidateMaterialSlots: indexedCandidateMaterialSlots ?? [],
					drawSlices: indexedDrawSlices ?? [],
					compactableCandidateIds: indexedCompactableCandidateIds ?? [],
				}),
		},
	};
}

function createSingleRgbaTexturePageFamilyPartition({
	compactableCandidateIds,
	materialSlots,
	candidateMaterialSlots,
	drawSlices,
}: {
	compactableCandidateIds: readonly string[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
}): readonly RgbaTexturePageRenderFamilyPartition[] {
	if (compactableCandidateIds.length === 0) {
		return [];
	}
	return [
		{
			key: "rgba-texture-page-partition/0",
			compactableCandidateIds,
			materialSlots,
			candidateMaterialSlots,
			drawSlices,
		},
	];
}

function createSingleIndexedPalettedFamilyPartition({
	compactableCandidateIds,
	materialTableRecords,
	candidateMaterialSlots,
	drawSlices,
}: {
	compactableCandidateIds: readonly string[];
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	candidateMaterialSlots: readonly {
		candidateId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly IndexedPalettedFamilyDrawSlice[];
}): readonly IndexedPalettedRenderFamilyPartition[] {
	if (compactableCandidateIds.length === 0) {
		return [];
	}
	return [
		{
			key: "indexed-paletted-partition/0",
			compactableCandidateIds,
			materialTableRecords,
			candidateMaterialSlots,
			drawSlices,
		},
	];
}

function createBoundedMaterialTablePartitions<TCandidate, TMaterialRecord>({
	candidates,
	maxMaterialSlots,
	describeMaterialKey,
	createMaterialRecord,
}: {
	candidates: readonly TCandidate[];
	maxMaterialSlots: number;
	describeMaterialKey: (candidate: TCandidate) => string;
	createMaterialRecord: (candidate: TCandidate) => TMaterialRecord;
}): BoundedMaterialTablePartition<TCandidate, TMaterialRecord>[] {
	if (!Number.isInteger(maxMaterialSlots) || maxMaterialSlots <= 0) {
		throw new Error(
			`Compacted material table capacity must be positive, got ${maxMaterialSlots}.`,
		);
	}
	const recordsByKey = new Map<string, TMaterialRecord>();
	for (const candidate of candidates) {
		const key = describeMaterialKey(candidate);
		if (!recordsByKey.has(key)) {
			recordsByKey.set(key, createMaterialRecord(candidate));
		}
	}
	const sortedKeys = [...recordsByKey.keys()].sort();
	const partitions: BoundedMaterialTablePartition<
		TCandidate,
		TMaterialRecord
	>[] = [];
	for (
		let partitionStart = 0;
		partitionStart < sortedKeys.length;
		partitionStart += maxMaterialSlots
	) {
		const materialKeys = sortedKeys.slice(
			partitionStart,
			partitionStart + maxMaterialSlots,
		);
		const materialKeySet = new Set(materialKeys);
		partitions.push({
			partitionIndex: partitions.length,
			materialRecords: materialKeys.map((key) => {
				const record = recordsByKey.get(key);
				if (record === undefined) {
					throw new Error(`Compacted material partition lost record ${key}.`);
				}
				return record;
			}),
			candidates: candidates.filter((candidate) =>
				materialKeySet.has(describeMaterialKey(candidate)),
			),
		});
	}
	return partitions;
}

function collectRgbaTexturePageAtlasCandidates(
	candidates: readonly CompactionFamilyCandidate[],
): EligibleCompactionFamilyCandidate[] {
	const eligibleCandidates: EligibleCompactionFamilyCandidate[] = [];
	for (const candidate of candidates) {
		if (candidate.materialKind !== "direct-texture") {
			continue;
		}
		const texturePageReadiness =
			candidate.compactionEligibility.material.texturePageReadiness;
		if (!texturePageReadiness) {
			continue;
		}
		eligibleCandidates.push({
			source: candidate,
			eligibility: texturePageReadiness,
		});
	}
	return eligibleCandidates;
}

function collectIndexedPalettedCompactionCandidates(
	candidates: readonly CompactionFamilyCandidate[],
): CompactionFamilyCandidate[] {
	return candidates.filter(isIndexedPalettedMaterialTableReady);
}

function dedupeIndexedPalettedCandidates(
	candidates: readonly CompactionFamilyCandidate[],
): CompactionFamilyCandidate[] {
	const candidateById = new Map<string, CompactionFamilyCandidate>();
	for (const candidate of candidates) {
		const previous = candidateById.get(candidate.id);
		if (!previous) {
			candidateById.set(candidate.id, candidate);
			continue;
		}
		const previousSignature = describeIndexedCandidateSliceIdentity(previous);
		const candidateSignature = describeIndexedCandidateSliceIdentity(candidate);
		if (previousSignature !== candidateSignature) {
			throw new Error(
				`Indexed compaction candidate ${candidate.id} maps to multiple material slice identities: ${previousSignature} and ${candidateSignature}.`,
			);
		}
	}
	return [...candidateById.values()];
}

function describeIndexedCandidateSliceIdentity(
	candidate: CompactionFamilyCandidate,
): string {
	const record = requireIndexedPalettedFamilyMaterialTableRecord(candidate);
	return [
		record.indexFormat,
		record.indexPageKey,
		record.palettePageKey,
		record.key,
		"indexed-opaque",
	].join("|");
}

function assignIndexedPalettedFamilyMaterialTableRecords(
	candidates: readonly CompactionFamilyCandidate[],
): IndexedPalettedFamilyMaterialTableRecord[] {
	const recordsByKey = new Map<
		string,
		IndexedPalettedFamilyMaterialTableRecord
	>();
	for (const candidate of candidates) {
		const record = requireIndexedPalettedFamilyMaterialTableRecord(candidate);
		recordsByKey.set(record.key, record);
	}
	return [...recordsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function createIndexedPalettedFamilyPartitions({
	candidates,
	policy,
}: {
	candidates: readonly CompactionFamilyCandidate[];
	policy: CompactionFamilyPlanningPolicy;
}): IndexedPalettedRenderFamilyPartition[] {
	return createBoundedMaterialTablePartitions({
		candidates,
		maxMaterialSlots: policy.maxMaterialSlotsPerDraw,
		describeMaterialKey: (candidate) =>
			requireIndexedPalettedFamilyMaterialTableRecord(candidate).key,
		createMaterialRecord: (candidate) =>
			requireIndexedPalettedFamilyMaterialTableRecord(candidate),
	}).map((partition) => {
		const materialTableRecords = partition.materialRecords;
		const candidateMaterialSlots = partition.candidates.map((candidate) => ({
			candidateId: candidate.id,
			materialSlotKey:
				requireIndexedPalettedFamilyMaterialTableRecord(candidate).key,
		}));
		const drawSlices = createIndexedPalettedFamilyDrawSlices({
			candidates: partition.candidates,
			materialTableRecords,
		});
		return {
			key: `indexed-paletted-partition/${partition.partitionIndex}`,
			compactableCandidateIds: partition.candidates.map(
				(candidate) => candidate.id,
			),
			materialTableRecords,
			candidateMaterialSlots,
			drawSlices,
		};
	});
}

function requireIndexedPalettedFamilyMaterialTableRecord(
	candidate: CompactionFamilyCandidate,
): IndexedPalettedFamilyMaterialTableRecord {
	const record = candidate.indexedMaterialTableRecord;
	if (!record) {
		throw new Error(
			`Indexed material candidate ${candidate.id} is table-ready without a material-table record.`,
		);
	}
	return record;
}

function createIndexedPalettedFamilyDrawSlices({
	candidates,
	materialTableRecords,
}: {
	candidates: readonly CompactionFamilyCandidate[];
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
}): IndexedPalettedFamilyDrawSlice[] {
	const materialTableIndexByKey = new Map(
		materialTableRecords.map((record, index) => [record.key, index] as const),
	);
	const groups = new Map<
		string,
		{
			record: IndexedPalettedFamilyMaterialTableRecord;
			slotIndex: number;
			candidateIds: string[];
		}
	>();
	for (const candidate of candidates) {
		const record = requireIndexedPalettedFamilyMaterialTableRecord(candidate);
		const slotIndex = materialTableIndexByKey.get(record.key);
		if (slotIndex === undefined) {
			continue;
		}
		const key = [
			record.indexFormat,
			record.indexPageKey,
			record.palettePageKey,
			record.key,
			"indexed-opaque",
		].join("|");
		const group = groups.get(key) ?? {
			record,
			slotIndex,
			candidateIds: [],
		};
		group.candidateIds.push(candidate.id);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				left.record.indexFormat.localeCompare(right.record.indexFormat) ||
				left.record.indexPageKey.localeCompare(right.record.indexPageKey) ||
				left.record.palettePageKey.localeCompare(right.record.palettePageKey) ||
				compareFirstCandidateId(left.candidateIds, right.candidateIds),
		)
		.map((group) => ({
			key: [
				"compacted-indexed-draw-slice",
				group.record.indexFormat,
				group.record.indexPageKey,
				group.record.palettePageKey,
				group.record.key,
				`table=${group.slotIndex}`,
			].join("|"),
			indexFormat: group.record.indexFormat,
			indexPageKey: group.record.indexPageKey,
			palettePageKey: group.record.palettePageKey,
			indexAtlasTextureIndex: null,
			paletteAtlasTextureIndex: null,
			renderStateKey: "indexed-opaque",
			materialTableSlotStart: group.slotIndex,
			materialTableSlotCount: 1,
			materialSlotKeys: [group.record.key],
			candidateIds: [...group.candidateIds].sort(),
		}));
}

function isIndexedPalettedMaterialTableReady(
	candidate: CompactionFamilyCandidate,
): boolean {
	if (candidate.materialKind !== "indexed-paletted") {
		return false;
	}
	if (!candidate.compactionEligibility.geometry.compatible) {
		return false;
	}
	const material = candidate.compactionEligibility.material;
	return (
		material.family === "indexed-paletted" &&
		material.alphaPolicy === "opaque" &&
		!material.blockers.includes("missing-indexed-texel-page") &&
		!material.blockers.includes("missing-indexed-palette-page") &&
		!material.blockers.some(isUnsupportedTexturePageUsageBlocker) &&
		!material.blockers.includes("unsupported-texture-page-sample-class") &&
		!material.blockers.includes("unsupported-texture-page-sampling") &&
		!material.blockers.includes("indexed-alpha-policy-unsupported")
	);
}

function classifyCompactionFamilyBypass(
	candidate: CompactionFamilyCandidate,
): CompactionFamilyBypass | null {
	const geometryBlocker =
		candidate.compactionEligibility.geometry.blockers[0] ?? null;
	if (geometryBlocker) {
		return createGeometryCompactionBypass(candidate, geometryBlocker);
	}
	const materialBlocker =
		candidate.compactionEligibility.material.blockers[0] ?? null;
	if (materialBlocker) {
		return createMaterialCompactionBypass(candidate, materialBlocker);
	}
	return null;
}

export function createCompactionEligibility(options: {
	geometry: CompactionGeometryReadiness;
	material: CompactionMaterialReadiness;
}): CompactionEligibility {
	const geometryBlockers: CompactionGeometryBlocker[] = [];
	if (
		options.geometry.kind !== "static" &&
		options.geometry.kind !== "structured-interior"
	) {
		geometryBlockers.push("non-static");
	}
	if (options.geometry.owningLandblockId === null) {
		geometryBlockers.push("missing-landblock-origin");
	}
	if (!options.geometry.hasUvBuffer) {
		geometryBlockers.push("missing-uv-buffer");
	}

	const materialFamily = classifyCompactionMaterialFamily({
		candidateKind: options.geometry.kind,
		materialKind: options.material.kind,
		materialBehavior: options.material.behavior,
	});
	const alphaPolicy = classifyCompactionAlphaPolicy(options.material.behavior);
	const materialBlockers: CompactionMaterialBlocker[] = [];
	switch (materialFamily) {
		case "flat-constant-color":
			materialBlockers.push("missing-compacted-constant-color-family");
			break;
		case "indexed-paletted":
			if (!hasIndexedTexelTexturePage(options.material.texturePages.bindings)) {
				materialBlockers.push("missing-indexed-texel-page");
			}
			if (!hasIndexedPaletteTexturePage(options.material.texturePages.bindings)) {
				materialBlockers.push("missing-indexed-palette-page");
			}
			materialBlockers.push(
				...classifyUnsupportedIndexedTexturePageBlockers(
					options.material.texturePages.bindings,
					options.material.detailOverlay,
				),
			);
			if (alphaPolicy !== "opaque") {
				materialBlockers.push("indexed-alpha-policy-unsupported");
			}
			break;
		case "debug-pipeline":
			materialBlockers.push("debug-pipeline-material");
			break;
		case "transparent-blended":
			materialBlockers.push("missing-compacted-transparent-blended-family");
			break;
		case "opacity-translucent":
			materialBlockers.push("missing-compacted-opacity-translucent-family");
			break;
		case "unknown-unsupported":
			materialBlockers.push("unsupported-material-state");
			break;
		case "textured-opaque":
			if (!options.material.texturePages.base) {
				materialBlockers.push("missing-texture-page-readiness");
			}
			if (
				!hasCompatibleCompactedBaseTexturePage(
					options.material.texturePages.bindings,
				)
			) {
				materialBlockers.push("missing-base-texture-page");
			}
			if (
				options.material.detailOverlay.hasOverlay &&
				!options.material.detailOverlay.atlasEntry
			) {
				materialBlockers.push("missing-detail-atlas-entry");
			}
			materialBlockers.push(
				...classifyUnsupportedCompactedTexturePageBlockers(
					options.material.texturePages.bindings,
				),
			);
			break;
	}

	const geometryCompatible = geometryBlockers.length === 0;
	const materialCompatible = materialBlockers.length === 0;
	return {
		decision:
			geometryCompatible && materialCompatible ? "compacted" : "direct-draw",
		material: {
			family: materialFamily,
			compatible: materialCompatible,
			blockers: materialBlockers,
			alphaPolicy,
			alphaTest: options.material.behavior?.alphaTest ?? 0,
			texturePageReadiness: options.material.texturePages.base,
			detailAtlasEntry: options.material.detailOverlay.atlasEntry,
		},
		geometry: {
			compatible: geometryCompatible,
			blockers: geometryBlockers,
		},
	};
}

function createGeometryCompactionBypass(
	candidate: CompactionFamilyCandidate,
	blocker: CompactionGeometryBlocker,
): CompactionFamilyBypass {
	switch (blocker) {
		case "non-static":
			return {
				candidateId: candidate.id,
				reason: "non-static",
				blockerKind: "geometry",
				blocker,
				detail: `compaction candidate kind ${candidate.kind} is not compacted geometry`,
			};
		case "missing-landblock-origin":
			return {
				candidateId: candidate.id,
				reason: "missing-landblock-origin",
				blockerKind: "geometry",
				blocker,
				detail: "compacted geometry compaction candidate has no owning landblock",
			};
		case "missing-uv-buffer":
			return {
				candidateId: candidate.id,
				reason: "missing-uv-buffer",
				blockerKind: "geometry",
				blocker,
				detail: "compacted geometry compaction candidate has no UV buffer",
			};
	}
}

function createMaterialCompactionBypass(
	candidate: CompactionFamilyCandidate,
	blocker: CompactionMaterialBlocker,
): CompactionFamilyBypass {
	if (isUnsupportedTexturePageUsageBlocker(blocker)) {
		return {
			candidateId: candidate.id,
			reason: "unsupported-compacted-material-family",
			blockerKind: "material",
			blocker,
			detail:
				"texture-page bindings include a usage bucket that is not supported by the compacted shader family",
		};
	}
	switch (blocker) {
		case "missing-compacted-constant-color-family":
			return {
				candidateId: candidate.id,
				reason: "unsupported-constant-color-material",
				blockerKind: "material",
				blocker,
				detail: `flat/solid material ${candidate.materialKey} has no compacted constant-color material family`,
			};
		case "missing-compacted-indexed-paletted-family":
			return {
				candidateId: candidate.id,
				reason: "unsupported-indexed-paletted-material",
				blockerKind: "material",
				blocker,
				detail: `indexed/paletted material ${candidate.materialKey} has no compacted indexed material family`,
			};
		case "missing-indexed-texel-page":
			return {
				candidateId: candidate.id,
				reason: "unsupported-indexed-texture-page-policy",
				blockerKind: "material",
				blocker,
				detail: `indexed/paletted material ${candidate.materialKey} has no indexed texel texture-page binding`,
			};
		case "missing-indexed-palette-page":
			return {
				candidateId: candidate.id,
				reason: "unsupported-indexed-texture-page-policy",
				blockerKind: "material",
				blocker,
				detail: `indexed/paletted material ${candidate.materialKey} has no palette texture-page binding`,
			};
		case "indexed-alpha-policy-unsupported":
			return {
				candidateId: candidate.id,
				reason: "indexed-alpha-policy-unsupported",
				blockerKind: "material",
				blocker,
				detail: `indexed/paletted material ${candidate.materialKey} has alpha policy that is not supported by the compacted indexed path`,
			};
		case "detail-overlay":
			return {
				candidateId: candidate.id,
				reason: "detail-overlay",
				blockerKind: "material",
				blocker,
				detail: `indexed/paletted material ${candidate.materialKey} has a detail overlay not yet supported by the compacted indexed family`,
			};
		case "missing-compacted-transparent-blended-family":
			return {
				candidateId: candidate.id,
				reason: "unsupported-transparent-blended-material",
				blockerKind: "material",
				blocker,
				detail: `blended material ${candidate.materialKey} has no compacted transparent material family`,
			};
		case "missing-compacted-opacity-translucent-family":
			return {
				candidateId: candidate.id,
				reason: "unsupported-opacity-translucent-material",
				blockerKind: "material",
				blocker,
				detail: `opacity/translucent material ${candidate.materialKey} has no compacted translucent material family`,
			};
		case "debug-pipeline-material":
			return {
				candidateId: candidate.id,
				reason: "debug-pipeline-material",
				blockerKind: "material",
				blocker,
				detail: `debug/portal material ${candidate.materialKey} is outside the production compacted path`,
			};
		case "missing-base-texture-page":
			return {
				candidateId: candidate.id,
				reason: "unsupported-compacted-material-family",
				blockerKind: "material",
				blocker,
				detail: `compaction candidate material ${candidate.materialKey} has no compacted-compatible base texture page`,
			};
		case "missing-texture-page-readiness":
			return {
				candidateId: candidate.id,
				reason: "missing-texture-page-readiness",
				blockerKind: "material",
				blocker,
				detail:
					"compacted geometry compaction candidate has no texture-page readiness record",
			};
		case "missing-detail-atlas-entry":
			return {
				candidateId: candidate.id,
				reason: "missing-detail-atlas-entry",
				blockerKind: "material",
				blocker,
				detail: "detail overlay has no compactable RGBA8 detail atlas entry",
			};
		case "unsupported-material-state":
			return {
				candidateId: candidate.id,
				reason: "unsupported-material-state",
				blockerKind: "material",
				blocker,
				detail: `material ${candidate.materialKey} is not supported by any current compacted material family`,
			};
		case "unsupported-texture-page-sample-class":
			return {
				candidateId: candidate.id,
				reason: "unsupported-compacted-material-family",
				blockerKind: "material",
				blocker,
				detail:
					"texture-page bindings include a sample class that is not supported by the compacted shader family",
			};
		case "unsupported-texture-page-sampling":
			return {
				candidateId: candidate.id,
				reason: "unsupported-compacted-material-family",
				blockerKind: "material",
				blocker,
				detail:
					"texture-page bindings include sampling behavior that is not supported by the compacted shader family",
			};
	}
	throw new Error(`Unhandled compaction material blocker ${blocker}`);
}

function classifyCompactionMaterialFamily(options: {
	candidateKind: string;
	materialKind: CompactionMaterialKind;
	materialBehavior: LegacyMaterialBehaviorDto | null;
}): CompactionMaterialFamily {
	if (options.candidateKind === "portal-mask") {
		return "debug-pipeline";
	}
	switch (options.materialKind) {
		case "flat":
			return "flat-constant-color";
		case "indexed-paletted":
			return "indexed-paletted";
		case "direct-texture":
			return classifyDirectTextureCompactionMaterialFamily(
				options.materialBehavior,
			);
	}
}

function classifyDirectTextureCompactionMaterialFamily(
	behavior: LegacyMaterialBehaviorDto | null,
): CompactionMaterialFamily {
	const alphaPolicy = classifyCompactionAlphaPolicy(behavior);
	switch (alphaPolicy) {
		case "cutout":
			return "textured-opaque";
		case "transparent-blend":
			return "transparent-blended";
		case "opacity-translucent":
			return "opacity-translucent";
		case "unknown":
			return "unknown-unsupported";
		case "opaque":
			return "textured-opaque";
	}
}

function classifyCompactionAlphaPolicy(
	behavior: LegacyMaterialBehaviorDto | null,
): CompactionAlphaPolicy {
	if (behavior === null) {
		return "unknown";
	}
	if (behavior.alphaTest > 0) {
		return "cutout";
	}
	if (behavior.blend.enabled) {
		return "transparent-blend";
	}
	if (behavior.transparent || behavior.opacity < 1) {
		return "opacity-translucent";
	}
	return "opaque";
}

function hasCompatibleCompactedBaseTexturePage(
	texturePageBindings: readonly TexturePageDescriptor[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "base-color" &&
			binding.sampleClass === "rgba-color" &&
			binding.sampling.samplingDomain === "color" &&
			binding.sampling.lookup === "color-filtered",
	);
}

function hasIndexedTexelTexturePage(
	texturePageBindings: readonly TexturePageDescriptor[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "indexed-texels" &&
			binding.sampleClass === "indexed-data" &&
			hasExactDataTexturePageSampling(binding),
	);
}

function hasIndexedPaletteTexturePage(
	texturePageBindings: readonly TexturePageDescriptor[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "palette-lookup" &&
			binding.sampleClass === "palette-data" &&
			hasExactDataTexturePageSampling(binding),
	);
}

function hasExactDataTexturePageSampling(binding: TexturePageDescriptor): boolean {
	return (
		binding.sampling.samplingDomain === "data" &&
		binding.sampling.lookup === "exact" &&
		binding.sampling.minFilter === "nearest" &&
		binding.sampling.magFilter === "nearest" &&
		binding.sampling.mip === "none"
	);
}

function classifyUnsupportedIndexedTexturePageBlockers(
	texturePageBindings: readonly TexturePageDescriptor[],
	detailOverlay: CompactionDetailOverlayReadiness,
): CompactionMaterialBlocker[] {
	const texturePageBlockers = texturePageBindings
		.filter((binding) => binding.usageBucket !== "detail")
		.map((binding) => {
			switch (binding.usageBucket) {
				case "indexed-texels":
					if (binding.sampleClass !== "indexed-data") {
						return "unsupported-texture-page-sample-class";
					}
					return hasExactDataTexturePageSampling(binding)
						? null
						: "unsupported-texture-page-sampling";
				case "palette-lookup":
					if (binding.sampleClass !== "palette-data") {
						return "unsupported-texture-page-sample-class";
					}
					return hasExactDataTexturePageSampling(binding)
						? null
						: "unsupported-texture-page-sampling";
				default:
					return formatUnsupportedTexturePageUsageBlocker(
						binding.usageBucket,
					);
			}
		});
	return collectUniqueMaterialBlockers([
		...texturePageBlockers,
		detailOverlay.hasOverlay && !detailOverlay.atlasEntry
			? "detail-overlay"
			: null,
	]);
}

function classifyUnsupportedCompactedTexturePageBlockers(
	texturePageBindings: readonly TexturePageDescriptor[],
): CompactionMaterialBlocker[] {
	return collectUniqueMaterialBlockers(
		texturePageBindings.map((binding) => {
			switch (binding.usageBucket) {
				case "base-color":
				case "detail":
					if (binding.sampleClass !== "rgba-color") {
						return "unsupported-texture-page-sample-class";
					}
					return hasColorFilteredTexturePageSampling(binding)
						? null
						: "unsupported-texture-page-sampling";
				default:
					return formatUnsupportedTexturePageUsageBlocker(
						binding.usageBucket,
					);
			}
		}),
	);
}

function formatUnsupportedTexturePageUsageBlocker(
	usageBucket: TexturePageUsageBucket,
): CompactionMaterialBlocker {
	return `unsupported-texture-page-usage:${usageBucket}`;
}

function isUnsupportedTexturePageUsageBlocker(
	blocker: CompactionMaterialBlocker,
): boolean {
	return blocker.startsWith("unsupported-texture-page-usage:");
}

function hasColorFilteredTexturePageSampling(binding: TexturePageDescriptor): boolean {
	return (
		binding.sampling.samplingDomain === "color" &&
		binding.sampling.lookup === "color-filtered"
	);
}

function collectUniqueMaterialBlockers(
	blockers: readonly (CompactionMaterialBlocker | null)[],
): CompactionMaterialBlocker[] {
	const unique: CompactionMaterialBlocker[] = [];
	for (const blocker of blockers) {
		if (blocker && !unique.includes(blocker)) {
			unique.push(blocker);
		}
	}
	return unique;
}

function assignRgbaTexturePageFamilyMaterialSlots(
	candidates: readonly EligibleCompactionFamilyCandidate[],
): RgbaTexturePageFamilyMaterialSlot[] {
	return [
		...new Map(
			candidates.map(
				(candidate) =>
					[
						describeCompactionMaterialSlotKey(candidate),
						candidate.eligibility,
					] as const,
			),
		).entries(),
	]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, eligibility], index) => ({
			key,
			sourceMaterialSlotKey: eligibility.materialSlotKey,
			index,
			renderStateKey: eligibility.renderStateKey,
			samplingKey: eligibility.samplingKey,
			samplingPolicy: eligibility.samplingPolicy,
			atlasEntryKey: eligibility.atlasEntryKey,
			...describeRgbaTexturePageAlphaSlot(candidates, key),
			...describeRgbaTexturePageDetailSlot(candidates, key),
		}));
}

function createRgbaTexturePageFamilyPartitions({
	candidates,
	policy,
	placementsByEntryKey,
	detailPlacementsByEntryKey,
}: {
	candidates: readonly EligibleCompactionFamilyCandidate[];
	policy: CompactionFamilyPlanningPolicy;
	placementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>;
	detailPlacementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>;
}): RgbaTexturePageRenderFamilyPartition[] {
	return createBoundedMaterialTablePartitions({
		candidates,
		maxMaterialSlots: policy.maxMaterialSlotsPerDraw,
		describeMaterialKey: describeCompactionMaterialSlotKey,
		createMaterialRecord: (candidate) =>
			[
				describeCompactionMaterialSlotKey(candidate),
				candidate.eligibility,
			] as const,
	}).map((partition) => {
		const materialSlots = partition.materialRecords.map(
			([key, eligibility], index) => ({
				key,
				sourceMaterialSlotKey: eligibility.materialSlotKey,
				index,
				renderStateKey: eligibility.renderStateKey,
				samplingKey: eligibility.samplingKey,
				samplingPolicy: eligibility.samplingPolicy,
				atlasEntryKey: eligibility.atlasEntryKey,
				...describeRgbaTexturePageAlphaSlot(partition.candidates, key),
				...describeRgbaTexturePageDetailSlot(partition.candidates, key),
			}),
		);
		const materialSlotByKey = new Map(
			materialSlots.map((slot) => [slot.key, slot] as const),
		);
		const candidateMaterialSlots = partition.candidates.map((candidate) => ({
			candidateId: candidate.source.id,
			materialSlotKey: describeCompactionMaterialSlotKey(candidate),
		}));
		const drawSlices = createRgbaTexturePageFamilyDrawSlices(
			partition.candidates,
			materialSlotByKey,
			placementsByEntryKey,
			detailPlacementsByEntryKey,
		);
		return {
			key: `rgba-texture-page-partition/${partition.partitionIndex}`,
			compactableCandidateIds: partition.candidates.map(
				(candidate) => candidate.source.id,
			),
			materialSlots,
			candidateMaterialSlots,
			drawSlices,
		};
	});
}

function describeRgbaTexturePageAlphaSlot(
	candidates: readonly EligibleCompactionFamilyCandidate[],
	materialSlotKey: string,
): Pick<RgbaTexturePageFamilyMaterialSlot, "alphaPolicy" | "alphaTest"> {
	const alphaPolicies = [
		...new Set(
			candidates
				.filter(
					(candidate) =>
						describeCompactionMaterialSlotKey(candidate) === materialSlotKey,
				)
				.map((candidate) => candidate.source.compactionEligibility.material.alphaPolicy),
		),
	];
	if (alphaPolicies.length > 1) {
		throw new Error(
			`Compacted RGBA material slot ${materialSlotKey} has multiple alpha policies.`,
		);
	}
	const alphaPolicy = alphaPolicies[0] ?? "opaque";
	if (alphaPolicy !== "opaque" && alphaPolicy !== "cutout") {
		throw new Error(
			`Compacted RGBA material slot ${materialSlotKey} has unsupported alpha policy ${alphaPolicy}.`,
		);
	}
	const alphaTests = [
		...new Set(
			candidates
				.filter(
					(candidate) =>
						describeCompactionMaterialSlotKey(candidate) === materialSlotKey,
				)
				.map((candidate) => candidate.source.compactionEligibility.material.alphaTest),
		),
	];
	if (alphaTests.length > 1) {
		throw new Error(
			`Compacted RGBA material slot ${materialSlotKey} has multiple alpha-test thresholds.`,
		);
	}
	return {
		alphaPolicy,
		alphaTest: alphaTests[0] ?? 0,
	};
}

function describeRgbaTexturePageDetailSlot(
	candidates: readonly EligibleCompactionFamilyCandidate[],
	materialSlotKey: string,
): Pick<
	RgbaTexturePageFamilyMaterialSlot,
	"detailAtlasEntryKey" | "detailTiling"
> {
	const detailEntries = [
		...new Map(
			candidates
				.filter(
					(candidate) =>
						describeCompactionMaterialSlotKey(candidate) === materialSlotKey,
				)
				.map((candidate) => candidate.source.detailAtlasEntry)
				.filter(
					(entry): entry is RgbaTexturePageDetailAtlasEntry =>
						entry !== null && entry !== undefined,
				)
				.map((entry) => [entry.key, entry] as const),
		).values(),
	];
	if (detailEntries.length > 1) {
		throw new Error(
			`Compacted geometry material slot ${materialSlotKey} has multiple detail atlas entries.`,
		);
	}
	const detailEntry = detailEntries[0] ?? null;
	return {
		detailAtlasEntryKey: detailEntry?.key ?? null,
		detailTiling: detailEntry?.tiling ?? 1,
	};
}

function describeCompactionMaterialSlotKey(
	candidate: EligibleCompactionFamilyCandidate,
): string {
	return [
		candidate.eligibility.materialSlotKey,
		`wrap=${candidate.eligibility.samplingPolicy.wrapS}/${candidate.eligibility.samplingPolicy.wrapT}`,
		`detail=${candidate.source.detailAtlasEntry?.key ?? "none"}`,
	].join("|");
}

function dedupeRgbaTexturePageCandidates(
	candidates: readonly EligibleCompactionFamilyCandidate[],
): EligibleCompactionFamilyCandidate[] {
	const candidateById = new Map<
		string,
		EligibleCompactionFamilyCandidate
	>();
	for (const candidate of candidates) {
		const previous = candidateById.get(candidate.source.id);
		if (!previous) {
			candidateById.set(candidate.source.id, candidate);
			continue;
		}
		const previousSignature = describeRgbaCandidateSliceIdentity(previous);
		const candidateSignature = describeRgbaCandidateSliceIdentity(candidate);
		if (previousSignature !== candidateSignature) {
			throw new Error(
				`RGBA compaction candidate ${candidate.source.id} maps to multiple material slice identities: ${previousSignature} and ${candidateSignature}.`,
			);
		}
	}
	return [...candidateById.values()];
}

function describeRgbaCandidateSliceIdentity(
	candidate: EligibleCompactionFamilyCandidate,
): string {
	return [
		candidate.eligibility.atlasEntryKey,
		candidate.eligibility.renderStateKey,
		describeCompactionMaterialSlotKey(candidate),
	].join("|");
}

function createRgbaTexturePageFamilyDrawSlices(
	candidates: readonly EligibleCompactionFamilyCandidate[],
	materialSlotByKey: ReadonlyMap<string, RgbaTexturePageFamilyMaterialSlot>,
	placementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
	detailPlacementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
): RgbaTexturePageFamilyDrawSlice[] {
	const groups = new Map<
		string,
		{
			atlasTextureIndex: number;
			detailAtlasTextureIndex: number | null;
			renderStateKey: string;
			slotIndices: number[];
			materialSlotKeys: Set<string>;
			candidateIds: string[];
		}
	>();
	for (const candidate of candidates) {
		const slot = materialSlotByKey.get(
			describeCompactionMaterialSlotKey(candidate),
		);
		if (!slot) {
			continue;
		}
		const atlasTextureIndex =
			placementsByEntryKey.get(candidate.eligibility.atlasEntryKey)
				?.textureIndex ?? 0;
		const detailAtlasTextureIndex = slot.detailAtlasEntryKey
			? (detailPlacementsByEntryKey.get(slot.detailAtlasEntryKey)
					?.textureIndex ?? null)
			: null;
		const key = [
			atlasTextureIndex,
			detailAtlasTextureIndex ?? "no-detail",
			slot.renderStateKey,
		].join("|");
		const group = groups.get(key) ?? {
			atlasTextureIndex,
			detailAtlasTextureIndex,
			renderStateKey: slot.renderStateKey,
			slotIndices: [],
			materialSlotKeys: new Set<string>(),
			candidateIds: [],
		};
		group.slotIndices.push(slot.index);
		group.materialSlotKeys.add(slot.key);
		group.candidateIds.push(candidate.source.id);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				left.atlasTextureIndex - right.atlasTextureIndex ||
				(left.detailAtlasTextureIndex ?? -1) -
					(right.detailAtlasTextureIndex ?? -1) ||
				left.renderStateKey.localeCompare(right.renderStateKey) ||
				compareFirstCandidateId(left.candidateIds, right.candidateIds),
		)
		.map((group) => {
			const materialTableSlotStart = Math.min(...group.slotIndices);
			const materialTableSlotEnd = Math.max(...group.slotIndices);
			const materialSlotKeys = [...group.materialSlotKeys].sort();
			const candidateIds = [...group.candidateIds].sort();
			return {
				key: [
					"rgba-texture-page-draw-slice",
					`texture=${group.atlasTextureIndex}`,
					`detail=${group.detailAtlasTextureIndex ?? "none"}`,
					group.renderStateKey,
					`table=${materialTableSlotStart}-${materialTableSlotEnd}`,
				].join("|"),
				atlasTextureIndex: group.atlasTextureIndex,
				detailAtlasTextureIndex: group.detailAtlasTextureIndex,
				renderStateKey: group.renderStateKey,
				materialTableSlotStart,
				materialTableSlotCount:
					materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys,
				candidateIds,
			};
		});
}

function compareFirstCandidateId(
	left: readonly string[],
	right: readonly string[],
): number {
	return (left[0] ?? "").localeCompare(right[0] ?? "");
}

function describeCompactionFamilyPlanKey(options: {
	policy: CompactionFamilyPlanningPolicy;
	atlasPlanKey: string;
	materialSlotKeys: readonly string[];
	indexedMaterialTableRecordKeys: readonly string[];
}): string {
	return [
		"compaction-families",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		`slots=${options.policy.maxMaterialSlotsPerDraw}`,
		`atlas=${options.atlasPlanKey}`,
		...options.materialSlotKeys,
		...options.indexedMaterialTableRecordKeys.map((key) => `indexed=${key}`),
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
