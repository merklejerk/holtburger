import {
	STATIC_OBJECT_TEXTURE_PAGE_SIZE,
	packedObjectTexturePreparation,
	texturePurposePolicy,
	type AssetTextureKey,
	type PackedObjectTexturePurpose,
} from "../types";
import type { AtlasPageId, AtlasPageLayout } from "./layout";

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

/** Materialize one fixed page from closed source copies and stable planned placements. */
export function buildAtlasPage(job: AtlasPageBuildJob): AtlasPageBuildResult {
	validatePageSize(job.pageSize);
	const sources = indexSources(job.sources, job.page.purpose);
	const placements = [...job.page.placements].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
	if (placements.length !== sources.size) {
		throw new Error(
			`Atlas page ${job.page.pageId} placements do not match its supplied sources.`,
		);
	}
	const bytes = bytesPerPixel(job.page.purpose);
	const pageBits = new Uint8Array(job.pageSize * job.pageSize * bytes);
	for (const placement of placements) {
		const source = sources.get(placement.key);
		if (!source) {
			throw new Error(
				`Atlas page ${job.page.pageId} lacks source ${placement.key}.`,
			);
		}
		if (
			source.width !== placement.contentBounds.width ||
			source.height !== placement.contentBounds.height
		) {
			throw new Error(
				`Atlas page ${job.page.pageId} source ${placement.key} dimensions conflict with its placement.`,
			);
		}
		blitSourceWithGutter({
			destination: pageBits,
			destinationWidth: job.pageSize,
			pageId: job.page.pageId,
			pageSize: job.pageSize,
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

function blitSourceWithGutter(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly pageId: AtlasPageId;
	readonly pageSize: number;
	readonly purpose: PackedObjectTexturePurpose;
	readonly source: AtlasPageBuildSource;
	readonly x: number;
	readonly y: number;
}): void {
	const gutterPixels = packedObjectTexturePreparation(
		options.purpose,
	).gutterPixels;
	const bytes = bytesPerPixel(options.purpose);
	const minX = options.x - gutterPixels;
	const minY = options.y - gutterPixels;
	const maxX = options.x + options.source.width + gutterPixels;
	const maxY = options.y + options.source.height + gutterPixels;
	if (
		minX < 0 ||
		minY < 0 ||
		maxX > options.pageSize ||
		maxY > options.pageSize
	) {
		throw new Error(
			`Atlas page ${options.pageId} placement for ${options.source.key} exceeds its fixed bounds.`,
		);
	}
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
	switch (texturePurposePolicy(purpose).format) {
		case "rgba8":
			return 4;
		case "r8":
		case "a8":
			return 1;
		case "rg8":
			return 2;
		default:
			throw new Error(
				`Atlas purpose ${purpose} has an unsupported pixel format.`,
			);
	}
}

function modulo(value: number, size: number): number {
	return ((value % size) + size) % size;
}

function validatePageSize(pageSize: number): void {
	if (!Number.isInteger(pageSize) || pageSize <= 0) {
		throw new Error("Atlas page size must be a positive integer.");
	}
	if (pageSize > STATIC_OBJECT_TEXTURE_PAGE_SIZE) {
		throw new Error(
			`Atlas page size ${pageSize} exceeds the fixed ${STATIC_OBJECT_TEXTURE_PAGE_SIZE}px policy.`,
		);
	}
}
