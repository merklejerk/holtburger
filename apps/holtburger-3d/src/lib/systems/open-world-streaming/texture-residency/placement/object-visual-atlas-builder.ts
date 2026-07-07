import type { PreparedAssetReader } from "../../../../assets/contracts";
import {
	createPreparedPaletteTextureHostKey,
	createPreparedTextureHostKey,
	prepareDirectMaterialTextureSource,
	type DirectMaterialTextureSource,
} from "../../../../assets/preparation/prepared-texture-source";
import type {
	MaterialTextureDataUseIdentity,
	VisualTextureDomain,
} from "../../../../static/contracts";
import type { TexturePacker } from "../../../../textures/packing/packer";
import type {
	TexturePackingJob,
	TexturePackingPageFormat,
	TexturePackingPixelSource,
	TexturePackingResult,
} from "../../../../textures/packing/protocol";
import type { TexturePackingResultWithDiagnostics } from "../../../../textures/packing/worker-client";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import type { OpenWorldTextureEntryId } from "../claims/texture-claim-registry";

const TEXTURE_SOURCE_PREPARATION_BATCH_SIZE = 8;

export interface OpenWorldObjectVisualAtlasBuildInput {
	/** Caller-owned job id used for diagnostics, not lifecycle currentness. */
	readonly jobId: string;
	/** Renderer texture domain that owns the object atlas bucket. */
	readonly domain: VisualTextureDomain;
	/** Physical page constraints used by the atlas packer. */
	readonly page: OpenWorldObjectVisualAtlasBuildPage;
	/** Shared texture entries to prepare and pack. */
	readonly entries: readonly OpenWorldObjectVisualAtlasBuildEntry[];
}

export interface OpenWorldObjectVisualAtlasBuildPage {
	/** Physical page pixel format. */
	readonly format: TexturePackingPageFormat;
	/** Gutter edge behavior for page materialization. */
	readonly gutterEdgeMode: TexturePackingJob["page"]["gutterEdgeMode"];
	/** Gutter width in pixels. */
	readonly gutterPixels: number;
	/** Runtime page height in pixels. */
	readonly height: number;
	/** Atlas runway policy for oversized or multi-page jobs. */
	readonly pageRunway: TexturePackingJob["page"]["pageRunway"];
	/** Atlas page selection policy. */
	readonly pageSelection: TexturePackingJob["page"]["pageSelection"];
	/** Runtime page width in pixels. */
	readonly width: number;
}

export interface OpenWorldObjectVisualAtlasBuildEntry {
	/** Shared logical texture entry being packed. */
	readonly entryId: OpenWorldTextureEntryId;
	/** Source identity used to request prepared pixels inside the builder. */
	readonly dataUse: MaterialTextureDataUseIdentity;
	/** Gutter edge behavior for this source. */
	readonly gutterEdgeMode: TexturePackingJob["sources"][number]["gutterEdgeMode"];
}

export interface OpenWorldObjectVisualAtlasBuildOutput {
	/** Packed page pixels ready for replacement page settlement. */
	readonly pages: TexturePackingResult["pages"];
	/** Packed rects keyed by replacement entry id. */
	readonly rects: TexturePackingResult["rects"];
	/** Worker- or direct-builder-local stage timings. */
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

export interface OpenWorldObjectVisualAtlasBuilder {
	buildAtlas(
		input: OpenWorldObjectVisualAtlasBuildInput,
	): Promise<OpenWorldObjectVisualAtlasBuildOutput>;
	dispose?(): void;
}

export class DirectOpenWorldObjectVisualAtlasBuilder implements OpenWorldObjectVisualAtlasBuilder {
	readonly #assetReader: PreparedAssetReader;
	readonly #texturePacker: TexturePacker;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly texturePacker: TexturePacker;
	}) {
		this.#assetReader = options.assetReader;
		this.#texturePacker = options.texturePacker;
	}

	async buildAtlas(
		input: OpenWorldObjectVisualAtlasBuildInput,
	): Promise<OpenWorldObjectVisualAtlasBuildOutput> {
		return buildObjectVisualAtlas({
			assetReader: this.#assetReader,
			input,
			texturePacker: this.#texturePacker,
		});
	}
}

export async function buildObjectVisualAtlas(options: {
	readonly assetReader: PreparedAssetReader;
	readonly input: OpenWorldObjectVisualAtlasBuildInput;
	readonly texturePacker: TexturePacker;
}): Promise<OpenWorldObjectVisualAtlasBuildOutput> {
	const timings: OpenWorldStreamingStaticTaskStageTiming[] = [];
	const sources = await measureStage(
		timings,
		"texture-source-preparation",
		() => prepareTexturePackingSources({
			assetReader: options.assetReader,
			entries: options.input.entries,
			timings,
		}),
		options.input.entries.length,
	);
	const packed = await measureStage(
		timings,
		"texture-packing",
		() =>
			packTexturesWithBoundaryDiagnostics(options.texturePacker, {
				domain: options.input.domain,
				jobId: options.input.jobId,
				page: options.input.page,
				placementRevision: 0,
				sources: sources.map(({ entry, source }) => ({
					entryKey: entry.entryId,
					gutterEdgeMode: entry.gutterEdgeMode,
					source,
				})),
			}),
		sources.length,
	);
	if (packed.diagnostics && packed.diagnostics.deliveryMs !== null) {
		timings.push({
			durationMs: packed.diagnostics.deliveryMs,
			itemCount: packed.diagnostics.pageCount,
			stage: "texture-packing-result-transfer",
		});
	}
	return {
		pages: packed.result.pages,
		rects: packed.result.rects,
		stageTimings: timings,
	};
}

