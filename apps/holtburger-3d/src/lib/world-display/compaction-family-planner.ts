import { planAtlasLayout, type AtlasTexturePage } from "./atlas-layout-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { RenderVec4 } from "./render-math";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";
import type { TexturePageBinding } from "./texture-page-binding";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";

export type CompactionFamilyBypassReason =
	| "non-static"
	| "missing-landblock-origin"
	| "unsupported-compacted-material-family"
	| "missing-uv-buffer"
	| "missing-atlas-eligibility"
	| "unsupported-alpha-test-material"
	| "unsupported-transparent-blended-material"
	| "unsupported-opacity-translucent-material"
	| "unsupported-constant-color-material"
	| "unsupported-indexed-paletted-material"
	| "unsupported-indexed-texture-page-policy"
	| "indexed-alpha-policy-unsupported"
	| "unsupported-terrain-material"
	| "debug-pipeline-material"
	| "unsupported-material-state"
	| "detail-overlay"
	| "missing-detail-atlas-entry"
	| "source-texture-too-large"
	| "atlas-full"
	| "detail-atlas-full"
	| "material-table-overflow";

export type CompactionMaterialKind =
	| "flat"
	| "direct-texture"
	| "indexed-paletted"
	| "terrain-blend";

export type CompactionMaterialFamily =
	| "flat-constant-color"
	| "textured-opaque"
	| "alpha-test"
	| "transparent-blended"
	| "opacity-translucent"
	| "indexed-paletted"
	| "terrain-blend"
	| "debug-pipeline"
	| "unknown-unsupported";

export type CompactionAlphaPolicy =
	| "opaque"
	| "cutout"
	| "transparent-blend"
	| "opacity-translucent"
	| "unknown";

export type CompactionMaterialBlocker =
	| "missing-base-texture-page"
	| "missing-indexed-texel-page"
	| "missing-indexed-palette-page"
	| "missing-atlas-eligibility"
	| "missing-compacted-constant-color-family"
	| "missing-compacted-indexed-paletted-family"
	| "indexed-alpha-policy-unsupported"
	| "missing-compacted-alpha-test-family"
	| "missing-compacted-transparent-blended-family"
	| "missing-compacted-opacity-translucent-family"
	| "missing-compacted-terrain-family"
	| "debug-pipeline-material"
	| "detail-overlay"
	| "missing-detail-atlas-entry"
	| "repeat-detail-atlas-unsupported"
	| "unsupported-material-state"
	| "unsupported-texture-page-behavior";

export type CompactionGeometryBlocker =
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
		atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
		detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
	};
	geometry: {
		compatible: boolean;
		blockers: readonly CompactionGeometryBlocker[];
	};
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

export interface CompactionFamilyBypass {
	drawUnitId: string;
	reason: CompactionFamilyBypassReason;
	detail: string;
}

