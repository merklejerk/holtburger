import { planAtlasLayout, type AtlasTexturePage } from "./atlas-layout-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";

export type AtlasBackedCompactionBypassReason =
	| "non-static"
	| "missing-landblock-origin"
	| "non-direct-texture"
	| "missing-uv-buffer"
	| "missing-atlas-eligibility"
	| "non-opaque-material"
	| "detail-overlay"
	| "missing-detail-atlas-entry"
	| "source-texture-too-large"
	| "atlas-full"
	| "detail-atlas-full"
	| "material-table-overflow";

export interface AtlasBackedCompactionPolicy {
	maxAtlasTextureSize: number;
	maxAtlasTextureCount: number;
	baseGutterPixels: number;
	maxMaterialSlotsPerDraw: number;
}

export interface AtlasBackedCompactionCandidate {
	id: string;
	kind: string;
	owningLandblockId: number | null;
	sceneDomain: Webgl2SceneDomain | null;
	materialKind: string;
	materialKey: string;
	materialBehavior: LegacyMaterialBehaviorDto | null;
	hasUvBuffer: boolean;
	hasDetailOverlay: boolean;
	detailAtlasEntry: AtlasBackedCompactionDetailEntry | null;
	atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
	triangleCount: number;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

export interface AtlasBackedCompactionBypass {
	drawUnitId: string;
	reason: AtlasBackedCompactionBypassReason;
	detail: string;
}

export interface AtlasBackedCompactionMaterialSlot {
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

export interface AtlasBackedCompactionDrawSlice {
	key: string;
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	drawUnitIds: readonly string[];
}

export interface AtlasBackedCompactionEntry {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export interface AtlasBackedCompactionDetailEntry {
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

export interface AtlasBackedCompactionPlan {
	key: string;
	compactableDrawUnitIds: readonly string[];
	bypasses: readonly AtlasBackedCompactionBypass[];
	atlasEntryRecords: readonly AtlasBackedCompactionEntry[];
	atlasEntries: readonly StagedWorldMaterialAtlasEligibility["atlasEntry"][];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly AtlasBackedCompactionDetailEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	materialSlots: readonly AtlasBackedCompactionMaterialSlot[];
	drawUnitMaterialSlots: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly AtlasBackedCompactionDrawSlice[];
	staticObjectKeys: readonly string[];
	staticPartCount: number;
	triangleCount: number;
	preparedTextureAssetIds: readonly string[];
}

interface EligibleAtlasBackedCompactionCandidate {
	drawUnit: AtlasBackedCompactionCandidate;
	eligibility: StagedWorldMaterialAtlasEligibility;
}

interface AtlasBackedCompactionEntryRecord {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export function createEmptyAtlasBackedCompactionPlan(): AtlasBackedCompactionPlan {
	return {
		key: "atlas-backed-compaction/empty",
		compactableDrawUnitIds: [],
		bypasses: [],
		atlasEntryRecords: [],
		atlasEntries: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		materialSlots: [],
		drawUnitMaterialSlots: [],
		drawSlices: [],
		staticObjectKeys: [],
		staticPartCount: 0,
		triangleCount: 0,
		preparedTextureAssetIds: [],
	};
}

export function planAtlasBackedCompaction(options: {
	drawUnits: readonly AtlasBackedCompactionCandidate[];
	policy: AtlasBackedCompactionPolicy;
}): AtlasBackedCompactionPlan {
	const eligible: EligibleAtlasBackedCompactionCandidate[] = [];
	const bypasses: AtlasBackedCompactionBypass[] = [];
	for (const drawUnit of options.drawUnits) {
		const bypass = classifyAtlasBackedCompactionBypass(drawUnit);
		if (bypass) {
			bypasses.push(bypass);
			continue;
		}
		if (!drawUnit.atlasEligibility) {
			throw new Error(
				`Atlas compaction candidate ${drawUnit.id} was accepted without atlas eligibility.`,
			);
		}
		eligible.push({ drawUnit, eligibility: drawUnit.atlasEligibility });
	}

	const atlasEntries = dedupeAtlasBackedCompactionEntries(eligible);
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
	const placed = eligible.filter((candidate) =>
		layout.placementsByEntryKey.has(candidate.eligibility.atlasEntryKey),
	);
	for (const candidate of eligible) {
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

	const detailEntries = dedupeAtlasBackedCompactionDetailEntries(placed);
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

	const materialSlots = assignAtlasBackedCompactionMaterialSlots(
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
	const drawSlices = createAtlasBackedCompactionDrawSlices(
		compactable,
		materialSlotByKey,
		layout.placementsByEntryKey,
		detailLayout.placementsByEntryKey,
	);
	const compactableDrawUnitIds = compactable.map(
		(candidate) => candidate.drawUnit.id,
	);
	const compactableEntryKeys = new Set(
		compactable.map((candidate) => candidate.eligibility.atlasEntryKey),
	);
	return {
		key: describeAtlasBackedCompactionPlanKey({
			policy: options.policy,
			atlasEntryKeys: [...compactableEntryKeys].sort(),
			detailAtlasEntryKeys: detailEntries
				.filter((entry) =>
					compactable.some(
						(candidate) =>
							candidate.drawUnit.detailAtlasEntry?.key === entry.key,
					),
				)
				.map((entry) => entry.key),
			materialSlotKeys: materialSlots.map((slot) => slot.key),
		}),
		compactableDrawUnitIds,
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
			compactable.some(
				(candidate) => candidate.drawUnit.detailAtlasEntry?.key === entry.key,
			),
		),
		detailAtlasTextures: detailLayout.texturePages
			.map((page) => ({
				...page,
				placements: page.placements.filter((placement) =>
					compactable.some(
						(candidate) =>
							candidate.drawUnit.detailAtlasEntry?.key ===
							placement.atlasEntryKey,
					),
				),
			}))
			.filter((page) => page.placements.length > 0),
		materialSlots,
		drawUnitMaterialSlots: compactable.map((candidate) => ({
			drawUnitId: candidate.drawUnit.id,
			materialSlotKey: describeCompactionMaterialSlotKey(candidate),
		})),
		drawSlices,
		staticObjectKeys: uniqueSortedStrings(
			compactable.flatMap((candidate) => candidate.drawUnit.staticObjectKeys),
		),
		staticPartCount: compactable.reduce(
			(total, candidate) => total + candidate.drawUnit.staticPartCount,
			0,
		),
		triangleCount: compactable.reduce(
			(total, candidate) => total + candidate.drawUnit.triangleCount,
			0,
		),
		preparedTextureAssetIds: uniqueSortedStrings(
			compactable.map(
				(candidate) => candidate.eligibility.atlasEntry.preparedTextureAssetId,
			),
		),
	};
}

function classifyAtlasBackedCompactionBypass(
	drawUnit: AtlasBackedCompactionCandidate,
): AtlasBackedCompactionBypass | null {
	if (drawUnit.kind !== "static") {
		if (drawUnit.kind !== "structured-interior") {
			return {
				drawUnitId: drawUnit.id,
				reason: "non-static",
				detail: `draw unit kind ${drawUnit.kind} is not baked geometry`,
			};
		}
	}
	if (drawUnit.owningLandblockId === null) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-landblock-origin",
			detail: "baked geometry draw unit has no owning landblock",
		};
	}
	if (drawUnit.materialKind !== "direct-texture") {
		return {
			drawUnitId: drawUnit.id,
			reason: "non-direct-texture",
			detail: `draw unit material kind ${drawUnit.materialKind} is not direct-texture`,
		};
	}
	if (!drawUnit.hasUvBuffer) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-uv-buffer",
			detail: "direct texture baked geometry draw unit has no UV buffer",
		};
	}
	if (!drawUnit.atlasEligibility) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-atlas-eligibility",
			detail:
				"direct texture baked geometry draw unit has no packed texture-page eligibility",
		};
	}
	if (drawUnit.hasDetailOverlay && !drawUnit.detailAtlasEntry) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-detail-atlas-entry",
			detail: "detail overlay has no compactable RGBA8 detail atlas entry",
		};
	}
	if (!isOpaqueStaticCompactionMaterial(drawUnit.materialBehavior)) {
		return {
			drawUnitId: drawUnit.id,
			reason: "non-opaque-material",
			detail: "non-opaque direct texture material stays on staged direct path",
		};
	}
	return null;
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

