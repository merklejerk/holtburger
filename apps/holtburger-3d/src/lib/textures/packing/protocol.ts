import type { VisualTextureDomain } from "../../static/contracts";

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
	readonly pageSelection?: "minimize-memory" | "minimize-textures";
}

interface TexturePackingCohort {
	readonly key: string;
	readonly textureUseIds: readonly string[];
}

interface TexturePackingSource {
	readonly textureUseId: string;
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

interface TexturePackingPagePixels {
	readonly pageId: string;
	readonly width: number;
	readonly height: number;
	readonly format: TexturePackingPageFormat;
	readonly pixels: Uint8Array;
}

interface TexturePackingRect {
	readonly textureUseId: string;
	readonly pageId: string;
	readonly rect: readonly [number, number, number, number];
}

export type TexturePackingWorkerMainMessage =
	| {
			readonly kind: "pack-textures";
			readonly requestId: string;
			readonly job: TexturePackingJob;
	  }
	| {
			readonly kind: "cancel-texture-pack";
			readonly requestId: string;
	  };

export type TexturePackingWorkerThreadMessage =
	| {
			readonly kind: "textures-packed";
			readonly requestId: string;
			readonly result: TexturePackingResult;
	  }
	| {
			readonly kind: "texture-pack-failed";
			readonly requestId: string;
			readonly message: string;
	  };

export type TexturePackingWorkerRequest = TexturePackingWorkerMainMessage;
export type TexturePackingWorkerResponse = TexturePackingWorkerThreadMessage;

export interface TexturePackingWorkerPort {
	postMessage(message: TexturePackingWorkerMainMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<TexturePackingWorkerThreadMessage>) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<TexturePackingWorkerThreadMessage>) => void,
	): void;
}

export interface TexturePackingWorkerGlobalPort {
	postMessage(message: TexturePackingWorkerThreadMessage): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<TexturePackingWorkerMainMessage>) => void,
	): void;
}
