import { planAtlasLayout } from "./atlas-layout-planner";

type IndexedResourceAtlasIndexFormat = "p8" | "index16";

export interface IndexedTexelAtlasCandidate {
	drawUnitId: string;
	indexTextureKey: string;
	format: IndexedResourceAtlasIndexFormat;
	width: number;
	height: number;
	sourceBytes: Uint8Array;
}

export interface IndexedPaletteAtlasCandidate {
	drawUnitId: string;
	paletteTextureKey: string;
	colorCount: number;
	rgbaBytes: Uint8Array;
}

type IndexedResourceAtlasFailureReason =
	| "duplicate-index-texture-mismatch"
	| "duplicate-palette-mismatch"
	| "source-texture-too-large"
	| "index-atlas-full"
	| "palette-atlas-full";

interface IndexedResourceAtlasFailure {
	drawUnitId: string;
	reason: IndexedResourceAtlasFailureReason;
	detail: string;
}

export interface IndexedTexelAtlasPlacement {
	indexTextureKey: string;
	format: IndexedResourceAtlasIndexFormat;
	atlasTextureIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
	sourceBytes: Uint8Array;
}

export interface IndexedPaletteAtlasPlacement {
	paletteTextureKey: string;
	atlasTextureIndex: number;
	x: number;
	y: number;
	colorCount: number;
	rgbaBytes: Uint8Array;
}

export interface IndexedTexelAtlasPage {
	format: IndexedResourceAtlasIndexFormat;
	textureIndex: number;
	width: number;
	height: number;
	placements: readonly IndexedTexelAtlasPlacement[];
}

export interface IndexedPaletteAtlasPage {
	textureIndex: number;
	width: number;
	height: number;
	placements: readonly IndexedPaletteAtlasPlacement[];
}

export interface IndexedResourceAtlasPlan {
	key: string;
	indexReadyDrawUnitIds: readonly string[];
	paletteReadyDrawUnitIds: readonly string[];
	failures: readonly IndexedResourceAtlasFailure[];
	p8IndexAtlasTextures: readonly IndexedTexelAtlasPage[];
	index16AtlasTextures: readonly IndexedTexelAtlasPage[];
	paletteAtlasTextures: readonly IndexedPaletteAtlasPage[];
	indexPlacementsByTextureKey: ReadonlyMap<string, IndexedTexelAtlasPlacement>;
	palettePlacementsByTextureKey: ReadonlyMap<
		string,
		IndexedPaletteAtlasPlacement
	>;
}

export function createEmptyIndexedResourceAtlasPlan(): IndexedResourceAtlasPlan {
	return {
		key: "indexed-resource-atlas/empty",
		indexReadyDrawUnitIds: [],
		paletteReadyDrawUnitIds: [],
		failures: [],
		p8IndexAtlasTextures: [],
		index16AtlasTextures: [],
		paletteAtlasTextures: [],
		indexPlacementsByTextureKey: new Map(),
		palettePlacementsByTextureKey: new Map(),
	};
}

export function planIndexedResourceAtlas(options: {
	indexCandidates: readonly IndexedTexelAtlasCandidate[];
	paletteCandidates: readonly IndexedPaletteAtlasCandidate[];
	policy: {
		maxTextureSize: number;
		maxTextureCount: number;
	};
}): IndexedResourceAtlasPlan {
	const failures: IndexedResourceAtlasFailure[] = [];
	const dedupedIndexCandidates = dedupeIndexCandidates(
		options.indexCandidates,
		failures,
	);
	const dedupedPaletteCandidates = dedupePaletteCandidates(
		options.paletteCandidates,
		failures,
	);
	const p8IndexAtlasTextures = planIndexFormatAtlasPages({
		format: "p8",
		candidates: dedupedIndexCandidates.filter(
			(candidate) => candidate.format === "p8",
		),
		policy: options.policy,
		failures,
	});
	const index16AtlasTextures = planIndexFormatAtlasPages({
		format: "index16",
		candidates: dedupedIndexCandidates.filter(
			(candidate) => candidate.format === "index16",
		),
		policy: options.policy,
		failures,
	});
	const paletteAtlasTextures = planPaletteAtlasPages({
		candidates: dedupedPaletteCandidates,
		policy: options.policy,
		failures,
	});
	const indexPlacementsByTextureKey = new Map(
		[...p8IndexAtlasTextures, ...index16AtlasTextures].flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.indexTextureKey, placement] as const,
			),
		),
	);
	const palettePlacementsByTextureKey = new Map(
		paletteAtlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.paletteTextureKey, placement] as const,
			),
		),
	);
	return {
		key: describeIndexedResourceAtlasPlanKey({
			policy: options.policy,
			p8IndexAtlasTextures,
			index16AtlasTextures,
			paletteAtlasTextures,
			failures,
		}),
		indexReadyDrawUnitIds: uniqueSortedStrings(
			options.indexCandidates
				.filter((candidate) =>
					indexPlacementsByTextureKey.has(candidate.indexTextureKey),
				)
				.map((candidate) => candidate.drawUnitId),
		),
		paletteReadyDrawUnitIds: uniqueSortedStrings(
			options.paletteCandidates
				.filter((candidate) =>
					palettePlacementsByTextureKey.has(candidate.paletteTextureKey),
				)
				.map((candidate) => candidate.drawUnitId),
		),
		failures,
		p8IndexAtlasTextures,
		index16AtlasTextures,
		paletteAtlasTextures,
		indexPlacementsByTextureKey,
		palettePlacementsByTextureKey,
	};
}