export interface RgbaTexturePageFamilyMaterialSlot {
	key: string;
	sourceMaterialSlotKey: string;
	index: number;
	renderStateKey: string;
	samplingKey: string;
	samplingPolicy: StagedWorldMaterialAtlasEligibility["samplingPolicy"];
	atlasEntryKey: string;
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

export interface IndexedPalettedFamilyDrawSlice {
	key: string;
	indexFormat: "p8" | "index16";
	indexPageKey: string;
	palettePageKey: string;
	renderStateKey: "indexed-opaque";
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	drawUnitIds: readonly string[];
}

export interface RgbaTexturePageFamilyDrawSlice {
	key: string;
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	drawUnitIds: readonly string[];
}

export interface RgbaTexturePageAtlasEntryRecord {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
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
	blendMode: "dst-color";
}

export interface CompactionFamilyPlan {
	key: string;
	// Temporary migration debt: renderFamilies is the old RGBA-atlas-shaped
	// planning boundary. New compacted material work should replace this with
	// render family pipeline plans instead of adding more parallel submit-family
	// fields.
	renderFamilies: CompactionRenderFamilies;
	compactableDrawUnitIds: readonly string[];
	bypasses: readonly CompactionFamilyBypass[];
	atlasEntryRecords: readonly RgbaTexturePageAtlasEntryRecord[];
	atlasEntries: readonly StagedWorldMaterialAtlasEligibility["atlasEntry"][];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly RgbaTexturePageDetailAtlasEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	indexedMaterialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	drawUnitMaterialSlots: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
	staticObjectKeys: readonly string[];
	staticPartCount: number;
	triangleCount: number;
	preparedTextureAssetIds: readonly string[];
}

export interface CompactionRenderFamilies {
	rgbaTexturePage: RgbaTexturePageRenderFamilyPlan;
	indexedPaletted: IndexedPalettedRenderFamilyPlan;
}

export interface RgbaTexturePageRenderFamilyPlan {
	kind: "rgba-atlas";
	compactableDrawUnitIds: readonly string[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	drawUnitMaterialSlots: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
}

export interface IndexedPalettedRenderFamilyPlan {
	kind: "indexed-paletted";
	compactableDrawUnitIds: readonly string[];
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	drawUnitMaterialSlots: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly IndexedPalettedFamilyDrawSlice[];
}

interface EligibleCompactionFamilyCandidate {
	drawUnit: CompactionFamilyCandidate;
	eligibility: StagedWorldMaterialAtlasEligibility;
}

interface RgbaTexturePageEntryRecord {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export function createEmptyCompactionFamilyPlan(): CompactionFamilyPlan {
	return {
		key: "compaction-families/empty",
		renderFamilies: createCompactionRenderFamilies({
			compactableDrawUnitIds: [],
			materialSlots: [],
			indexedMaterialTableRecords: [],
			drawUnitMaterialSlots: [],
			drawSlices: [],
		}),
		compactableDrawUnitIds: [],
		bypasses: [],
		atlasEntryRecords: [],
		atlasEntries: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		materialSlots: [],
		indexedMaterialTableRecords: [],
		drawUnitMaterialSlots: [],
		drawSlices: [],
		staticObjectKeys: [],
		staticPartCount: 0,
		triangleCount: 0,
		preparedTextureAssetIds: [],
	};
}

export function planCompactionFamilies(options: {
	drawUnits: readonly CompactionFamilyCandidate[];
	policy: CompactionFamilyPlanningPolicy;
}): CompactionFamilyPlan {
	const rgbaEligible: EligibleCompactionFamilyCandidate[] = [];
	const bypasses: CompactionFamilyBypass[] = [];
	for (const drawUnit of options.drawUnits) {
		const bypass = classifyCompactionFamilyBypass(drawUnit);
		if (bypass) {
			bypasses.push(bypass);
			continue;
		}
		if (drawUnit.compactionEligibility.material.family === "indexed-paletted") {
			continue;
		}
		const atlasEligibility =
			drawUnit.compactionEligibility.material.atlasEligibility;
		if (!atlasEligibility) {
			throw new Error(
				`Compacted geometry candidate ${drawUnit.id} was accepted without packed texture-page eligibility.`,
			);
		}
		rgbaEligible.push({ drawUnit, eligibility: atlasEligibility });
	}

	const atlasEntries = dedupeRgbaTexturePageEntries(rgbaEligible);
	const layout = planAtlasLayout({
		entries: atlasEntries.map((record) => ({
			key: record.key,
			width: record.entry.level.width,
			height: record.entry.level.height,
		})),
		policy: {
			maxTextureSize: options.policy.maxAtlasTextureSize,
			maxTextureCount: options.policy.maxAtlasTextureCount,
			gutterPixels: options.policy.baseGutterPixels,
		},
	});
	const placed = rgbaEligible.filter((candidate) =>
		layout.placementsByEntryKey.has(candidate.eligibility.atlasEntryKey),
	);
	for (const candidate of rgbaEligible) {
		const overflow = layout.overflowsByEntryKey.get(
			candidate.eligibility.atlasEntryKey,
		);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnit.id,
			reason:
				overflow.reason === "source-too-large"
					? "source-texture-too-large"
					: "atlas-full",
			detail: overflow.detail,
		});
	}