function dedupeAtlasBackedCompactionEntries(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
): AtlasBackedCompactionEntryRecord[] {
	const entriesByKey = new Map<string, AtlasBackedCompactionEntryRecord>();
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

function dedupeAtlasBackedCompactionDetailEntries(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
): AtlasBackedCompactionDetailEntry[] {
	const entriesByKey = new Map<string, AtlasBackedCompactionDetailEntry>();
	for (const candidate of candidates) {
		const detailEntry = candidate.drawUnit.detailAtlasEntry;
		if (detailEntry) {
			entriesByKey.set(detailEntry.key, detailEntry);
		}
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function assignAtlasBackedCompactionMaterialSlots(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
	policy: AtlasBackedCompactionPolicy,
): AtlasBackedCompactionMaterialSlot[] {
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
			...describeAtlasBackedCompactionDetailSlot(candidates, key),
		}));
}

function describeAtlasBackedCompactionDetailSlot(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
	materialSlotKey: string,
): Pick<
	AtlasBackedCompactionMaterialSlot,
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
					(entry): entry is AtlasBackedCompactionDetailEntry =>
						entry !== null && entry !== undefined,
				)
				.map((entry) => [entry.key, entry] as const),
		).values(),
	];
	if (detailEntries.length > 1) {
		throw new Error(
			`Atlas-backed compaction material slot ${materialSlotKey} has multiple detail atlas entries.`,
		);
	}
	const detailEntry = detailEntries[0] ?? null;
	return {
		detailAtlasEntryKey: detailEntry?.key ?? null,
		detailTiling: detailEntry?.tiling ?? 1,
	};
}

