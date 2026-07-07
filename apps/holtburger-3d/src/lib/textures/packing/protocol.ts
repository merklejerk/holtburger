import type { VisualTextureDomain } from "../../static/contracts";
import type {
	WorkerHandlerPort,
	WorkerHandlerInputMessage,
	WorkerHandlerOutputMessage,
} from "../../workers/handler";
import type {
	WorkerMessagePort,
	WorkerPoolRequestMessage,
	WorkerPoolResponseMessage,
} from "../../workers/pool";

export type TexturePackingPageFormat = "rgba8" | "r8" | "rg8";

export interface TexturePackingJob {
	readonly jobId: string;
	readonly domain: VisualTextureDomain;
	readonly placementRevision: number;
	readonly page: TexturePackingPageConstraints;
	readonly cohorts?: readonly TexturePackingCohort[];
	readonly sources: readonly TexturePackingSource[];
}

interface TexturePackingPageConstraints {
	readonly width: number;
	readonly height: number;
	readonly format: TexturePackingPageFormat;
	readonly fillRgba?: readonly [number, number, number, number];
	readonly gutterEdgeMode?: "clamp" | "repeat";
	readonly gutterPixels?: number;
	readonly maxTextureCount?: number;
	// Requests extra unused page space after the packer selects a winning layout.
	readonly pageRunway?: "none" | "one-tier";
	readonly pageSelection?: "minimize-memory" | "minimize-textures";
}

interface TexturePackingCohort {
	readonly key: string;
	readonly entryKeys: readonly string[];
}

interface TexturePackingSource {
	readonly entryKey: string;
	readonly gutterEdgeMode?: "clamp" | "repeat";
	readonly source: TexturePackingPixelSource;
}

export interface TexturePackingPixelSource {
	readonly kind: "texture-packing-pixel-source";
	readonly format: TexturePackingPageFormat;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

export interface TexturePackingResult {
	readonly jobId: string;
	readonly domain: VisualTextureDomain;
	readonly placementRevision: number;
	readonly pages: readonly TexturePackingPagePixels[];
	readonly rects: readonly TexturePackingRect[];
}

interface TexturePackingWorkerResultReadyProgress {
	/** Worker wall-clock timestamp immediately before result postMessage. */
	readonly completedAtEpochMs: number;
	/** Packed page pixel bytes sent with the worker result. */
	readonly pagePixelByteLength: number;
	/** Packed pages returned by the worker result. */
	readonly pageCount: number;
	/** Packed rects returned by the worker result. */
	readonly rectCount: number;
	readonly kind: "result-ready";
	/** Transferable objects sent with the worker result. */
	readonly transferCount: number;
}

export type TexturePackingWorkerProgress =
	TexturePackingWorkerResultReadyProgress;

interface TexturePackingPagePixels {
	readonly pageId: string;
	readonly width: number;
	readonly height: number;
	readonly format: TexturePackingPageFormat;
	readonly pixels: Uint8Array;
}

interface TexturePackingRect {
	readonly entryKey: string;
	readonly pageId: string;
	readonly rect: readonly [number, number, number, number];
}

export type TexturePackingWorkerRequest =
	WorkerHandlerInputMessage<TexturePackingJob>;

export type TexturePackingWorkerResponse = WorkerHandlerOutputMessage<
	TexturePackingResult,
	TexturePackingWorkerProgress
>;

export type TexturePackingWorkerPort = WorkerMessagePort<
	WorkerPoolRequestMessage<TexturePackingJob>,
	WorkerPoolResponseMessage<TexturePackingResult, TexturePackingWorkerProgress>
>;

export type TexturePackingWorkerGlobalPort = WorkerHandlerPort<
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerProgress
>;
