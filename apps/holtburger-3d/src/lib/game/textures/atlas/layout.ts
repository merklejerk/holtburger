import {
	STATIC_OBJECT_TEXTURE_PAGE_SIZE,
	type AssetTextureKey,
	type PackedObjectTexturePurpose,
	isPackedObjectTexturePurpose,
	packedObjectTexturePreparation,
} from "../types";
import type { TexturePageId } from "../texture-manager";

declare const atlasPageIdBrand: unique symbol;

/** Immutable runtime identity for one fixed-size physical atlas page generation. */
export type AtlasPageId = TexturePageId & {
	readonly [atlasPageIdBrand]: true;
};

/** Top-left-origin pixel rectangle. Max bounds are exclusive. */
export interface AtlasBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Immutable metadata required to allocate one logical texture in a fixed page. */
export interface AtlasLayoutEntry {
	readonly key: AssetTextureKey;
	readonly purpose: PackedObjectTexturePurpose;
	readonly width: number;
	readonly height: number;
}

/** Committed source-local content bounds for one logical texture. */
export interface AtlasPlacement {
	readonly key: AssetTextureKey;
	readonly contentBounds: AtlasBounds;
}

/** One fixed-size, purpose-isolated page snapshot. */
export interface AtlasPageLayout {
	readonly pageId: AtlasPageId;
	readonly purpose: PackedObjectTexturePurpose;
	readonly placements: readonly AtlasPlacement[];
}

/** Closed, metadata-only request for a stable placement mutation. */
export interface StableAtlasLayoutRequest {
	/** Opaque caller token preserved verbatim by the worker result. */
	readonly correlationId: string;
	readonly purpose: PackedObjectTexturePurpose;
	readonly pages: readonly AtlasPageLayout[];
	/** Complete desired live set after this retain/release mutation. */
	readonly entries: readonly AtlasLayoutEntry[];
	/** First unused generation number reserved by the caller for newly allocated pages. */
	readonly nextPageGeneration: number;
}

/** Deterministic metadata result for a retain/release mutation without live-entry movement. */
export interface StableAtlasLayoutPlan {
	readonly correlationId: string;
	readonly purpose: PackedObjectTexturePurpose;
	readonly pageSize: number;
	readonly pages: readonly AtlasPageLayout[];
	readonly insertedKeys: readonly AssetTextureKey[];
	readonly releasedKeys: readonly AssetTextureKey[];
}

interface MutablePageLayout {
	readonly pageId: AtlasPageId;
	readonly purpose: PackedObjectTexturePurpose;
	readonly placements: AtlasPlacement[];
	freeRects: AtlasBounds[];
}

interface PlacementCandidate {
	readonly page: MutablePageLayout;
	readonly allocationBounds: AtlasBounds;
	readonly shortSideLeftover: number;
	readonly longSideLeftover: number;
	readonly remainingArea: number;
}

/** Build an immutable page identifier from a purpose-scoped reserved generation. */
export function createAtlasPageId(
	purpose: PackedObjectTexturePurpose,
	generation: number,
): AtlasPageId {
	if (!Number.isInteger(generation) || generation < 0) {
		throw new Error("Atlas page generation must be a non-negative integer.");
	}
	return `page:atlas:${purpose}:${generation}` as AtlasPageId;
}

/** Derive the non-reusable allocation rectangle from one committed content placement. */
export function allocationBoundsForPlacement(
	purpose: PackedObjectTexturePurpose,
	placement: AtlasPlacement,
): AtlasBounds {
	const gutterPixels = packedObjectTexturePreparation(purpose).gutterPixels;
	return {
		height: placement.contentBounds.height + gutterPixels * 2,
		width: placement.contentBounds.width + gutterPixels * 2,
		x: placement.contentBounds.x - gutterPixels,
		y: placement.contentBounds.y - gutterPixels,
	};
}

/** Reconstruct canonical free rectangles from a fixed page's locked content placements. */
export function reconstructFreeRectangles(
	page: AtlasPageLayout,
	pageSize = STATIC_OBJECT_TEXTURE_PAGE_SIZE,
): readonly AtlasBounds[] {
	validatePageSize(pageSize);
	validatePageLayout(page, pageSize);
	let freeRects: AtlasBounds[] = [
		{ height: pageSize, width: pageSize, x: 0, y: 0 },
	];
	for (const placement of sortPlacements(page.placements)) {
		freeRects = pruneContainedFreeRectangles(
			splitFreeRectangles(
				freeRects,
				allocationBoundsForPlacement(page.purpose, placement),
			),
		);
	}
	return freeRects;
}

/**
 * Plan stable insertion and release for one purpose. Existing live placements never move; released
 * allocation rectangles immediately re-enter the free-rectangle search space.
 */