	const indexedCandidates = collectIndexedPalettedCompactionCandidates(
		options.drawUnits,
	);
	const detailEntries = dedupeCompactionFamilyDetailEntries([
		...placed.map((candidate) => candidate.drawUnit),
		...indexedCandidates,
	]);
	const detailLayout = planAtlasLayout({
		entries: detailEntries.map((entry) => ({
			key: entry.key,
			width: entry.width,
			height: entry.height,
		})),
		policy: {
			maxTextureSize: options.policy.maxAtlasTextureSize,
			maxTextureCount: options.policy.maxAtlasTextureCount,
			gutterPixels: options.policy.baseGutterPixels,
		},
	});
	const detailPlaced = placed.filter((candidate) => {
		const detailEntryKey = candidate.drawUnit.detailAtlasEntry?.key ?? null;
		return (
			detailEntryKey === null ||
			detailLayout.placementsByEntryKey.has(detailEntryKey)
		);
	});
	const detailReadyIndexedCandidates = indexedCandidates.filter((candidate) => {
		const detailEntryKey = candidate.detailAtlasEntry?.key ?? null;
		return (
			detailEntryKey === null ||
			detailLayout.placementsByEntryKey.has(detailEntryKey)
		);
	});
	for (const candidate of placed) {
		const detailEntryKey = candidate.drawUnit.detailAtlasEntry?.key ?? null;
		if (detailEntryKey === null) {
			continue;
		}
		const overflow = detailLayout.overflowsByEntryKey.get(detailEntryKey);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnit.id,
			reason: "detail-atlas-full",
			detail: overflow.detail,
		});
	}
	for (const candidate of indexedCandidates) {
		const detailEntryKey = candidate.detailAtlasEntry?.key ?? null;
		if (detailEntryKey === null) {
			continue;
		}
		const overflow = detailLayout.overflowsByEntryKey.get(detailEntryKey);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.id,
			reason: "detail-atlas-full",
			detail: overflow.detail,
		});
	}

	const indexedMaterialTableRecords =
		assignIndexedPalettedFamilyMaterialTableRecords(
			detailReadyIndexedCandidates,
			options.policy,
		);
	const indexedMaterialTableRecordByKey = new Map(
		indexedMaterialTableRecords.map((record) => [record.key, record] as const),
	);
	const indexedCompactable = detailReadyIndexedCandidates.filter(
		(candidate) => {
			const record = candidate.indexedMaterialTableRecord;
			if (record && indexedMaterialTableRecordByKey.has(record.key)) {
				return true;
			}
			bypasses.push({
				drawUnitId: candidate.id,
				reason: "material-table-overflow",
				detail: `indexed material table exceeded ${options.policy.maxMaterialSlotsPerDraw} slots`,
			});
			return false;
		},
	);
	const indexedDrawUnitMaterialSlots = indexedCompactable.map((candidate) => ({
		drawUnitId: candidate.id,
		materialSlotKey:
			requireIndexedPalettedFamilyMaterialTableRecord(candidate).key,
	}));
	const indexedDrawSlices = createIndexedPalettedFamilyDrawSlices({
		candidates: indexedCompactable,
		materialTableRecords: indexedMaterialTableRecords,
	});
	const materialSlots = assignRgbaTexturePageFamilyMaterialSlots(
		detailPlaced,
		options.policy,
	);
	const materialSlotByKey = new Map(
		materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const compactable = detailPlaced.filter((candidate) => {
		if (materialSlotByKey.has(describeCompactionMaterialSlotKey(candidate))) {
			return true;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnit.id,
			reason: "material-table-overflow",
			detail: `material table exceeded ${options.policy.maxMaterialSlotsPerDraw} slots`,
		});
		return false;
	});
	const drawSlices = createRgbaTexturePageFamilyDrawSlices(
		compactable,
		materialSlotByKey,
		layout.placementsByEntryKey,
		detailLayout.placementsByEntryKey,
	);
	const compactableDrawUnitIds = compactable.map(
		(candidate) => candidate.drawUnit.id,
	);
	const indexedCompactableDrawUnitIds = indexedCompactable.map(
		(candidate) => candidate.id,
	);
	const allCompactableDrawUnitIds = [
		...compactableDrawUnitIds,
		...indexedCompactableDrawUnitIds,
	];
	const drawUnitMaterialSlots = compactable.map((candidate) => ({
		drawUnitId: candidate.drawUnit.id,
		materialSlotKey: describeCompactionMaterialSlotKey(candidate),
	}));
	const compactableEntryKeys = new Set(
		compactable.map((candidate) => candidate.eligibility.atlasEntryKey),
	);
	const usedDetailEntryKeys = new Set(
		[
			...compactable.map(
				(candidate) => candidate.drawUnit.detailAtlasEntry?.key ?? "",
			),
			...indexedCompactable.map(
				(candidate) => candidate.detailAtlasEntry?.key ?? "",
			),
		].filter((key) => key.length > 0),
	);
	return {
		key: describeCompactionFamilyPlanKey({
			policy: options.policy,
			atlasEntryKeys: [...compactableEntryKeys].sort(),
			detailAtlasEntryKeys: detailEntries
				.filter((entry) => usedDetailEntryKeys.has(entry.key))
				.map((entry) => entry.key),
			materialSlotKeys: materialSlots.map((slot) => slot.key),
			indexedMaterialTableRecordKeys: indexedMaterialTableRecords.map(
				(record) => record.key,
			),
		}),
		compactableDrawUnitIds: allCompactableDrawUnitIds,
		renderFamilies: createCompactionRenderFamilies({
			compactableDrawUnitIds,
			materialSlots,
			indexedMaterialTableRecords,
			indexedCompactableDrawUnitIds,
			indexedDrawUnitMaterialSlots,
			indexedDrawSlices,
			drawUnitMaterialSlots,
			drawSlices,
		}),
		bypasses,
		atlasEntryRecords: atlasEntries.filter((record) =>
			compactableEntryKeys.has(record.key),
		),
		atlasEntries: atlasEntries
			.filter((record) => compactableEntryKeys.has(record.key))
			.map((record) => record.entry),
		atlasTextures: layout.texturePages
			.map((page) => ({
				...page,
				placements: page.placements.filter((placement) =>
					compactableEntryKeys.has(placement.atlasEntryKey),
				),
			}))
			.filter((page) => page.placements.length > 0),
		detailAtlasEntryRecords: detailEntries.filter((entry) =>
			usedDetailEntryKeys.has(entry.key),
		),
		detailAtlasTextures: detailLayout.texturePages
			.map((page) => ({
				...page,
				placements: page.placements.filter((placement) =>
					usedDetailEntryKeys.has(placement.atlasEntryKey),
				),
			}))
			.filter((page) => page.placements.length > 0),
		materialSlots,
		indexedMaterialTableRecords,
		drawUnitMaterialSlots,
		drawSlices,
		staticObjectKeys: uniqueSortedStrings([
			...compactable.flatMap(
				(candidate) => candidate.drawUnit.staticObjectKeys,
			),
			...indexedCompactable.flatMap((candidate) => candidate.staticObjectKeys),
		]),
		staticPartCount:
			compactable.reduce(
				(total, candidate) => total + candidate.drawUnit.staticPartCount,
				0,
			) +
			indexedCompactable.reduce(
				(total, candidate) => total + candidate.staticPartCount,
				0,
			),
		triangleCount:
			compactable.reduce(
				(total, candidate) => total + candidate.drawUnit.triangleCount,
				0,
			) +
			indexedCompactable.reduce(
				(total, candidate) => total + candidate.triangleCount,
				0,
			),
		preparedTextureAssetIds: uniqueSortedStrings(
			compactable.map(
				(candidate) => candidate.eligibility.atlasEntry.preparedTextureAssetId,
			),
		),
	};
}

