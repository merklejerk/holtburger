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
	| "source-texture-too-large"
	| "atlas-full"
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
	index: number;
	renderStateKey: string;
	samplingKey: string;
	atlasEntryKey: string;
}

export interface AtlasBackedCompactionDrawSlice {
	key: string;
	atlasTextureIndex: number;
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

export interface AtlasBackedCompactionPlan {
	key: string;
	compactableDrawUnitIds: readonly string[];
	bypasses: readonly AtlasBackedCompactionBypass[];
	atlasEntryRecords: readonly AtlasBackedCompactionEntry[];
	atlasEntries: readonly StagedWorldMaterialAtlasEligibility["atlasEntry"][];
	atlasTextures: readonly AtlasTexturePage[];
	materialSlots: readonly AtlasBackedCompactionMaterialSlot[];
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
		materialSlots: [],
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

	const materialSlots = assignAtlasBackedCompactionMaterialSlots(
		placed,
		options.policy,
	);
	const materialSlotByKey = new Map(
		materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const compactable = placed.filter((candidate) => {
		if (materialSlotByKey.has(candidate.eligibility.materialSlotKey)) {
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
		materialSlots,
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
				detail: `draw unit kind ${drawUnit.kind} is not compacted atlas geometry`,
			};
		}
	}
	if (drawUnit.owningLandblockId === null) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-landblock-origin",
			detail: "atlas-backed compacted geometry draw unit has no owning landblock",
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
			detail: "direct texture atlas-backed compacted geometry draw unit has no UV buffer",
		};
	}
	if (!drawUnit.atlasEligibility) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-atlas-eligibility",
			detail: "direct texture atlas-backed compacted geometry draw unit has no atlas eligibility",
		};
	}
	if (drawUnit.hasDetailOverlay) {
		return {
			drawUnitId: drawUnit.id,
			reason: "detail-overlay",
			detail:
				"detail overlay stays on staged direct path for the first atlas compaction slice",
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

function assignAtlasBackedCompactionMaterialSlots(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
	policy: AtlasBackedCompactionPolicy,
): AtlasBackedCompactionMaterialSlot[] {
	return [
		...new Map(
			candidates.map(
				(candidate) =>
					[
						candidate.eligibility.materialSlotKey,
						candidate.eligibility,
					] as const,
			),
		).entries(),
	]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, policy.maxMaterialSlotsPerDraw)
		.map(([key, eligibility], index) => ({
			key,
			index,
			renderStateKey: eligibility.renderStateKey,
			samplingKey: eligibility.samplingKey,
			atlasEntryKey: eligibility.atlasEntryKey,
		}));
}

function createAtlasBackedCompactionDrawSlices(
	candidates: readonly EligibleAtlasBackedCompactionCandidate[],
	materialSlotByKey: ReadonlyMap<string, AtlasBackedCompactionMaterialSlot>,
	placementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
): AtlasBackedCompactionDrawSlice[] {
	const groups = new Map<
		string,
		{
			atlasTextureIndex: number;
			renderStateKey: string;
			slotIndices: number[];
			materialSlotKeys: Set<string>;
			drawUnitIds: string[];
		}
	>();
	for (const candidate of candidates) {
		const slot = materialSlotByKey.get(candidate.eligibility.materialSlotKey);
		if (!slot) {
			continue;
		}
		const atlasTextureIndex =
			placementsByEntryKey.get(candidate.eligibility.atlasEntryKey)
				?.textureIndex ?? 0;
		const key = [atlasTextureIndex, slot.renderStateKey].join("|");
		const group = groups.get(key) ?? {
			atlasTextureIndex,
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
					group.renderStateKey,
					`table=${materialTableSlotStart}-${materialTableSlotEnd}`,
				].join("|"),
				atlasTextureIndex: group.atlasTextureIndex,
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
	materialSlotKeys: readonly string[];
}): string {
	return [
		"atlas-backed-compaction",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		`slots=${options.policy.maxMaterialSlotsPerDraw}`,
		...options.atlasEntryKeys,
		...options.materialSlotKeys,
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