export function planStableAtlasLayout(
	request: StableAtlasLayoutRequest,
	options: { readonly pageSize?: number } = {},
): StableAtlasLayoutPlan {
	const pageSize = options.pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE;
	validatePageSize(pageSize);
	validateRequest(request);
	const entriesByKey = indexEntries(request.entries, request.purpose, pageSize);
	const livePlacementKeys = new Set<AssetTextureKey>();
	const releasedKeys: AssetTextureKey[] = [];
	const pageIds = new Set<AtlasPageId>();
	const pages = request.pages
		.slice()
		.sort(comparePages)
		.map((page) => {
			validatePageLayout(page, pageSize);
			if (pageIds.has(page.pageId)) {
				throw new Error(`Atlas layout has duplicate page id ${page.pageId}.`);
			}
			pageIds.add(page.pageId);
			if (page.purpose !== request.purpose) {
				throw new Error(
					`Atlas layout request for ${request.purpose} contains page ${page.pageId} for ${page.purpose}.`,
				);
			}
			const retainedPlacements: AtlasPlacement[] = [];
			for (const placement of page.placements) {
				if (livePlacementKeys.has(placement.key)) {
					throw new Error(
						`Atlas layout key ${placement.key} appears on multiple pages.`,
					);
				}
				livePlacementKeys.add(placement.key);
				const entry = entriesByKey.get(placement.key);
				if (!entry) {
					releasedKeys.push(placement.key);
					continue;
				}
				if (
					placement.contentBounds.width !== entry.width ||
					placement.contentBounds.height !== entry.height
				) {
					throw new Error(
						`Atlas layout key ${placement.key} dimensions conflict with its committed placement.`,
					);
				}
				retainedPlacements.push(placement);
			}
			return createMutablePage(
				{ ...page, placements: retainedPlacements },
				pageSize,
			);
		})
		.filter((page) => page.placements.length > 0);

	const insertedKeys: AssetTextureKey[] = [];
	let nextPageGeneration = request.nextPageGeneration;
	for (const entry of sortEntries(request.entries)) {
		if (livePlacementKeys.has(entry.key)) continue;
		const candidate = findBestPlacement(entry, pages);
		const target =
			candidate?.page ??
			createMutablePage(
				{
					pageId: createAtlasPageId(request.purpose, nextPageGeneration),
					placements: [],
					purpose: request.purpose,
				},
				pageSize,
			);
		if (!candidate) {
			if (pageIds.has(target.pageId)) {
				throw new Error(
					`Atlas page generation ${nextPageGeneration} is already committed for ${request.purpose}.`,
				);
			}
			nextPageGeneration += 1;
			pageIds.add(target.pageId);
			pages.push(target);
		}
		const allocationBounds =
			candidate?.allocationBounds ??
			findBestPlacement(entry, [target])?.allocationBounds;
		if (!allocationBounds) {
			throw new Error(
				`Texture ${entry.key} including its ${packedObjectTexturePreparation(entry.purpose).gutterPixels}px gutter exceeds ${pageSize}px page capacity.`,
			);
		}
		const placement: AtlasPlacement = {
			contentBounds: contentBoundsFromAllocation(entry, allocationBounds),
			key: entry.key,
		};
		target.placements.push(placement);
		target.freeRects = pruneContainedFreeRectangles(
			splitFreeRectangles(target.freeRects, allocationBounds),
		);
		insertedKeys.push(entry.key);
	}

	return {
		correlationId: request.correlationId,
		insertedKeys: insertedKeys.sort(compareKeys),
		pageSize,
		pages: pages.map(freezePage).sort(comparePages),
		purpose: request.purpose,
		releasedKeys: releasedKeys.sort(compareKeys),
	};
}

function createMutablePage(
	page: AtlasPageLayout,
	pageSize: number,
): MutablePageLayout {
	const placements = sortPlacements(page.placements);
	const immutablePage = { ...page, placements };
	return {
		freeRects: [...reconstructFreeRectanglesUnchecked(immutablePage, pageSize)],
		pageId: page.pageId,
		placements,
		purpose: page.purpose,
	};
}

function reconstructFreeRectanglesUnchecked(
	page: AtlasPageLayout,
	pageSize: number,
): readonly AtlasBounds[] {
	let freeRects: AtlasBounds[] = [
		{ height: pageSize, width: pageSize, x: 0, y: 0 },
	];
	for (const placement of sortPlacements(page.placements)) {
		freeRects = pruneContainedFreeRectangles(
			splitFreeRectangles(
				freeRects,
				allocationBoundsForPlacement(page.purpose, placement),
			),
		);
	}
	return freeRects;
}

