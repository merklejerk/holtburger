import type {
	TexturePackingJob,
	TexturePackingPageFormat,
	TexturePackingResult,
} from "./protocol";
import { planAtlasLayout } from "./atlas-layout";

export interface TexturePacker {
	pack(job: TexturePackingJob): Promise<TexturePackingResult>;
	dispose?(): void;
}

export class AtlasTexturePacker implements TexturePacker {
	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		return packTexturesWithAtlasLayout(job);
	}
}

export class ShelfTexturePacker extends AtlasTexturePacker {}

function packTexturesWithAtlasLayout(
	job: TexturePackingJob,
): TexturePackingResult {
	for (const entry of job.sources) {
		const { source } = entry;
		if (source.format !== job.page.format) {
			throw new Error(
				`Texture packing job ${job.jobId} expected ${job.page.format} sources, got ${source.format}.`,
			);
		}
		assertPixelLengthMatchesFormat(job.jobId, entry.entryKey, source);
	}

	const layout = planAtlasLayout({
		cohorts: (job.cohorts ?? []).map((cohort) => ({
			entryKeys: cohort.entryKeys,
			key: cohort.key,
		})),
		entries: job.sources.map((entry) => ({
			height: entry.source.height,
			key: entry.entryKey,
			width: entry.source.width,
		})),
		policy: {
			gutterPixels: job.page.gutterPixels ?? 0,
			maxTextureCount: job.page.maxTextureCount ?? Number.MAX_SAFE_INTEGER,
			maxTextureSize: Math.max(job.page.width, job.page.height),
			pageRunway: job.page.pageRunway,
			pageSelection: job.page.pageSelection,
		},
	});
	if (layout.overflows.length > 0) {
		const overflow = layout.overflows[0];
		throw new Error(
			`Texture packing job ${job.jobId} could not place ${overflow?.atlasEntryKey ?? "a texture"}: ${overflow?.detail ?? "atlas capacity was exceeded"}.`,
		);
	}

	const sourceByEntryKey = new Map(
		job.sources.map((entry) => [entry.entryKey, entry] as const),
	);
	const pages = layout.texturePages.map((layoutPage) => {
		const pagePixels = createBlankTexturePackingPage({
			fillRgba: job.page.fillRgba,
			format: job.page.format,
			height: layoutPage.height,
			width: layoutPage.width,
		});
		for (const placement of layoutPage.placements) {
			const entry = sourceByEntryKey.get(placement.atlasEntryKey);
			if (!entry) {
				throw new Error(
					`Texture packing job ${job.jobId} layout referenced unknown source ${placement.atlasEntryKey}.`,
				);
			}
			const { source } = entry;
			blitTexturePackingSourceWithGutter({
				destination: pagePixels,
				destinationWidth: layoutPage.width,
				edgeMode: entry.gutterEdgeMode ?? job.page.gutterEdgeMode ?? "clamp",
				format: job.page.format,
				gutterPixels: placement.gutterPixels,
				source: source.pixels,
				sourceHeight: source.height,
				sourceWidth: source.width,
				x: placement.x,
				y: placement.y,
			});
		}
		return {
			format: job.page.format,
			height: layoutPage.height,
			pageId: createPageId(job.jobId, layoutPage.textureIndex),
			pixels: pagePixels,
			width: layoutPage.width,
		};
	});
	const rects = layout.texturePages.flatMap((layoutPage) =>
		layoutPage.placements.map((placement) => ({
			pageId: createPageId(job.jobId, layoutPage.textureIndex),
			rect: [
				placement.x,
				placement.y,
				placement.width,
				placement.height,
			] as const,
			entryKey: placement.atlasEntryKey,
		})),
	);

	return {
		domain: job.domain,
		jobId: job.jobId,
		pages,
		placementRevision: job.placementRevision,
		rects,
	};
}

function createBlankTexturePackingPage(options: {
	readonly width: number;
	readonly height: number;
	readonly format: TexturePackingPageFormat;
	readonly fillRgba?: readonly [number, number, number, number];
}): Uint8Array {
	const bytesPerPixel = getTexturePackingFormatBytesPerPixel(options.format);
	const pixels = new Uint8Array(options.width * options.height * bytesPerPixel);
	if (options.fillRgba && options.format !== "rgba8") {
		throw new Error(
			`Texture packing page format ${options.format} cannot use RGBA fill pixels.`,
		);
	}
	if (!options.fillRgba) {
		return pixels;
	}

	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = options.fillRgba[0];
		pixels[offset + 1] = options.fillRgba[1];
		pixels[offset + 2] = options.fillRgba[2];
		pixels[offset + 3] = options.fillRgba[3];
	}

	return pixels;
}

function createPageId(jobId: string, pageIndex: number): string {
	return `${jobId}:page:${pageIndex}`;
}

function blitTexturePackingSourceWithGutter(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly edgeMode: "clamp" | "repeat";
	readonly format: TexturePackingPageFormat;
	readonly source: Uint8Array;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly x: number;
	readonly y: number;
	readonly gutterPixels: number;
}): void {
	const bytesPerPixel = getTexturePackingFormatBytesPerPixel(options.format);
	for (
		let row = -options.gutterPixels;
		row < options.sourceHeight + options.gutterPixels;
		row += 1
	) {
		const sourceY = resolveGutterSourceCoordinate(
			row,
			options.sourceHeight,
			options.edgeMode,
		);
		const destinationY = options.y + row;
		for (
			let column = -options.gutterPixels;
			column < options.sourceWidth + options.gutterPixels;
			column += 1
		) {
			const sourceX = resolveGutterSourceCoordinate(
				column,
				options.sourceWidth,
				options.edgeMode,
			);
			const sourceOffset =
				(sourceY * options.sourceWidth + sourceX) * bytesPerPixel;
			const destinationOffset =
				(destinationY * options.destinationWidth + options.x + column) *
				bytesPerPixel;
			options.destination.set(
				options.source.subarray(sourceOffset, sourceOffset + bytesPerPixel),
				destinationOffset,
			);
		}
	}
}

function assertPixelLengthMatchesFormat(
	jobId: string,
	entryKey: string,
	source: TexturePackingJob["sources"][number]["source"],
): void {
	const expectedLength =
		source.width *
		source.height *
		getTexturePackingFormatBytesPerPixel(source.format);
	if (source.pixels.byteLength !== expectedLength) {
		throw new Error(
			`Texture packing job ${jobId} source ${entryKey} expected ${expectedLength} bytes for ${source.format}, got ${source.pixels.byteLength}.`,
		);
	}
}

function getTexturePackingFormatBytesPerPixel(
	format: TexturePackingPageFormat,
): number {
	switch (format) {
		case "rgba8":
			return 4;
		case "r8":
			return 1;
		case "rg8":
			return 2;
		default: {
			const exhaustive: never = format;
			throw new Error(`Unsupported texture packing page format ${exhaustive}.`);
		}
	}
}

function resolveGutterSourceCoordinate(
	value: number,
	size: number,
	edgeMode: "clamp" | "repeat",
): number {
	if (edgeMode === "repeat") {
		return ((value % size) + size) % size;
	}

	return clamp(value, 0, size - 1);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
