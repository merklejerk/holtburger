import type { PreparedAssetReader } from "../../../../assets/contracts";
import type { TexturePackingPixelSource } from "../../../../textures/packing/protocol";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import { prepareMaterialTexturePackingSource } from "../material-texture-source";
import type {
	OpenWorldTexturePageBuildFormat,
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
} from "./protocol";
import type { OpenWorldTexturePageBuilder } from "./worker-client";

/** Direct page materializer used by tests and by the page-build worker implementation. */
export class DirectOpenWorldTexturePageBuilder implements OpenWorldTexturePageBuilder {
	readonly #assetReader: PreparedAssetReader;

	constructor(options: { readonly assetReader: PreparedAssetReader }) {
		this.#assetReader = options.assetReader;
	}

	async buildPage(
		input: OpenWorldTexturePageBuildInput,
	): Promise<OpenWorldTexturePageBuildOutput> {
		const timing = new TexturePageBuildStageTimer();
		if (input.entries.length === 0) {
			return {
				bucketKey: input.bucketKey,
				jobId: input.jobId,
				kind: "noop",
				pageId: input.pageId,
				reason: "page build request had no entries",
				reservationToken: input.reservationToken,
				stageTimings: timing.createSnapshot(),
			};
		}

		const preparedEntries = await timing.measure(
			"texture-page-source-preparation",
			() =>
				Promise.all(
					input.entries.map(async (entry) => ({
						entry,
						source: await prepareMaterialTexturePackingSource({
							assetReader: this.#assetReader,
							dataUse: entry.dataUse,
						}),
					})),
				),
			input.entries.length,
		);
		const pixels = timing.measureSync(
			"texture-page-materialization",
			() => {
				const pagePixels = createBlankPagePixels({
					format: input.page.format,
					height: input.page.height,
					width: input.page.width,
				});
				for (const { entry, source } of preparedEntries) {
					assertSourceMatchesPageFormat(input.jobId, entry.entryId, {
						pageFormat: input.page.format,
						source,
					});
					assertRectMatchesSource(input.jobId, entry.entryId, {
						rect: entry.rect,
						source,
					});
					blitTexturePageBuildSourceWithGutter({
						destination: pagePixels,
						destinationWidth: input.page.width,
						edgeMode: entry.gutterEdgeMode,
						format: input.page.format,
						gutterPixels: entry.gutterPixels,
						source: source.pixels,
						sourceHeight: source.height,
						sourceWidth: source.width,
						x: entry.rect[0],
						y: entry.rect[1],
					});
				}
				return pagePixels;
			},
			input.entries.length,
		);

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
			stageTimings: timing.createSnapshot(),
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
		readonly source: TexturePackingPixelSource;
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
		readonly source: TexturePackingPixelSource;
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

class TexturePageBuildStageTimer {
	readonly #timings: OpenWorldStreamingStaticTaskStageTiming[] = [];

	async measure<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => Promise<T>,
		itemCount?: number,
	): Promise<T> {
		const startedAtMs = nowMs();
		try {
			return await createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				...(itemCount === undefined ? {} : { itemCount }),
				stage,
			});
		}
	}

	measureSync<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => T,
		itemCount?: number,
	): T {
		const startedAtMs = nowMs();
		try {
			return createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				...(itemCount === undefined ? {} : { itemCount }),
				stage,
			});
		}
	}

	createSnapshot(): readonly OpenWorldStreamingStaticTaskStageTiming[] {
		return this.#timings;
	}
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}