function findBestPlacement(
	entry: AtlasLayoutEntry,
	pages: readonly MutablePageLayout[],
): PlacementCandidate | null {
	const gutterPixels = packedObjectTexturePreparation(
		entry.purpose,
	).gutterPixels;
	const allocationWidth = entry.width + gutterPixels * 2;
	const allocationHeight = entry.height + gutterPixels * 2;
	let best: PlacementCandidate | null = null;
	for (const page of pages) {
		for (const freeRect of page.freeRects) {
			if (
				allocationWidth > freeRect.width ||
				allocationHeight > freeRect.height
			)
				continue;
			const widthLeftover = freeRect.width - allocationWidth;
			const heightLeftover = freeRect.height - allocationHeight;
			const candidate: PlacementCandidate = {
				allocationBounds: {
					height: allocationHeight,
					width: allocationWidth,
					x: freeRect.x,
					y: freeRect.y,
				},
				longSideLeftover: Math.max(widthLeftover, heightLeftover),
				page,
				remainingArea:
					freeRect.width * freeRect.height - allocationWidth * allocationHeight,
				shortSideLeftover: Math.min(widthLeftover, heightLeftover),
			};
			if (best === null || compareCandidates(candidate, best) < 0)
				best = candidate;
		}
	}
	return best;
}

function contentBoundsFromAllocation(
	entry: AtlasLayoutEntry,
	allocationBounds: AtlasBounds,
): AtlasBounds {
	const gutterPixels = packedObjectTexturePreparation(
		entry.purpose,
	).gutterPixels;
	return {
		height: entry.height,
		width: entry.width,
		x: allocationBounds.x + gutterPixels,
		y: allocationBounds.y + gutterPixels,
	};
}

function splitFreeRectangles(
	freeRects: readonly AtlasBounds[],
	placed: AtlasBounds,
): AtlasBounds[] {
	const next: AtlasBounds[] = [];
	for (const freeRect of freeRects) {
		if (!rectanglesIntersect(freeRect, placed)) {
			next.push(freeRect);
			continue;
		}
		const topHeight = placed.y - freeRect.y;
		const bottomY = placed.y + placed.height;
		const bottomHeight = freeRect.y + freeRect.height - bottomY;
		const leftWidth = placed.x - freeRect.x;
		const rightX = placed.x + placed.width;
		const rightWidth = freeRect.x + freeRect.width - rightX;
		if (topHeight > 0)
			next.push({
				height: topHeight,
				width: freeRect.width,
				x: freeRect.x,
				y: freeRect.y,
			});
		if (bottomHeight > 0)
			next.push({
				height: bottomHeight,
				width: freeRect.width,
				x: freeRect.x,
				y: bottomY,
			});
		if (leftWidth > 0)
			next.push({
				height: freeRect.height,
				width: leftWidth,
				x: freeRect.x,
				y: freeRect.y,
			});
		if (rightWidth > 0)
			next.push({
				height: freeRect.height,
				width: rightWidth,
				x: rightX,
				y: freeRect.y,
			});
	}
	return next.sort(compareBounds);
}

function pruneContainedFreeRectangles(
	freeRects: readonly AtlasBounds[],
): AtlasBounds[] {
	return freeRects
		.filter(
			(candidate, index) =>
				!freeRects.some(
					(other, otherIndex) =>
						otherIndex !== index && rectangleContains(other, candidate),
				),
		)
		.filter(
			(candidate, index, pruned) =>
				!pruned.some(
					(other, otherIndex) =>
						otherIndex !== index && rectangleContains(other, candidate),
				),
		)
		.sort(compareBounds);
}

function validateRequest(request: StableAtlasLayoutRequest): void {
	if (request.correlationId.length === 0)
		throw new Error("Atlas layout correlation id cannot be empty.");
	if (!isPackedObjectTexturePurpose(request.purpose)) {
		throw new Error(
			`Texture purpose ${request.purpose} is not supported by the resident object atlas.`,
		);
	}
	if (
		!Number.isInteger(request.nextPageGeneration) ||
		request.nextPageGeneration < 0
	) {
		throw new Error(
			"Atlas layout next page generation must be a non-negative integer.",
		);
	}
}

function indexEntries(
	entries: readonly AtlasLayoutEntry[],
	purpose: PackedObjectTexturePurpose,
	pageSize: number,
): ReadonlyMap<AssetTextureKey, AtlasLayoutEntry> {
	const entriesByKey = new Map<AssetTextureKey, AtlasLayoutEntry>();
	for (const entry of entries) {
		if (entry.purpose !== purpose) {
			throw new Error(
				`Atlas layout entry ${entry.key} has purpose ${entry.purpose}, expected ${purpose}.`,
			);
		}
		validateDimensions(entry.key, entry.width, entry.height);
		const gutterPixels = packedObjectTexturePreparation(
			entry.purpose,
		).gutterPixels;
		if (
			entry.width + gutterPixels * 2 > pageSize ||
			entry.height + gutterPixels * 2 > pageSize
		) {
			throw new Error(
				`Texture ${entry.key} including its ${gutterPixels}px gutter is ${entry.width + gutterPixels * 2}x${entry.height + gutterPixels * 2}, exceeding ${pageSize}px page capacity.`,
			);
		}
		if (entriesByKey.has(entry.key))
			throw new Error(`Atlas layout has duplicate key ${entry.key}.`);
		entriesByKey.set(entry.key, entry);
	}
	return entriesByKey;
}

