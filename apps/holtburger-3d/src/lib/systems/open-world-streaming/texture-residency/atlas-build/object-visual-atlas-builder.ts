import type { PreparedAssetReader } from "../../../../assets/contracts";
import { planAtlasLayout } from "../../../../textures/packing/atlas-layout";
import type {
	MaterialTextureDataUseIdentity,
	VisualTextureDomain,
} from "../../../../static/contracts";
import type {
	TexturePackingJob,
	TexturePackingPageFormat,
	TexturePackingPixelSource,
} from "../../../../textures/packing/protocol";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import { prepareMaterialTexturePackingSource } from "../material-texture-source";
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

interface OpenWorldObjectVisualAtlasBuildPage {
	/** Physical page pixel format. */
	readonly format: TexturePackingPageFormat;
	/** Gutter edge behavior for page materialization. */
	readonly gutterEdgeMode: TexturePackingJob["page"]["gutterEdgeMode"];
	/** Gutter width in pixels. */
	readonly gutterPixels: number;
	/** Runtime page height in pixels. */
	readonly height: number;
	/** Optional cap on physical texture pages a layout may use. */
	readonly maxTextureCount?: number;
	/** Atlas runway policy for oversized or multi-page jobs. */
	readonly pageRunway: TexturePackingJob["page"]["pageRunway"];
	/** Atlas page selection policy. */
	readonly pageSelection: TexturePackingJob["page"]["pageSelection"];
	/** Runtime page width in pixels. */
	readonly width: number;
}

interface OpenWorldObjectVisualAtlasBuildEntry {
	/** Shared logical texture entry being packed. */
	readonly entryId: OpenWorldTextureEntryId;
	/** Source identity used to request prepared pixels inside the builder. */
	readonly dataUse: MaterialTextureDataUseIdentity;
	/** Gutter edge behavior for this source. */
	readonly gutterEdgeMode: TexturePackingJob["sources"][number]["gutterEdgeMode"];
}

export interface OpenWorldObjectVisualAtlasPlacementOutput {
	/** Planned virtual page layouts. Does not contain page pixels. */
	readonly pages: readonly OpenWorldObjectVisualAtlasPlacementPage[];
	/** Packed rects keyed by replacement entry id. */
	readonly rects: readonly OpenWorldObjectVisualAtlasPlacementRect[];
	/** Worker-owned immutable source dimensions and format facts used by layout. */
	readonly sourceFacts: readonly OpenWorldObjectVisualAtlasSourceFact[];
	/** Worker- or direct-builder-local stage timings. */
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

interface OpenWorldObjectVisualAtlasSourceFact {
	/** Shared texture entry whose source was inspected by the atlas worker. */
	readonly entryKey: OpenWorldTextureEntryId;
	/** Prepared source pixel format required by the layout/page format. */
	readonly format: TexturePackingPageFormat;
	/** Prepared source height in pixels. */
	readonly height: number;
	/** Prepared source width in pixels. */
	readonly width: number;
}

interface OpenWorldObjectVisualAtlasPlacementPage {
	/** Layout-local page id used before replacement residency assigns virtual pages. */
	readonly pageId: string;
	/** Runtime page height in pixels. */
	readonly height: number;
	/** Runtime page width in pixels. */
	readonly width: number;
}

export interface OpenWorldObjectVisualAtlasPlacementRect {
	/** Shared texture entry placed by this rect. */
	readonly entryKey: OpenWorldTextureEntryId;
	/** Layout-local page id containing this rect. */
	readonly pageId: string;
	/** Content rect inside the page, excluding gutters. */
	readonly rect: readonly [number, number, number, number];
}

export interface OpenWorldObjectVisualAtlasBuilder {
	planAtlasPlacement(
		input: OpenWorldObjectVisualAtlasBuildInput,
	): Promise<OpenWorldObjectVisualAtlasPlacementOutput>;
	dispose?(): void;
}

/** Generic material-texture atlas input used by static and runtime texture placement. */
export type OpenWorldMaterialTextureAtlasBuildInput =
	OpenWorldObjectVisualAtlasBuildInput;

/** Generic material-texture atlas output used by static and runtime texture placement. */
export type OpenWorldMaterialTextureAtlasPlacementOutput =
	OpenWorldObjectVisualAtlasPlacementOutput;

/** Generic material-texture atlas builder used by static and runtime texture placement. */
export type OpenWorldMaterialTextureAtlasBuilder =
	OpenWorldObjectVisualAtlasBuilder;

export class DirectOpenWorldObjectVisualAtlasBuilder implements OpenWorldObjectVisualAtlasBuilder {
	readonly #assetReader: PreparedAssetReader;

	constructor(options: { readonly assetReader: PreparedAssetReader }) {
		this.#assetReader = options.assetReader;
	}