function describeCompactionMaterialSlotKey(
	candidate: EligibleAtlasBackedCompactionCandidate,
): string {
	return [
		candidate.eligibility.materialSlotKey,
		`wrap=${candidate.eligibility.samplingPolicy.wrapS}/${candidate.eligibility.samplingPolicy.wrapT}`,
		`detail=${candidate.drawUnit.detailAtlasEntry?.key ?? "none"}`,
	].join("|");
}

function createAtlasBackedCompactionDrawSlices(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
	materialSlotByKey: ReadonlyMap<string, AtlasBackedCompactionMaterialSlot>,
	placementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
	detailPlacementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
): AtlasBackedCompactionDrawSlice[] {
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
				left.renderStateKey.localeCompare(right.renderStateKey),
		)
		.map((group) => {
			const materialTableSlotStart = Math.min(...group.slotIndices);
			const materialTableSlotEnd = Math.max(...group.slotIndices);
			const materialSlotKeys = [...group.materialSlotKeys].sort();
			const drawUnitIds = [...group.drawUnitIds].sort();
			return {
				key: [
					"atlas-backed-compacted-draw-slice",
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
				drawUnitIds,
			};
		});
}

function describeAtlasBackedCompactionPlanKey(options: {
	policy: AtlasBackedCompactionPolicy;
	atlasEntryKeys: readonly string[];
	detailAtlasEntryKeys: readonly string[];
	materialSlotKeys: readonly string[];
}): string {
	return [
		"atlas-backed-compaction",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		`slots=${options.policy.maxMaterialSlotsPerDraw}`,
		...options.atlasEntryKeys,
		...options.detailAtlasEntryKeys.map((key) => `detail=${key}`),
		...options.materialSlotKeys,
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