function createCompactionRenderFamilies({
	compactableDrawUnitIds,
	materialSlots,
	indexedMaterialTableRecords,
	indexedCompactableDrawUnitIds,
	indexedDrawUnitMaterialSlots,
	indexedDrawSlices,
	drawUnitMaterialSlots,
	drawSlices,
}: {
	compactableDrawUnitIds: readonly string[];
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	indexedMaterialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	indexedCompactableDrawUnitIds?: readonly string[];
	indexedDrawUnitMaterialSlots?: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	indexedDrawSlices?: readonly IndexedPalettedFamilyDrawSlice[];
	drawUnitMaterialSlots: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
}): CompactionRenderFamilies {
	return {
		rgbaTexturePage: {
			kind: "rgba-atlas",
			compactableDrawUnitIds,
			materialSlots,
			drawUnitMaterialSlots,
			drawSlices,
		},
		indexedPaletted: {
			kind: "indexed-paletted",
			compactableDrawUnitIds: indexedCompactableDrawUnitIds ?? [],
			materialTableRecords: indexedMaterialTableRecords,
			drawUnitMaterialSlots: indexedDrawUnitMaterialSlots ?? [],
			drawSlices: indexedDrawSlices ?? [],
		},
	};
}

function collectIndexedPalettedCompactionCandidates(
	drawUnits: readonly CompactionFamilyCandidate[],
): CompactionFamilyCandidate[] {
	return drawUnits.filter(isIndexedPalettedMaterialTableReady);
}

function assignIndexedPalettedFamilyMaterialTableRecords(
	candidates: readonly CompactionFamilyCandidate[],
	policy: CompactionFamilyPlanningPolicy,
): IndexedPalettedFamilyMaterialTableRecord[] {
	const recordsByKey = new Map<
		string,
		IndexedPalettedFamilyMaterialTableRecord
	>();
	for (const drawUnit of candidates) {
		const record = requireIndexedPalettedFamilyMaterialTableRecord(drawUnit);
		recordsByKey.set(record.key, record);
	}
	return [...recordsByKey.values()]
		.sort((left, right) => left.key.localeCompare(right.key))
		.slice(0, policy.maxMaterialSlotsPerDraw);
}