	async planAtlasPlacement(
		input: OpenWorldObjectVisualAtlasBuildInput,
	): Promise<OpenWorldObjectVisualAtlasPlacementOutput> {
		return planObjectVisualAtlasPlacement({
			assetReader: this.#assetReader,
			input,
		});
	}
}

async function planObjectVisualAtlasPlacement(options: {
	readonly assetReader: PreparedAssetReader;
	readonly input: OpenWorldObjectVisualAtlasBuildInput;
}): Promise<OpenWorldObjectVisualAtlasPlacementOutput> {
	const timings: OpenWorldStreamingStaticTaskStageTiming[] = [];
	const sourceFacts = await measureStage(
		timings,
		"texture-source-fact-preparation",
		() =>
			prepareTextureSourceFacts({
				assetReader: options.assetReader,
				entries: options.input.entries,
				timings,
			}),
		options.input.entries.length,
	);
	const layout = await measureStage(
		timings,
		"texture-layout",
		async () =>
			planTexturePlacementLayout({
				input: options.input,
				sourceFacts,
			}),
		sourceFacts.length,
	);
	return {
		pages: layout.pages,
		rects: layout.rects,
		sourceFacts,
		stageTimings: timings,
	};
}

async function prepareTextureSourceFacts(options: {
	readonly assetReader: PreparedAssetReader;
	readonly entries: readonly OpenWorldObjectVisualAtlasBuildEntry[];
	readonly timings: OpenWorldStreamingStaticTaskStageTiming[];
}): Promise<readonly OpenWorldObjectVisualAtlasSourceFact[]> {
	const results: OpenWorldObjectVisualAtlasSourceFact[] = [];
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
						"texture-source-fact-preparation-chunk",
						async () => {
							const source = await prepareMaterialTexturePackingSource({
								assetReader: options.assetReader,
								dataUse: entry.dataUse,
							});
							assertPixelLengthMatchesFormat(
								"source-fact-preparation",
								entry.entryId,
								source,
							);
							return {
								entryKey: entry.entryId,
								format: source.format,
								height: source.height,
								width: source.width,
							};
						},
						1,
					),
				),
			)),
		);
		if (
			batchStart + TEXTURE_SOURCE_PREPARATION_BATCH_SIZE <
			options.entries.length
		) {
			await measureStage(
				options.timings,
				"texture-source-fact-preparation-yield",
				yieldToBrowserTaskQueue,
				batch.length,
			);
		}
	}
	return results;
}

function planTexturePlacementLayout(options: {
	readonly input: OpenWorldObjectVisualAtlasBuildInput;
	readonly sourceFacts: readonly OpenWorldObjectVisualAtlasSourceFact[];
}): {
	readonly pages: readonly OpenWorldObjectVisualAtlasPlacementPage[];
	readonly rects: readonly OpenWorldObjectVisualAtlasPlacementRect[];
} {
	for (const sourceFact of options.sourceFacts) {
		if (sourceFact.format !== options.input.page.format) {
			throw new Error(
				`Texture layout job ${options.input.jobId} expected ${options.input.page.format} sources, got ${sourceFact.format}.`,
			);
		}
	}

	const layout = planAtlasLayout({
		entries: options.sourceFacts.map((sourceFact) => ({
			height: sourceFact.height,
			key: sourceFact.entryKey,
			width: sourceFact.width,
		})),
		policy: {
			gutterPixels: options.input.page.gutterPixels,
			maxTextureCount:
				options.input.page.maxTextureCount ?? Number.MAX_SAFE_INTEGER,
			maxTextureSize: Math.max(
				options.input.page.width,
				options.input.page.height,
			),
			pageRunway: options.input.page.pageRunway,
			pageSelection: options.input.page.pageSelection,
		},
	});
	if (layout.overflows.length > 0) {
		const overflow = layout.overflows[0];
		throw new Error(
			`Texture layout job ${options.input.jobId} could not place ${overflow?.atlasEntryKey ?? "a texture"}: ${overflow?.detail ?? "atlas capacity was exceeded"}.`,
		);
	}

	return {
		pages: layout.texturePages.map((page) => ({
			height: page.height,
			pageId: createPageId(options.input.jobId, page.textureIndex),
			width: page.width,
		})),
		rects: layout.texturePages.flatMap((page) =>
			page.placements.map((placement) => ({
				entryKey: placement.atlasEntryKey as OpenWorldTextureEntryId,
				pageId: createPageId(options.input.jobId, page.textureIndex),
				rect: [
					placement.x,
					placement.y,
					placement.width,
					placement.height,
				] as const,
			})),
		),
	};
}

function assertPixelLengthMatchesFormat(
	jobId: string,
	entryId: string,
	source: TexturePackingPixelSource,
): void {
	const expectedLength =
		source.width *
		source.height *
		getTexturePackingFormatBytesPerPixel(source.format);
	if (source.pixels.byteLength !== expectedLength) {
		throw new Error(
			`Texture layout job ${jobId} source ${entryId} expected ${expectedLength} bytes for ${source.format}, got ${source.pixels.byteLength}.`,
		);
	}
}

function createPageId(jobId: string, pageIndex: number): string {
	return `${jobId}:page:${pageIndex}`;
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
	}
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