function dedupeIndexCandidates(
	candidates: readonly IndexedTexelAtlasCandidate[],
	failures: IndexedResourceAtlasFailure[],
): IndexedTexelAtlasCandidate[] {
	const byKey = new Map<string, IndexedTexelAtlasCandidate>();
	const mismatchedKeys = new Set<string>();
	for (const candidate of candidates) {
		const existing = byKey.get(candidate.indexTextureKey);
		if (!existing) {
			byKey.set(candidate.indexTextureKey, candidate);
			continue;
		}
		if (
			existing.format !== candidate.format ||
			existing.width !== candidate.width ||
			existing.height !== candidate.height ||
			!byteArraysEqual(existing.sourceBytes, candidate.sourceBytes)
		) {
			mismatchedKeys.add(candidate.indexTextureKey);
			failures.push({
				drawUnitId: candidate.drawUnitId,
				reason: "duplicate-index-texture-mismatch",
				detail: `indexed texture ${candidate.indexTextureKey} has conflicting source metadata`,
			});
		}
	}
	return [...byKey.values()].filter(
		(candidate) => !mismatchedKeys.has(candidate.indexTextureKey),
	);
}

function dedupePaletteCandidates(
	candidates: readonly IndexedPaletteAtlasCandidate[],
	failures: IndexedResourceAtlasFailure[],
): IndexedPaletteAtlasCandidate[] {
	const byKey = new Map<string, IndexedPaletteAtlasCandidate>();
	const mismatchedKeys = new Set<string>();
	for (const candidate of candidates) {
		const existing = byKey.get(candidate.paletteTextureKey);
		if (!existing) {
			byKey.set(candidate.paletteTextureKey, candidate);
			continue;
		}
		if (
			existing.colorCount !== candidate.colorCount ||
			!byteArraysEqual(existing.rgbaBytes, candidate.rgbaBytes)
		) {
			mismatchedKeys.add(candidate.paletteTextureKey);
			failures.push({
				drawUnitId: candidate.drawUnitId,
				reason: "duplicate-palette-mismatch",
				detail: `indexed palette ${candidate.paletteTextureKey} has conflicting source metadata`,
			});
		}
	}
	return [...byKey.values()].filter(
		(candidate) => !mismatchedKeys.has(candidate.paletteTextureKey),
	);
}

function planIndexFormatAtlasPages({
	format,
	candidates,
	policy,
	failures,
}: {
	format: IndexedResourceAtlasIndexFormat;
	candidates: readonly IndexedTexelAtlasCandidate[];
	policy: { maxTextureSize: number; maxTextureCount: number };
	failures: IndexedResourceAtlasFailure[];
}): IndexedTexelAtlasPage[] {
	const layout = planAtlasLayout({
		entries: candidates.map((candidate) => ({
			key: candidate.indexTextureKey,
			width: candidate.width,
			height: candidate.height,
			gutterPixels: 0,
		})),
		policy: {
			maxTextureSize: policy.maxTextureSize,
			maxTextureCount: policy.maxTextureCount,
			gutterPixels: 0,
		},
	});
	const candidateByKey = new Map(
		candidates.map((candidate) => [candidate.indexTextureKey, candidate]),
	);
	for (const candidate of candidates) {
		const overflow = layout.overflowsByEntryKey.get(candidate.indexTextureKey);
		if (!overflow) {
			continue;
		}
		failures.push({
			drawUnitId: candidate.drawUnitId,
			reason:
				overflow.reason === "source-too-large"
					? "source-texture-too-large"
					: "index-atlas-full",
			detail: `indexed texture ${candidate.indexTextureKey} ${candidate.width}x${candidate.height} could not be placed in ${format} atlas`,
		});
	}
	return layout.texturePages.map((texture) => ({
		format,
		textureIndex: texture.textureIndex,
		width: texture.width,
		height: texture.height,
		placements: texture.placements.map((placement) => {
			const candidate = candidateByKey.get(placement.atlasEntryKey);
			if (!candidate) {
				throw new Error(
					`Indexed atlas placement ${placement.atlasEntryKey} has no source candidate.`,
				);
			}
			return {
				indexTextureKey: placement.atlasEntryKey,
				format,
				atlasTextureIndex: placement.textureIndex,
				x: placement.x,
				y: placement.y,
				width: candidate.width,
				height: candidate.height,
				sourceBytes: candidate.sourceBytes,
			};
		}),
	}));
}