function requireIndexedPalettedFamilyMaterialTableRecord(
	drawUnit: CompactionFamilyCandidate,
): IndexedPalettedFamilyMaterialTableRecord {
	const record = drawUnit.indexedMaterialTableRecord;
	if (!record) {
		throw new Error(
			`Indexed material candidate ${drawUnit.id} is table-ready without a material-table record.`,
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
			drawUnitIds: string[];
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
			candidate.visibilityPartitionKey,
			"indexed-opaque",
		].join("|");
		const group = groups.get(key) ?? {
			record,
			slotIndex,
			drawUnitIds: [],
		};
		group.drawUnitIds.push(candidate.id);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				left.record.indexFormat.localeCompare(right.record.indexFormat) ||
				left.record.indexPageKey.localeCompare(right.record.indexPageKey) ||
				left.record.palettePageKey.localeCompare(right.record.palettePageKey) ||
				compareFirstDrawUnitId(left.drawUnitIds, right.drawUnitIds),
		)
		.map((group) => ({
			key: [
				"compacted-indexed-draw-slice",
				group.record.indexFormat,
				group.record.indexPageKey,
				group.record.palettePageKey,
				group.record.key,
				`visibility=${describeDrawSliceVisibilityPartition(group.drawUnitIds)}`,
				`table=${group.slotIndex}`,
			].join("|"),
			indexFormat: group.record.indexFormat,
			indexPageKey: group.record.indexPageKey,
			palettePageKey: group.record.palettePageKey,
			renderStateKey: "indexed-opaque",
			materialTableSlotStart: group.slotIndex,
			materialTableSlotCount: 1,
			materialSlotKeys: [group.record.key],
			drawUnitIds: [...group.drawUnitIds].sort(),
		}));
}

function isIndexedPalettedMaterialTableReady(
	drawUnit: CompactionFamilyCandidate,
): boolean {
	if (drawUnit.materialKind !== "indexed-paletted") {
		return false;
	}
	if (!drawUnit.compactionEligibility.geometry.compatible) {
		return false;
	}
	const material = drawUnit.compactionEligibility.material;
	return (
		material.family === "indexed-paletted" &&
		material.alphaPolicy === "opaque" &&
		!material.blockers.includes("missing-indexed-texel-page") &&
		!material.blockers.includes("missing-indexed-palette-page") &&
		!material.blockers.includes("unsupported-texture-page-behavior") &&
		!material.blockers.includes("indexed-alpha-policy-unsupported")
	);
}

function classifyCompactionFamilyBypass(
	drawUnit: CompactionFamilyCandidate,
): CompactionFamilyBypass | null {
	const geometryBlocker =
		drawUnit.compactionEligibility.geometry.blockers[0] ?? null;
	if (geometryBlocker) {
		return createGeometryCompactionBypass(drawUnit, geometryBlocker);
	}
	const materialBlocker =
		drawUnit.compactionEligibility.material.blockers[0] ?? null;
	if (materialBlocker) {
		return createMaterialCompactionBypass(drawUnit, materialBlocker);
	}
	return null;
}

