import {
	planAtlasLayout,
	type AtlasTexturePage,
	type AtlasTexturePlacement,
} from "./atlas-layout-planner";
import type {
	CompactionFamilyBypass,
	CompactionFamilyPlanningPolicy,
	RgbaTexturePageAtlasEntryRecord,
	RgbaTexturePageDetailAtlasEntry,
} from "./compaction-family-planner";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";

export interface TexturePageAtlasRgbaCandidate {
	drawUnitId: string;
	atlasEligibility: StagedWorldMaterialAtlasEligibility;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface TexturePageAtlasDetailCandidate {
	drawUnitId: string;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface TexturePageAtlasPlan {
	key: string;
	rgbaAtlasReadyDrawUnitIds: readonly string[];
	detailAtlasReadyDrawUnitIds: readonly string[];
	bypasses: readonly CompactionFamilyBypass[];
	atlasEntryRecords: readonly RgbaTexturePageAtlasEntryRecord[];
	atlasEntries: readonly StagedWorldMaterialAtlasEligibility["atlasEntry"][];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly RgbaTexturePageDetailAtlasEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	preparedTextureAssetIds: readonly string[];
}

export function createEmptyTexturePageAtlasPlan(): TexturePageAtlasPlan {
	return {
		key: "texture-page-atlas/empty",
		rgbaAtlasReadyDrawUnitIds: [],
		detailAtlasReadyDrawUnitIds: [],
		bypasses: [],
		atlasEntryRecords: [],
		atlasEntries: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		preparedTextureAssetIds: [],
	};
}

export function createTexturePageAtlasPlacementsByEntryKey(
	plan: TexturePageAtlasPlan,
): ReadonlyMap<string, AtlasTexturePlacement> {
	return new Map(
		plan.atlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.atlasEntryKey, placement] as const,
			),
		),
	);
}

export function createTexturePageDetailAtlasPlacementsByEntryKey(
	plan: TexturePageAtlasPlan,
): ReadonlyMap<string, AtlasTexturePlacement> {
	return new Map(
		plan.detailAtlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.atlasEntryKey, placement] as const,
			),
		),
	);
}