function planPaletteAtlasPages({
	candidates,
	policy,
	failures,
}: {
	candidates: readonly IndexedPaletteAtlasCandidate[];
	policy: { maxTextureSize: number; maxTextureCount: number };
	failures: IndexedResourceAtlasFailure[];
}): IndexedPaletteAtlasPage[] {
	const pages: IndexedPaletteAtlasPage[] = [];
	const placeableCandidates = [...candidates]
		.filter((candidate) => {
			if (candidate.colorCount <= policy.maxTextureSize) {
				return true;
			}
			failures.push({
				drawUnitId: candidate.drawUnitId,
				reason: "source-texture-too-large",
				detail: `indexed palette ${candidate.paletteTextureKey} width ${candidate.colorCount} exceeds max atlas size ${policy.maxTextureSize}`,
			});
			return false;
		})
		.sort((left, right) =>
			left.paletteTextureKey.localeCompare(right.paletteTextureKey),
		);
	for (const candidate of placeableCandidates) {
		const lastPage = pages[pages.length - 1] ?? null;
		if (!lastPage || lastPage.height >= policy.maxTextureSize) {
			if (pages.length >= policy.maxTextureCount) {
				failures.push({
					drawUnitId: candidate.drawUnitId,
					reason: "palette-atlas-full",
					detail: `indexed palette ${candidate.paletteTextureKey} could not be placed because palette atlas page count reached ${policy.maxTextureCount}`,
				});
				continue;
			}
			pages.push({
				textureIndex: pages.length,
				width: candidate.colorCount,
				height: 0,
				placements: [],
			});
		}
		const page = pages[pages.length - 1];
		if (!page) {
			throw new Error("Indexed palette atlas page allocation failed.");
		}
		const placement = {
			paletteTextureKey: candidate.paletteTextureKey,
			atlasTextureIndex: page.textureIndex,
			x: 0,
			y: page.height,
			colorCount: candidate.colorCount,
			rgbaBytes: candidate.rgbaBytes,
		};
		pages[page.textureIndex] = {
			...page,
			width: Math.max(page.width, candidate.colorCount),
			height: page.height + 1,
			placements: [...page.placements, placement],
		};
	}
	return pages;
}

function describeIndexedResourceAtlasPlanKey({
	policy,
	p8IndexAtlasTextures,
	index16AtlasTextures,
	paletteAtlasTextures,
	failures,
}: {
	policy: { maxTextureSize: number; maxTextureCount: number };
	p8IndexAtlasTextures: readonly IndexedTexelAtlasPage[];
	index16AtlasTextures: readonly IndexedTexelAtlasPage[];
	paletteAtlasTextures: readonly IndexedPaletteAtlasPage[];
	failures: readonly IndexedResourceAtlasFailure[];
}): string {
	return [
		"indexed-resource-atlas",
		`max=${policy.maxTextureSize}`,
		`pages=${policy.maxTextureCount}`,
		`p8=${describeTexelPages(p8IndexAtlasTextures)}`,
		`index16=${describeTexelPages(index16AtlasTextures)}`,
		`palettes=${describePalettePages(paletteAtlasTextures)}`,
		`failures=${failures.map((failure) => `${failure.drawUnitId}:${failure.reason}`).join(",")}`,
	].join("|");
}

function describeTexelPages(pages: readonly IndexedTexelAtlasPage[]): string {
	return pages
		.map(
			(page) =>
				`${page.textureIndex}:${page.width}x${page.height}:${page.placements
					.map((placement) => placement.indexTextureKey)
					.join(",")}`,
		)
		.join(";");
}

function describePalettePages(
	pages: readonly IndexedPaletteAtlasPage[],
): string {
	return pages
		.map(
			(page) =>
				`${page.textureIndex}:${page.width}x${page.height}:${page.placements
					.map((placement) => placement.paletteTextureKey)
					.join(",")}`,
		)
		.join(";");
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