export function createCompactionEligibility(options: {
	kind: string;
	owningLandblockId: number | null;
	materialKind: CompactionMaterialKind;
	hasUvBuffer: boolean;
	texturePageBindings: readonly TexturePageBinding[];
	materialBehavior: LegacyMaterialBehaviorDto | null;
	hasDetailOverlay: boolean;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
	atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
}): CompactionEligibility {
	const geometryBlockers: CompactionGeometryBlocker[] = [];
	if (options.kind !== "static" && options.kind !== "structured-interior") {
		geometryBlockers.push("non-static");
	}
	if (options.owningLandblockId === null) {
		geometryBlockers.push("missing-landblock-origin");
	}
	if (!options.hasUvBuffer) {
		geometryBlockers.push("missing-uv-buffer");
	}

	const materialFamily = classifyCompactionMaterialFamily({
		drawUnitKind: options.kind,
		materialKind: options.materialKind,
		materialBehavior: options.materialBehavior,
	});
	const alphaPolicy = classifyCompactionAlphaPolicy(options.materialBehavior);
	const materialBlockers: CompactionMaterialBlocker[] = [];
	switch (materialFamily) {
		case "flat-constant-color":
			materialBlockers.push("missing-compacted-constant-color-family");
			break;
		case "indexed-paletted":
			if (!hasIndexedTexelTexturePage(options.texturePageBindings)) {
				materialBlockers.push("missing-indexed-texel-page");
			}
			if (!hasIndexedPaletteTexturePage(options.texturePageBindings)) {
				materialBlockers.push("missing-indexed-palette-page");
			}
			if (
				!hasOnlySupportedIndexedTexturePageBehavior(options.texturePageBindings)
			) {
				materialBlockers.push("unsupported-texture-page-behavior");
			}
			if (alphaPolicy !== "opaque") {
				materialBlockers.push("indexed-alpha-policy-unsupported");
			}
			break;
		case "terrain-blend":
			materialBlockers.push("missing-compacted-terrain-family");
			break;
		case "debug-pipeline":
			materialBlockers.push("debug-pipeline-material");
			break;
		case "alpha-test":
			materialBlockers.push("missing-compacted-alpha-test-family");
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
			if (!options.atlasEligibility) {
				materialBlockers.push("missing-atlas-eligibility");
			}
			if (!hasCompatibleCompactedBaseTexturePage(options.texturePageBindings)) {
				materialBlockers.push("missing-base-texture-page");
			}
			if (options.hasDetailOverlay && !options.detailAtlasEntry) {
				materialBlockers.push("missing-detail-atlas-entry");
			}
			if (
				options.hasDetailOverlay &&
				hasRepeatedBaseColorTexturePage(options.texturePageBindings)
			) {
				materialBlockers.push("repeat-detail-atlas-unsupported");
			}
			if (
				!hasOnlySupportedCompactedTexturePageBehavior(
					options.texturePageBindings,
				)
			) {
				materialBlockers.push("unsupported-texture-page-behavior");
			}
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
			atlasEligibility: options.atlasEligibility,
			detailAtlasEntry: options.detailAtlasEntry,
		},
		geometry: {
			compatible: geometryCompatible,
			blockers: geometryBlockers,
		},
	};
}

function createGeometryCompactionBypass(
	drawUnit: CompactionFamilyCandidate,
	blocker: CompactionGeometryBlocker,
): CompactionFamilyBypass {
	switch (blocker) {
		case "non-static":
			return {
				drawUnitId: drawUnit.id,
				reason: "non-static",
				detail: `draw unit kind ${drawUnit.kind} is not compacted geometry`,
			};
		case "missing-landblock-origin":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-landblock-origin",
				detail: "compacted geometry draw unit has no owning landblock",
			};
		case "missing-uv-buffer":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-uv-buffer",
				detail: "compacted geometry draw unit has no UV buffer",
			};
	}
}

function createMaterialCompactionBypass(
	drawUnit: CompactionFamilyCandidate,
	blocker: CompactionMaterialBlocker,
): CompactionFamilyBypass {
	switch (blocker) {
		case "missing-compacted-constant-color-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-constant-color-material",
				detail: `flat/solid material ${drawUnit.materialKey} has no compacted constant-color material family`,
			};
		case "missing-compacted-indexed-paletted-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-indexed-paletted-material",
				detail: `indexed/paletted material ${drawUnit.materialKey} has no compacted indexed material family`,
			};
		case "missing-indexed-texel-page":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-indexed-texture-page-policy",
				detail: `indexed/paletted material ${drawUnit.materialKey} has no indexed texel texture-page binding`,
			};
		case "missing-indexed-palette-page":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-indexed-texture-page-policy",
				detail: `indexed/paletted material ${drawUnit.materialKey} has no palette texture-page binding`,
			};
		case "indexed-alpha-policy-unsupported":
			return {
				drawUnitId: drawUnit.id,
				reason: "indexed-alpha-policy-unsupported",
				detail: `indexed/paletted material ${drawUnit.materialKey} has alpha policy that is not supported by the compacted indexed path`,
			};
		case "detail-overlay":
			return {
				drawUnitId: drawUnit.id,
				reason: "detail-overlay",
				detail: `indexed/paletted material ${drawUnit.materialKey} has a detail overlay not yet supported by the compacted indexed family`,
			};
		case "missing-compacted-alpha-test-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-alpha-test-material",
				detail: `alpha-test material ${drawUnit.materialKey} has no compacted cutout material family`,
			};
		case "missing-compacted-transparent-blended-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-transparent-blended-material",
				detail: `blended material ${drawUnit.materialKey} has no compacted transparent material family`,
			};
		case "missing-compacted-opacity-translucent-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-opacity-translucent-material",
				detail: `opacity/translucent material ${drawUnit.materialKey} has no compacted translucent material family`,
			};
		case "missing-compacted-terrain-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-terrain-material",
				detail: `terrain material ${drawUnit.materialKey} belongs to the terrain pipeline`,
			};
		case "debug-pipeline-material":
			return {
				drawUnitId: drawUnit.id,
				reason: "debug-pipeline-material",
				detail: `debug/portal material ${drawUnit.materialKey} is outside the production compacted path`,
			};
		case "missing-base-texture-page":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-compacted-material-family",
				detail: `draw unit material ${drawUnit.materialKey} has no compacted-compatible base texture page`,
			};
		case "missing-atlas-eligibility":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-atlas-eligibility",
				detail:
					"compacted geometry draw unit has no packed texture-page eligibility",
			};
		case "missing-detail-atlas-entry":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-detail-atlas-entry",
				detail: "detail overlay has no compactable RGBA8 detail atlas entry",
			};
		case "repeat-detail-atlas-unsupported":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-compacted-material-family",
				detail:
					"repeated base-color material with detail overlay is retained direct until compacted atlas sampling supports this path",
			};
		case "unsupported-material-state":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-material-state",
				detail: `material ${drawUnit.materialKey} is not supported by any current compacted material family`,
			};
		case "unsupported-texture-page-behavior":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-compacted-material-family",
				detail:
					"texture-page bindings require a compacted shader family that is not implemented",
			};
	}
}