function validatePageLayout(page: AtlasPageLayout, pageSize: number): void {
	if (page.pageId.length === 0)
		throw new Error("Atlas page id cannot be empty.");
	const placements = sortPlacements(page.placements);
	const keys = new Set<AssetTextureKey>();
	for (const placement of placements) {
		if (keys.has(placement.key))
			throw new Error(
				`Atlas page ${page.pageId} has duplicate key ${placement.key}.`,
			);
		keys.add(placement.key);
		validateDimensions(
			placement.key,
			placement.contentBounds.width,
			placement.contentBounds.height,
		);
		const allocation = allocationBoundsForPlacement(page.purpose, placement);
		if (
			allocation.x < 0 ||
			allocation.y < 0 ||
			allocation.x + allocation.width > pageSize ||
			allocation.y + allocation.height > pageSize
		) {
			throw new Error(
				`Atlas placement ${placement.key} exceeds fixed page ${page.pageId}.`,
			);
		}
		if (
			placements.some(
				(other) =>
					other !== placement &&
					rectanglesIntersect(
						allocation,
						allocationBoundsForPlacement(page.purpose, other),
					),
			)
		) {
			throw new Error(
				`Atlas placement ${placement.key} overlaps another placement on page ${page.pageId}.`,
			);
		}
	}
}

function validateDimensions(
	key: AssetTextureKey,
	width: number,
	height: number,
): void {
	if (
		!Number.isInteger(width) ||
		width <= 0 ||
		!Number.isInteger(height) ||
		height <= 0
	) {
		throw new Error(`Atlas layout key ${key} has invalid dimensions.`);
	}
}

function validatePageSize(pageSize: number): void {
	if (!Number.isInteger(pageSize) || pageSize <= 0) {
		throw new Error("Atlas layout page size must be a positive integer.");
	}
}

function freezePage(page: MutablePageLayout): AtlasPageLayout {
	return {
		pageId: page.pageId,
		placements: sortPlacements(page.placements),
		purpose: page.purpose,
	};
}

function sortEntries(entries: readonly AtlasLayoutEntry[]): AtlasLayoutEntry[] {
	return entries.slice().sort((left, right) => {
		const leftGutter = packedObjectTexturePreparation(
			left.purpose,
		).gutterPixels;
		const rightGutter = packedObjectTexturePreparation(
			right.purpose,
		).gutterPixels;
		const leftWidth = left.width + leftGutter * 2;
		const leftHeight = left.height + leftGutter * 2;
		const rightWidth = right.width + rightGutter * 2;
		const rightHeight = right.height + rightGutter * 2;
		return (
			rightWidth * rightHeight - leftWidth * leftHeight ||
			Math.max(rightWidth, rightHeight) - Math.max(leftWidth, leftHeight) ||
			Math.min(rightWidth, rightHeight) - Math.min(leftWidth, leftHeight) ||
			compareKeys(left.key, right.key)
		);
	});
}

function sortPlacements(
	placements: readonly AtlasPlacement[],
): AtlasPlacement[] {
	return placements
		.slice()
		.sort((left, right) => compareKeys(left.key, right.key));
}

function compareCandidates(
	left: PlacementCandidate,
	right: PlacementCandidate,
): number {
	return (
		left.shortSideLeftover - right.shortSideLeftover ||
		left.longSideLeftover - right.longSideLeftover ||
		left.remainingArea - right.remainingArea ||
		left.allocationBounds.y - right.allocationBounds.y ||
		left.allocationBounds.x - right.allocationBounds.x ||
		left.page.pageId.localeCompare(right.page.pageId)
	);
}

function comparePages(left: AtlasPageLayout, right: AtlasPageLayout): number {
	return left.pageId.localeCompare(right.pageId);
}

function compareBounds(left: AtlasBounds, right: AtlasBounds): number {
	return (
		left.y - right.y ||
		left.x - right.x ||
		left.height - right.height ||
		left.width - right.width
	);
}

function compareKeys(left: AssetTextureKey, right: AssetTextureKey): number {
	return left.localeCompare(right);
}

function rectanglesIntersect(left: AtlasBounds, right: AtlasBounds): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}

function rectangleContains(outer: AtlasBounds, inner: AtlasBounds): boolean {
	return (
		outer.x <= inner.x &&
		outer.y <= inner.y &&
		outer.x + outer.width >= inner.x + inner.width &&
		outer.y + outer.height >= inner.y + inner.height
	);
}
