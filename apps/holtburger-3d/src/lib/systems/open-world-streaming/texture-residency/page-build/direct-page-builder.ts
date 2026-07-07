import type {
	OpenWorldTexturePageBuildFormat,
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
	OpenWorldTexturePageBuildPixelSource,
} from "./protocol";
import type { OpenWorldTexturePageBuilder } from "./worker-client";

/** Main-thread page materializer used until Phase 22 moves page builds behind workers. */
export class DirectOpenWorldTexturePageBuilder implements OpenWorldTexturePageBuilder {
	async buildPage(
		input: OpenWorldTexturePageBuildInput,
	): Promise<OpenWorldTexturePageBuildOutput> {
		if (input.entries.length === 0) {
			return {
				bucketKey: input.bucketKey,
				jobId: input.jobId,
				kind: "noop",
				pageId: input.pageId,
				reason: "page build request had no entries",
				reservationToken: input.reservationToken,
			};
		}

		const pixels = createBlankPagePixels({
			format: input.page.format,
			height: input.page.height,
			width: input.page.width,
		});
		for (const entry of input.entries) {
			assertSourceMatchesPageFormat(input.jobId, entry.entryId, {
				pageFormat: input.page.format,
				source: entry.source,
			});
			assertRectMatchesSource(input.jobId, entry.entryId, {
				rect: entry.rect,
				source: entry.source,
			});
			blitTexturePageBuildSourceWithGutter({
				destination: pixels,
				destinationWidth: input.page.width,
				edgeMode: entry.gutterEdgeMode,
				format: input.page.format,
				gutterPixels: entry.gutterPixels,
				source: entry.source.pixels,
				sourceHeight: entry.source.height,
				sourceWidth: entry.source.width,
				x: entry.rect[0],
				y: entry.rect[1],
			});
		}

		return {
			bucketKey: input.bucketKey,
			jobId: input.jobId,
			kind: "page-update",
			page: {
				...input.page,
				pixels,
				textureRefId: `${input.pageId}:texture`,
			},
			pageId: input.pageId,
			placements: input.entries.flatMap((entry) =>
				entry.bindingIds.map((bindingId) => ({
					bindingId,
					rect: entry.rect,
				})),
			),
			reservationToken: input.reservationToken,
		};
	}
}

function createBlankPagePixels(options: {
	readonly width: number;
	readonly height: number;
	readonly format: OpenWorldTexturePageBuildFormat;
}): Uint8Array {
	return new Uint8Array(
		options.width *
			options.height *
			getTexturePageBuildFormatBytesPerPixel(options.format),
	);
}

function blitTexturePageBuildSourceWithGutter(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly edgeMode: "clamp" | "repeat";
	readonly format: OpenWorldTexturePageBuildFormat;
	readonly source: Uint8Array;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly x: number;
	readonly y: number;
	readonly gutterPixels: number;
}): void {
	const bytesPerPixel = getTexturePageBuildFormatBytesPerPixel(options.format);
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

function assertSourceMatchesPageFormat(
	jobId: string,
	entryId: string,
	options: {
		readonly pageFormat: OpenWorldTexturePageBuildFormat;
		readonly source: OpenWorldTexturePageBuildPixelSource;
	},
): void {
	if (options.source.format !== options.pageFormat) {
		throw new Error(
			`Texture page build ${jobId} expected ${options.pageFormat} source ${entryId}, got ${options.source.format}.`,
		);
	}
	const expectedLength =
		options.source.width *
		options.source.height *
		getTexturePageBuildFormatBytesPerPixel(options.source.format);
	if (options.source.pixels.byteLength !== expectedLength) {
		throw new Error(
			`Texture page build ${jobId} source ${entryId} expected ${expectedLength} bytes for ${options.source.format}, got ${options.source.pixels.byteLength}.`,
		);
	}
}

function assertRectMatchesSource(
	jobId: string,
	entryId: string,
	options: {
		readonly rect: readonly [number, number, number, number];
		readonly source: OpenWorldTexturePageBuildPixelSource;
	},
): void {
	if (
		options.rect[2] !== options.source.width ||
		options.rect[3] !== options.source.height
	) {
		throw new Error(
			`Texture page build ${jobId} rect for ${entryId} is ${options.rect[2]}x${options.rect[3]}, but source is ${options.source.width}x${options.source.height}.`,
		);
	}
}

function getTexturePageBuildFormatBytesPerPixel(
	format: OpenWorldTexturePageBuildFormat,
): number {
	switch (format) {
		case "rgba8":
			return 4;
		case "r8":
			return 1;
		case "rg8":
			return 2;
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
