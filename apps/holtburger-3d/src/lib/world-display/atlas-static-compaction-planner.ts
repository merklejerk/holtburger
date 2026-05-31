import { planAtlasLayout, type AtlasTexturePage } from "./atlas-layout-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";

export type AtlasStaticCompactionBypassReason =
	| "non-static"
	| "non-exterior-domain"
	| "non-direct-texture"
	| "missing-uv-buffer"
	| "missing-atlas-eligibility"
	| "non-opaque-material"
	| "detail-overlay"
	| "source-texture-too-large"
	| "atlas-full"
	| "material-table-overflow";

export interface AtlasStaticCompactionPolicy {
	maxAtlasTextureSize: number;
	maxAtlasTextureCount: number;
	baseGutterPixels: number;
	maxMaterialSlotsPerDraw: number;
}

export interface AtlasStaticCompactionCandidate {
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

export interface AtlasStaticCompactionBypass {
	drawUnitId: string;
	reason: AtlasStaticCompactionBypassReason;
	detail: string;
}

export interface AtlasStaticCompactionMaterialSlot {
	key: string;
	index: number;
	renderStateKey: string;
	samplingKey: string;
	atlasEntryKey: string;
}

export interface AtlasStaticCompactionDrawSlice {
	key: string;
	atlasTextureIndex: number;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	drawUnitIds: readonly string[];
}

export interface AtlasStaticCompactionEntry {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export interface AtlasStaticCompactionPlan {
	key: string;
	compactableDrawUnitIds: readonly string[];
	bypasses: readonly AtlasStaticCompactionBypass[];
	atlasEntryRecords: readonly AtlasStaticCompactionEntry[];
	atlasEntries: readonly StagedWorldMaterialAtlasEligibility["atlasEntry"][];
	atlasTextures: readonly AtlasTexturePage[];
	materialSlots: readonly AtlasStaticCompactionMaterialSlot[];
	drawSlices: readonly AtlasStaticCompactionDrawSlice[];
	staticObjectKeys: readonly string[];
	staticPartCount: number;
	triangleCount: number;
	preparedTextureAssetIds: readonly string[];
}

interface EligibleAtlasStaticCandidate {
	drawUnit: AtlasStaticCompactionCandidate;
	eligibility: StagedWorldMaterialAtlasEligibility;
}

interface AtlasStaticCompactionEntryRecord {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export function createEmptyAtlasStaticCompactionPlan(): AtlasStaticCompactionPlan {
	return {
		key: "atlas-static-compaction/empty",
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

export function planAtlasStaticCompaction(options: {
	drawUnits: readonly AtlasStaticCompactionCandidate[];
	policy: AtlasStaticCompactionPolicy;
}): AtlasStaticCompactionPlan {
	const eligible: EligibleAtlasStaticCandidate[] = [];
	const bypasses: AtlasStaticCompactionBypass[] = [];
	for (const drawUnit of options.drawUnits) {
		const bypass = classifyAtlasStaticCompactionBypass(drawUnit);
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

	const atlasEntries = dedupeAtlasStaticCompactionEntries(eligible);
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

	const materialSlots = assignAtlasStaticCompactionMaterialSlots(
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
	const drawSlices = createAtlasStaticCompactionDrawSlices(
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
		key: describeAtlasStaticCompactionPlanKey({
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

function classifyAtlasStaticCompactionBypass(
	drawUnit: AtlasStaticCompactionCandidate,
): AtlasStaticCompactionBypass | null {
	if (drawUnit.kind !== "static") {
		return {
			drawUnitId: drawUnit.id,
			reason: "non-static",
			detail: `draw unit kind ${drawUnit.kind} is not static`,
		};
	}
	if (drawUnit.sceneDomain !== "exterior") {
		return {
			drawUnitId: drawUnit.id,
			reason: "non-exterior-domain",
			detail: `draw unit scene domain ${drawUnit.sceneDomain ?? "none"} is not exterior`,
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
			detail: "direct texture static draw unit has no UV buffer",
		};
	}
	if (!drawUnit.atlasEligibility) {
		return {
			drawUnitId: drawUnit.id,
			reason: "missing-atlas-eligibility",
			detail: "direct texture static draw unit has no atlas eligibility",
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

function dedupeAtlasStaticCompactionEntries(
	candidates: readonly EligibleAtlasStaticCandidate[],
): AtlasStaticCompactionEntryRecord[] {
	const entriesByKey = new Map<string, AtlasStaticCompactionEntryRecord>();
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

function assignAtlasStaticCompactionMaterialSlots(
	candidates: readonly EligibleAtlasStaticCandidate[],
	policy: AtlasStaticCompactionPolicy,
): AtlasStaticCompactionMaterialSlot[] {
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

function createAtlasStaticCompactionDrawSlices(
	candidates: readonly EligibleAtlasStaticCandidate[],
	materialSlotByKey: ReadonlyMap<string, AtlasStaticCompactionMaterialSlot>,
	placementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
): AtlasStaticCompactionDrawSlice[] {
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
					"atlas-static-draw-slice",
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

function describeAtlasStaticCompactionPlanKey(options: {
	policy: AtlasStaticCompactionPolicy;
	atlasEntryKeys: readonly string[];
	materialSlotKeys: readonly string[];
}): string {
	return [
		"atlas-static-compaction",
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