async function prepareTexturePackingSources(options: {
	readonly assetReader: PreparedAssetReader;
	readonly entries: readonly OpenWorldObjectVisualAtlasBuildEntry[];
	readonly timings: OpenWorldStreamingStaticTaskStageTiming[];
}): Promise<
	readonly {
		readonly entry: OpenWorldObjectVisualAtlasBuildEntry;
		readonly source: TexturePackingPixelSource;
	}[]
> {
	const results: Array<{
		readonly entry: OpenWorldObjectVisualAtlasBuildEntry;
		readonly source: TexturePackingPixelSource;
	}> = [];
	for (
		let batchStart = 0;
		batchStart < options.entries.length;
		batchStart += TEXTURE_SOURCE_PREPARATION_BATCH_SIZE
	) {
		const batch = options.entries.slice(
			batchStart,
			batchStart + TEXTURE_SOURCE_PREPARATION_BATCH_SIZE,
		);
		results.push(
			...(await Promise.all(
				batch.map((entry) =>
					measureStage(
						options.timings,
						"texture-source-preparation-chunk",
						async () => ({
							entry,
							source: await prepareTexturePackingSource({
								assetReader: options.assetReader,
								dataUse: entry.dataUse,
							}),
						}),
						1,
					),
				),
			)),
		);
		if (batchStart + TEXTURE_SOURCE_PREPARATION_BATCH_SIZE < options.entries.length) {
			await measureStage(
				options.timings,
				"texture-source-preparation-yield",
				yieldToBrowserTaskQueue,
				batch.length,
			);
		}
	}
	return results;
}

async function packTexturesWithBoundaryDiagnostics(
	texturePacker: TexturePacker,
	job: TexturePackingJob,
): Promise<TexturePackingResultWithDiagnostics> {
	if (hasDiagnosticTexturePacker(texturePacker)) {
		return texturePacker.packWithDiagnostics(job);
	}
	return {
		diagnostics: null,
		result: await texturePacker.pack(job),
	};
}

interface DiagnosticTexturePacker extends TexturePacker {
	/** Optional richer worker-boundary pack path exposed by worker-backed packers. */
	packWithDiagnostics(
		job: TexturePackingJob,
	): Promise<TexturePackingResultWithDiagnostics>;
}

function hasDiagnosticTexturePacker(
	texturePacker: TexturePacker,
): texturePacker is DiagnosticTexturePacker {
	return (
		"packWithDiagnostics" in texturePacker &&
		typeof texturePacker.packWithDiagnostics === "function"
	);
}

async function prepareTexturePackingSource(options: {
	readonly assetReader: PreparedAssetReader;
	readonly dataUse: MaterialTextureDataUseIdentity;
}): Promise<TexturePackingPixelSource> {
	const prepared = await options.assetReader.requestPreparedAsset(
		createMaterialTextureHostKey(options.dataUse),
	);
	return createTexturePackingPixelSource(
		prepareDirectMaterialTextureSource(prepared, options.dataUse),
	);
}

function createMaterialTextureHostKey(source: MaterialTextureDataUseIdentity) {
	if (source.kind === "prepared-palette-texture-use") {
		return createPreparedPaletteTextureHostKey(source);
	}

	return createPreparedTextureHostKey(source);
}

function createTexturePackingPixelSource(
	source: DirectMaterialTextureSource,
): TexturePackingPixelSource {
	if (source.kind === "direct-rgba-texture-source") {
		return {
			format: "rgba8",
			height: source.height,
			kind: "texture-packing-pixel-source",
			pixels: source.pixels,
			width: source.width,
		};
	}

	if (source.kind === "direct-index-texture-source") {
		return {
			format: source.usage === "index8" ? "r8" : "rg8",
			height: source.height,
			kind: "texture-packing-pixel-source",
			pixels: source.indices,
			width: source.width,
		};
	}

	return {
		format: "rgba8",
		height: source.height,
		kind: "texture-packing-pixel-source",
		pixels: source.pixels,
		width: source.width,
	};
}

async function measureStage<T>(
	timings: OpenWorldStreamingStaticTaskStageTiming[],
	stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
	createValue: () => Promise<T>,
	itemCount?: number,
): Promise<T> {
	const startedAtMs = nowMs();
	try {
		return await createValue();
	} finally {
		timings.push({
			durationMs: nowMs() - startedAtMs,
			...(itemCount === undefined ? {} : { itemCount }),
			stage,
		});
	}
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function yieldToBrowserTaskQueue(): Promise<void> {
	return new Promise((resolve) => {
		globalThis.setTimeout(resolve, 0);
	});
}
