import type {
	TexturePackingJob,
	TexturePackingPagePixels,
	TexturePackingRect,
	TexturePackingResult,
} from "./protocol";

export interface TexturePacker {
	pack(job: TexturePackingJob): Promise<TexturePackingResult>;
}

export class ShelfTexturePacker implements TexturePacker {
	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		return packDirectRgbaTextures(job);
	}
}

function packDirectRgbaTextures(job: TexturePackingJob): TexturePackingResult {
		const pages: TexturePackingPagePixels[] = [];
		const rects: TexturePackingRect[] = [];
	let pageIndex = 0;
	let pagePixels = createBlankPage(job.page.width, job.page.height);
	let cursorX = 0;
	let cursorY = 0;
	let rowHeight = 0;
	let pageId = createPageId(job.jobId, pageIndex);

	for (const entry of job.sources) {
		const { source } = entry;
		if (source.outputFormat !== job.page.format) {
			throw new Error(
				`Texture packing job ${job.jobId} expected ${job.page.format} sources, got ${source.outputFormat}.`,
			);
		}
		if (source.width > job.page.width || source.height > job.page.height) {
			throw new Error(
				`Texture ${entry.textureUseId} ${source.width}x${source.height} does not fit ${job.page.width}x${job.page.height} atlas pages.`,
			);
		}

		if (cursorX + source.width > job.page.width) {
			cursorX = 0;
			cursorY += rowHeight;
			rowHeight = 0;
		}

		if (cursorY + source.height > job.page.height) {
			pages.push({
				format: job.page.format,
				height: job.page.height,
				pageId,
				pixels: pagePixels,
				width: job.page.width,
			});
			pageIndex += 1;
			pageId = createPageId(job.jobId, pageIndex);
			pagePixels = createBlankPage(job.page.width, job.page.height);
			cursorX = 0;
			cursorY = 0;
			rowHeight = 0;
		}

		blitRgba({
			destination: pagePixels,
			destinationWidth: job.page.width,
			source: source.pixels,
			sourceHeight: source.height,
			sourceWidth: source.width,
			x: cursorX,
			y: cursorY,
		});
		rects.push({
			pageId,
			rect: [cursorX, cursorY, source.width, source.height] as const,
			textureUseId: entry.textureUseId,
		});
		cursorX += source.width;
		rowHeight = Math.max(rowHeight, source.height);
	}

	if (job.sources.length > 0) {
		pages.push({
			format: job.page.format,
			height: job.page.height,
			pageId,
			pixels: pagePixels,
			width: job.page.width,
		});
	}

	return {
		domain: job.domain,
		jobId: job.jobId,
		pages,
		placementRevision: job.placementRevision,
		rects,
	};
}

function createBlankPage(width: number, height: number): Uint8Array {
	return new Uint8Array(width * height * 4);
}

function createPageId(jobId: string, pageIndex: number): string {
	return `${jobId}:page:${pageIndex}`;
}

function blitRgba(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly source: Uint8Array;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly x: number;
	readonly y: number;
}): void {
	for (let row = 0; row < options.sourceHeight; row += 1) {
		const sourceOffset = row * options.sourceWidth * 4;
		const destinationOffset =
			((options.y + row) * options.destinationWidth + options.x) * 4;
		options.destination.set(
			options.source.subarray(
				sourceOffset,
				sourceOffset + options.sourceWidth * 4,
			),
			destinationOffset,
		);
	}
}
