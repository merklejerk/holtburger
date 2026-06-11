import type { TexturePackingJob, TexturePackingResult } from "./protocol";
import { planAtlasLayout } from "./atlas-layout";

export interface TexturePacker {
	pack(job: TexturePackingJob): Promise<TexturePackingResult>;
	dispose?(): void;
}

export class AtlasTexturePacker implements TexturePacker {
	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		return packRgbaTexturesWithAtlasLayout(job);
	}
}

export class ShelfTexturePacker extends AtlasTexturePacker {}

function packRgbaTexturesWithAtlasLayout(
	job: TexturePackingJob,
): TexturePackingResult {
	for (const entry of job.sources) {
		const { source } = entry;
		if (source.outputFormat !== job.page.format) {
			throw new Error(
				`Texture packing job ${job.jobId} expected ${job.page.format} sources, got ${source.outputFormat}.`,
			);
		}
	}

	const layout = planAtlasLayout({
		cohorts: (job.cohorts ?? []).map((cohort) => ({
			entryKeys: cohort.textureUseIds,
			key: cohort.key,
		})),
		entries: job.sources.map((entry) => ({
			height: entry.source.height,
			key: entry.textureUseId,
			width: entry.source.width,
		})),
		policy: {
			gutterPixels: job.page.gutterPixels ?? 0,
			maxTextureCount: job.page.maxTextureCount ?? Number.MAX_SAFE_INTEGER,
			maxTextureSize: Math.max(job.page.width, job.page.height),
			pageSelection: job.page.pageSelection,
		},
	});
	if (layout.overflows.length > 0) {
		const overflow = layout.overflows[0];
		throw new Error(
			`Texture packing job ${job.jobId} could not place ${overflow?.atlasEntryKey ?? "a texture"}: ${overflow?.detail ?? "atlas capacity was exceeded"}.`,
		);
	}

	const sourceByTextureUseId = new Map(
		job.sources.map((entry) => [entry.textureUseId, entry.source] as const),
	);
	const pages = layout.texturePages.map((layoutPage) => {
		const pagePixels = createBlankPage(
			layoutPage.width,
			layoutPage.height,
			job.page.fillRgba,
		);
		for (const placement of layoutPage.placements) {
			const source = sourceByTextureUseId.get(placement.atlasEntryKey);
			if (!source) {
				throw new Error(
					`Texture packing job ${job.jobId} layout referenced unknown source ${placement.atlasEntryKey}.`,
				);
			}
			blitRgbaWithGutter({
				destination: pagePixels,
				destinationWidth: layoutPage.width,
				edgeMode: job.page.gutterEdgeMode ?? "clamp",
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
			textureUseId: placement.atlasEntryKey,
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

function createBlankPage(
	width: number,
	height: number,
	fillRgba?: readonly [number, number, number, number],
): Uint8Array {
	const pixels = new Uint8Array(width * height * 4);
	if (!fillRgba) {
		return pixels;
	}

	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = fillRgba[0];
		pixels[offset + 1] = fillRgba[1];
		pixels[offset + 2] = fillRgba[2];
		pixels[offset + 3] = fillRgba[3];
	}

	return pixels;
}

function createPageId(jobId: string, pageIndex: number): string {
	return `${jobId}:page:${pageIndex}`;
}

function blitRgbaWithGutter(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly edgeMode: "clamp" | "repeat";
	readonly source: Uint8Array;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly x: number;
	readonly y: number;
	readonly gutterPixels: number;
}): void {
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
			const sourceOffset = (sourceY * options.sourceWidth + sourceX) * 4;
			const destinationOffset =
				(destinationY * options.destinationWidth + options.x + column) * 4;
			options.destination.set(
				options.source.subarray(sourceOffset, sourceOffset + 4),
				destinationOffset,
			);
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