export function classifyCompactionMaterialFamily(options: {
	drawUnitKind: string;
	materialKind: CompactionMaterialKind;
	materialBehavior: LegacyMaterialBehaviorDto | null;
}): CompactionMaterialFamily {
	if (options.drawUnitKind === "portal-mask") {
		return "debug-pipeline";
	}
	switch (options.materialKind) {
		case "flat":
			return "flat-constant-color";
		case "indexed-paletted":
			return "indexed-paletted";
		case "terrain-blend":
			return "terrain-blend";
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
			return "alpha-test";
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

export function classifyCompactionAlphaPolicy(
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
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "base-color" &&
			binding.sampleClass === "rgba-color" &&
			binding.sampling.samplingDomain === "color" &&
			binding.sampling.lookup === "color-filtered",
	);
}

function hasRepeatedBaseColorTexturePage(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "base-color" &&
			binding.sampleClass === "rgba-color" &&
			(binding.wrapS === "repeat" || binding.wrapT === "repeat"),
	);
}

function hasIndexedTexelTexturePage(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "indexed-texels" &&
			binding.sampleClass === "indexed-data" &&
			hasExactDataTexturePageSampling(binding),
	);
}

function hasIndexedPaletteTexturePage(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "palette-lookup" &&
			binding.sampleClass === "palette-data" &&
			hasExactDataTexturePageSampling(binding),
	);
}

function hasOnlySupportedIndexedTexturePageBehavior(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.every((binding) => {
		if (
			binding.usageBucket === "indexed-texels" &&
			binding.sampleClass === "indexed-data"
		) {
			return hasExactDataTexturePageSampling(binding);
		}
		if (
			binding.usageBucket === "palette-lookup" &&
			binding.sampleClass === "palette-data"
		) {
			return hasExactDataTexturePageSampling(binding);
		}
		return false;
	});
}

function hasExactDataTexturePageSampling(binding: TexturePageBinding): boolean {
	return (
		binding.sampling.samplingDomain === "data" &&
		binding.sampling.lookup === "exact" &&
		binding.sampling.minFilter === "nearest" &&
		binding.sampling.magFilter === "nearest" &&
		binding.sampling.mip === "none"
	);
}

function hasOnlySupportedCompactedTexturePageBehavior(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.every((binding) => {
		if (
			binding.usageBucket === "base-color" ||
			binding.usageBucket === "detail"
		) {
			return (
				binding.sampleClass === "rgba-color" &&
				binding.sampling.samplingDomain === "color" &&
				binding.sampling.lookup === "color-filtered"
			);
		}
		return false;
	});
}

function isOpaqueStaticCompactionMaterial(
	behavior: LegacyMaterialBehaviorDto | null,
): boolean {
	return (
		behavior !== null &&
		!behavior.transparent &&
		!behavior.blend.enabled &&
		behavior.alphaTest <= 0 &&
		behavior.opacity >= 1
	);
}

