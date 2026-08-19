import {
	packedObjectTexturePreparation,
	texturePixelFormatByteLength,
	texturePurposePolicy,
	type AssetTextureKey,
	type PackedObjectTexturePurpose,
} from "../types";
import { FRONTEND_TUNING } from "../../../frontend-tuning";
import {
	allocationBoundsForPlacement,
	type AtlasPageId,
	type AtlasPageLayout,
	type AtlasPlacement,
} from "./layout";

/** Closed pixel payload copied from one retained source before a page-build worker transfer. */
interface AtlasPageBuildSource {
	readonly key: AssetTextureKey;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

/** Closed input for materializing one complete fixed-size atlas page. */
export interface AtlasPageBuildJob {
	readonly page: AtlasPageLayout;
	readonly pageSize: number;
	/** Sources must cover every page placement exactly once. */
	readonly sources: readonly AtlasPageBuildSource[];
}

/** Complete replacement pixels for one physical page. */
export interface AtlasPageBuildResult {
	readonly pageId: AtlasPageId;
	readonly purpose: PackedObjectTexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly pageBits: Uint8Array;
	/** Bytes copied out of retained sources into this closed worker job. */
	readonly copiedSourceBytes: number;
}

/**
 * Closed input for compositing only the newly inserted placements of an already-published page.
 *
 * `page` is the complete planned layout so placement bounds can be validated against the page,
 * while `patchedKeys` and `sources` cover exactly the placements whose pixels must be written.
 */
export interface AtlasPagePatchJob {
	readonly page: AtlasPageLayout;
	readonly pageSize: number;
	readonly patchedKeys: readonly AssetTextureKey[];
	/** Sources must cover every patched key exactly once. */
	readonly sources: readonly AtlasPageBuildSource[];
}

/**
 * One page-local rectangle of replacement pixels, including its placement's gutter.
 *
 * Field names match `Texture2DRegionUpload` so a region uploads without being re-shaped.
 */
interface AtlasPagePatchRegion {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

/** Partial page pixels sufficient to bring a published page up to its planned layout. */
export interface AtlasPagePatchResult {
	readonly pageId: AtlasPageId;
	readonly purpose: PackedObjectTexturePurpose;
	readonly regions: readonly AtlasPagePatchRegion[];
	/** Bytes copied out of retained sources into this closed worker job. */
	readonly copiedSourceBytes: number;
}

/** Materialize one fixed page from closed source copies and stable planned placements. */
export function buildAtlasPage(job: AtlasPageBuildJob): AtlasPageBuildResult {
	validatePageSize(job.pageSize);
	const sources = indexSources(job.sources, job.page.purpose);
	// Sorted only so a page's composite order is reproducible; placements never overlap.
	const placements = [...job.page.placements].sort(compareTextureKeys);
	if (placements.length !== sources.size) {
		throw new Error(
			`Atlas page ${job.page.pageId} placements do not match its supplied sources.`,
		);
	}
	const bytes = bytesPerPixel(job.page.purpose);
	const pageBits = new Uint8Array(job.pageSize * job.pageSize * bytes);
	for (const placement of placements) {
		const source = resolveValidatedSource(
			job.page,
			placement,
			sources,
			job.pageSize,
		);
		blitSourceWithGutter({
			destination: pageBits,
			destinationWidth: job.pageSize,
			purpose: job.page.purpose,
			source,
			x: placement.contentBounds.x,
			y: placement.contentBounds.y,
		});
	}
	return {
		copiedSourceBytes: job.sources.reduce(
			(total, source) => total + source.pixels.byteLength,
			0,
		),
		height: job.pageSize,
		pageBits,
		pageId: job.page.pageId,
		purpose: job.page.purpose,
		width: job.pageSize,
	};
}

/**
 * Composite only the patched placements of one page into page-local regions.
 *
 * Each region spans its placement's allocation bounds — content plus gutter — which is exactly the
 * rectangle a full page build writes for that placement, so applying every region of a patch to a
 * published page reproduces the full-build page bit for bit.
 */
export function buildAtlasPagePatch(
	job: AtlasPagePatchJob,
): AtlasPagePatchResult {
	validatePageSize(job.pageSize);
	if (job.patchedKeys.length === 0) {
		throw new Error(`Atlas page ${job.page.pageId} patch has no patched keys.`);
	}
	const sources = indexSources(job.sources, job.page.purpose);
	if (sources.size !== job.patchedKeys.length) {
		throw new Error(
			`Atlas page ${job.page.pageId} patch sources do not match its patched keys.`,
		);
	}
	const placements = new Map(
		job.page.placements.map((placement) => [placement.key, placement]),
	);
	const bytes = bytesPerPixel(job.page.purpose);
	const regions = [...job.patchedKeys].sort(compareKeys).map((key) => {
		const placement = placements.get(key);
		if (!placement) {
			throw new Error(
				`Atlas page ${job.page.pageId} patch key ${key} is not a planned placement.`,
			);
		}
		const source = resolveValidatedSource(
			job.page,
			placement,
			sources,
			job.pageSize,
		);
		const bounds = allocationBoundsForPlacement(job.page.purpose, placement);
		const data = new Uint8Array(bounds.width * bounds.height * bytes);
		blitSourceWithGutter({
			destination: data,
			destinationWidth: bounds.width,
			purpose: job.page.purpose,
			source,
			// Content sits one gutter in from the region origin, which is the allocation corner.
			x: placement.contentBounds.x - bounds.x,
			y: placement.contentBounds.y - bounds.y,
		});
		return {
			data,
			height: bounds.height,
			width: bounds.width,
			x: bounds.x,
			y: bounds.y,
		};
	});
	return {
		copiedSourceBytes: job.sources.reduce(
			(total, source) => total + source.pixels.byteLength,
			0,
		),
		pageId: job.page.pageId,
		purpose: job.page.purpose,
		regions,
	};
}

/** Resolve one placement's source, proving it exists, matches its bounds, and fits the page. */
/** Order two placements by key, for reproducible composite order. */
function compareTextureKeys(
	left: AtlasPlacement,
	right: AtlasPlacement,
): number {
	return compareKeys(left.key, right.key);
}

function compareKeys(left: AssetTextureKey, right: AssetTextureKey): number {
	if (left < right) return -1;
	return left > right ? 1 : 0;
}

function resolveValidatedSource(
	page: AtlasPageLayout,
	placement: AtlasPlacement,
	sources: ReadonlyMap<AssetTextureKey, AtlasPageBuildSource>,
	pageSize: number,
): AtlasPageBuildSource {
	const source = sources.get(placement.key);
	if (!source) {
		throw new Error(`Atlas page ${page.pageId} lacks source ${placement.key}.`);
	}
	if (
		source.width !== placement.contentBounds.width ||
		source.height !== placement.contentBounds.height
	) {
		throw new Error(
			`Atlas page ${page.pageId} source ${placement.key} dimensions conflict with its placement.`,
		);
	}
	validatePlacementFitsPage(page, placement, pageSize);
	return source;
}

function validatePlacementFitsPage(
	page: AtlasPageLayout,
	placement: AtlasPlacement,
	pageSize: number,
): void {
	const bounds = allocationBoundsForPlacement(page.purpose, placement);
	if (
		bounds.x < 0 ||
		bounds.y < 0 ||
		bounds.x + bounds.width > pageSize ||
		bounds.y + bounds.height > pageSize
	) {
		throw new Error(
			`Atlas page ${page.pageId} placement for ${placement.key} exceeds its fixed bounds.`,
		);
	}
}

function indexSources(
	sources: readonly AtlasPageBuildSource[],
	purpose: PackedObjectTexturePurpose,
): ReadonlyMap<AssetTextureKey, AtlasPageBuildSource> {
	const indexed = new Map<AssetTextureKey, AtlasPageBuildSource>();
	for (const source of sources) {
		if (indexed.has(source.key)) {
			throw new Error(`Atlas page received duplicate source ${source.key}.`);
		}
		if (
			!Number.isInteger(source.width) ||
			!Number.isInteger(source.height) ||
			source.width <= 0 ||
			source.height <= 0
		) {
			throw new Error(`Atlas source ${source.key} has invalid dimensions.`);
		}
		const expectedBytes = source.width * source.height * bytesPerPixel(purpose);
		if (source.pixels.byteLength !== expectedBytes) {
			throw new Error(
				`Atlas source ${source.key} expected ${expectedBytes} bytes, got ${source.pixels.byteLength}.`,
			);
		}
		indexed.set(source.key, source);
	}
	return indexed;
}

/**
 * Write one source plus its wrapped gutter ring into a destination rectangle.
 *
 * `x`/`y` are the content origin in destination coordinates, so the same routine serves a full page
 * build (destination is the page) and a patch region (destination is one allocation rect). Both
 * callers validate the placement against the page first, which is the only way the write can leave
 * its destination, so this performs no bounds test of its own.
 */
function blitSourceWithGutter(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly purpose: PackedObjectTexturePurpose;
	readonly source: AtlasPageBuildSource;
	readonly x: number;
	readonly y: number;
}): void {
	const gutterPixels = packedObjectTexturePreparation(
		options.purpose,
	).gutterPixels;
	const bytes = bytesPerPixel(options.purpose);
	for (
		let row = -gutterPixels;
		row < options.source.height + gutterPixels;
		row += 1
	) {
		const sourceY = modulo(row, options.source.height);
		for (
			let column = -gutterPixels;
			column < options.source.width + gutterPixels;
			column += 1
		) {
			const sourceX = modulo(column, options.source.width);
			const sourceOffset = (sourceY * options.source.width + sourceX) * bytes;
			const destinationOffset =
				((options.y + row) * options.destinationWidth + options.x + column) *
				bytes;
			options.destination.set(
				options.source.pixels.subarray(sourceOffset, sourceOffset + bytes),
				destinationOffset,
			);
		}
	}
}

function bytesPerPixel(purpose: PackedObjectTexturePurpose): number {
	return texturePixelFormatByteLength(texturePurposePolicy(purpose).format);
}

function modulo(value: number, size: number): number {
	return ((value % size) + size) % size;
}

function validatePageSize(pageSize: number): void {
	if (!Number.isInteger(pageSize) || pageSize <= 0) {
		throw new Error("Atlas page size must be a positive integer.");
	}
	if (pageSize > FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize) {
		throw new Error(
			`Atlas page size ${pageSize} exceeds the fixed ${FRONTEND_TUNING.workloads.staticObjectTextureAtlas.pageSize}px policy.`,
		);
	}
}