export function planTexturePageAtlas(options: {
	rgbaCandidates: readonly TexturePageAtlasRgbaCandidate[];
	detailCandidates: readonly TexturePageAtlasDetailCandidate[];
	policy: CompactionFamilyPlanningPolicy;
}): TexturePageAtlasPlan {
	const bypasses: CompactionFamilyBypass[] = [];
	const atlasEntries = dedupeRgbaTexturePageEntries(options.rgbaCandidates);
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
	const basePlaced = options.rgbaCandidates.filter((candidate) =>
		layout.placementsByEntryKey.has(candidate.atlasEligibility.atlasEntryKey),
	);
	for (const candidate of options.rgbaCandidates) {
		const overflow = layout.overflowsByEntryKey.get(
			candidate.atlasEligibility.atlasEntryKey,
		);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnitId,
			reason:
				overflow.reason === "source-too-large"
					? "source-texture-too-large"
					: "atlas-full",
			blockerKind: "atlas",
			blocker:
				overflow.reason === "source-too-large"
					? "source-texture-too-large"
					: "atlas-full",
			detail: overflow.detail,
		});
	}

	const detailEntries = dedupeDetailAtlasEntries([
		...basePlaced,
		...options.detailCandidates,
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
	const rgbaReady = basePlaced.filter((candidate) =>
		isDetailAtlasReady(candidate, detailLayout.placementsByEntryKey),
	);
	const detailReady = options.detailCandidates.filter((candidate) =>
		isDetailAtlasReady(candidate, detailLayout.placementsByEntryKey),
	);
	for (const candidate of [...basePlaced, ...options.detailCandidates]) {
		const detailEntryKey = candidate.detailAtlasEntry?.key ?? null;
		if (detailEntryKey === null) {
			continue;
		}
		const overflow = detailLayout.overflowsByEntryKey.get(detailEntryKey);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnitId,
			reason: "detail-atlas-full",
			blockerKind: "atlas",
			blocker: "detail-atlas-full",
			detail: overflow.detail,
		});
	}

	const usedAtlasEntryKeys = new Set(
		rgbaReady.map((candidate) => candidate.atlasEligibility.atlasEntryKey),
	);
	const usedDetailEntryKeys = new Set(
		[...rgbaReady, ...detailReady]
			.map((candidate) => candidate.detailAtlasEntry?.key ?? "")
			.filter((key) => key.length > 0),
	);
	return {
		key: describeTexturePageAtlasPlanKey({
			policy: options.policy,
			atlasEntryKeys: [...usedAtlasEntryKeys].sort(),
			detailAtlasEntryKeys: detailEntries
				.filter((entry) => usedDetailEntryKeys.has(entry.key))
				.map((entry) => entry.key),
		}),
		rgbaAtlasReadyDrawUnitIds: rgbaReady.map((candidate) => candidate.drawUnitId),
		detailAtlasReadyDrawUnitIds: detailReady.map(
			(candidate) => candidate.drawUnitId,
		),
		bypasses,
		atlasEntryRecords: atlasEntries.filter((record) =>
			usedAtlasEntryKeys.has(record.key),
		),
		atlasEntries: atlasEntries
			.filter((record) => usedAtlasEntryKeys.has(record.key))
			.map((record) => record.entry),
		atlasTextures: filterAtlasTexturePages({
			pages: layout.texturePages,
			usedEntryKeys: usedAtlasEntryKeys,
		}),
		detailAtlasEntryRecords: detailEntries.filter((entry) =>
			usedDetailEntryKeys.has(entry.key),
		),
		detailAtlasTextures: filterAtlasTexturePages({
			pages: detailLayout.texturePages,
			usedEntryKeys: usedDetailEntryKeys,
		}),
		preparedTextureAssetIds: uniqueSortedStrings(
			rgbaReady.map(
				(candidate) =>
					candidate.atlasEligibility.atlasEntry.preparedTextureAssetId,
			),
		),
	};
}

function isDetailAtlasReady(
	candidate: TexturePageAtlasDetailCandidate,
	placementsByEntryKey: ReadonlyMap<string, unknown>,
): boolean {
	const detailEntryKey = candidate.detailAtlasEntry?.key ?? null;
	return detailEntryKey === null || placementsByEntryKey.has(detailEntryKey);
}

function dedupeRgbaTexturePageEntries(
	candidates: readonly TexturePageAtlasRgbaCandidate[],
): RgbaTexturePageAtlasEntryRecord[] {
	const entriesByKey = new Map<string, RgbaTexturePageAtlasEntryRecord>();
	for (const candidate of candidates) {
		entriesByKey.set(candidate.atlasEligibility.atlasEntryKey, {
			key: candidate.atlasEligibility.atlasEntryKey,
			entry: candidate.atlasEligibility.atlasEntry,
		});
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function dedupeDetailAtlasEntries(
	candidates: readonly TexturePageAtlasDetailCandidate[],
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

function filterAtlasTexturePages({
	pages,
	usedEntryKeys,
}: {
	pages: readonly AtlasTexturePage[];
	usedEntryKeys: ReadonlySet<string>;
}): AtlasTexturePage[] {
	return pages
		.map((page) => ({
			...page,
			placements: page.placements.filter((placement) =>
				usedEntryKeys.has(placement.atlasEntryKey),
			),
		}))
		.filter((page) => page.placements.length > 0);
}

function describeTexturePageAtlasPlanKey(options: {
	policy: CompactionFamilyPlanningPolicy;
	atlasEntryKeys: readonly string[];
	detailAtlasEntryKeys: readonly string[];
}): string {
	return [
		"texture-page-atlas",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		...options.atlasEntryKeys,
		...options.detailAtlasEntryKeys.map((key) => `detail=${key}`),
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