function dedupeRgbaTexturePageEntries(
	candidates: readonly EligibleCompactionFamilyCandidate[],
): RgbaTexturePageEntryRecord[] {
	const entriesByKey = new Map<string, RgbaTexturePageEntryRecord>();
	for (const candidate of candidates) {
		entriesByKey.set(candidate.eligibility.atlasEntryKey, {
			key: candidate.eligibility.atlasEntryKey,
			entry: candidate.eligibility.atlasEntry,
		});
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function dedupeCompactionFamilyDetailEntries(
	candidates: readonly {
		detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
	}[],
): RgbaTexturePageDetailAtlasEntry[] {
	const entriesByKey = new Map<string, RgbaTexturePageDetailAtlasEntry>();
	for (const candidate of candidates) {
		const detailEntry = candidate.detailAtlasEntry;
		if (detailEntry) {
			entriesByKey.set(detailEntry.key, detailEntry);
		}
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function assignRgbaTexturePageFamilyMaterialSlots(
	candidates: readonly EligibleCompactionFamilyCandidate[],
	policy: CompactionFamilyPlanningPolicy,
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
		.slice(0, policy.maxMaterialSlotsPerDraw)
		.map(([key, eligibility], index) => ({
			key,
			sourceMaterialSlotKey: eligibility.materialSlotKey,
			index,
			renderStateKey: eligibility.renderStateKey,
			samplingKey: eligibility.samplingKey,
			samplingPolicy: eligibility.samplingPolicy,
			atlasEntryKey: eligibility.atlasEntryKey,
			...describeRgbaTexturePageDetailSlot(candidates, key),
		}));
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
				.map((candidate) => candidate.drawUnit.detailAtlasEntry)
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
		`detail=${candidate.drawUnit.detailAtlasEntry?.key ?? "none"}`,
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
			drawUnitIds: string[];
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
			candidate.drawUnit.visibilityPartitionKey,
		].join("|");
		const group = groups.get(key) ?? {
			atlasTextureIndex,
			detailAtlasTextureIndex,
			renderStateKey: slot.renderStateKey,
			slotIndices: [],
			materialSlotKeys: new Set<string>(),
			drawUnitIds: [],
		};
		group.slotIndices.push(slot.index);
		group.materialSlotKeys.add(slot.key);
		group.drawUnitIds.push(candidate.drawUnit.id);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				left.atlasTextureIndex - right.atlasTextureIndex ||
				(left.detailAtlasTextureIndex ?? -1) -
					(right.detailAtlasTextureIndex ?? -1) ||
				left.renderStateKey.localeCompare(right.renderStateKey) ||
				compareFirstDrawUnitId(left.drawUnitIds, right.drawUnitIds),
		)
		.map((group) => {
			const materialTableSlotStart = Math.min(...group.slotIndices);
			const materialTableSlotEnd = Math.max(...group.slotIndices);
			const materialSlotKeys = [...group.materialSlotKeys].sort();
			const drawUnitIds = [...group.drawUnitIds].sort();
			return {
				key: [
					"rgba-texture-page-draw-slice",
					`texture=${group.atlasTextureIndex}`,
					`detail=${group.detailAtlasTextureIndex ?? "none"}`,
					group.renderStateKey,
					`visibility=${describeDrawSliceVisibilityPartition(drawUnitIds)}`,
					`table=${materialTableSlotStart}-${materialTableSlotEnd}`,
				].join("|"),
				atlasTextureIndex: group.atlasTextureIndex,
				detailAtlasTextureIndex: group.detailAtlasTextureIndex,
				renderStateKey: group.renderStateKey,
				materialTableSlotStart,
				materialTableSlotCount:
					materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys,
				drawUnitIds,
			};
		});
}

function compareFirstDrawUnitId(
	left: readonly string[],
	right: readonly string[],
): number {
	return (left[0] ?? "").localeCompare(right[0] ?? "");
}

function describeDrawSliceVisibilityPartition(
	drawUnitIds: readonly string[],
): string {
	return drawUnitIds.length === 1
		? drawUnitIds[0]
		: `${drawUnitIds[0] ?? "empty"}..${drawUnitIds[drawUnitIds.length - 1] ?? "empty"}`;
}

function describeCompactionFamilyPlanKey(options: {
	policy: CompactionFamilyPlanningPolicy;
	atlasEntryKeys: readonly string[];
	detailAtlasEntryKeys: readonly string[];
	materialSlotKeys: readonly string[];
	indexedMaterialTableRecordKeys: readonly string[];
}): string {
	return [
		"compaction-families",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		`slots=${options.policy.maxMaterialSlotsPerDraw}`,
		...options.atlasEntryKeys,
		...options.detailAtlasEntryKeys.map((key) => `detail=${key}`),
		...options.materialSlotKeys,
		...options.indexedMaterialTableRecordKeys.map((key) => `indexed=${key}`),
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
