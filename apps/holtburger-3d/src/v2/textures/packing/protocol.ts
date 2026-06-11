import type { DirectRgbaTextureSource } from "../../assets/preparation/prepared-texture-source";
import type { StaticDomain } from "../../static/contracts";

export interface TexturePackingJob {
	readonly jobId: string;
	readonly domain: StaticDomain;
	readonly placementRevision: number;
	readonly page: TexturePackingPageConstraints;
	readonly sources: readonly TexturePackingSource[];
}

interface TexturePackingPageConstraints {
	readonly width: number;
	readonly height: number;
	readonly format: "rgba8";
}

interface TexturePackingSource {
	readonly textureUseId: string;
	readonly source: DirectRgbaTextureSource;
}

export interface TexturePackingResult {
	readonly jobId: string;
	readonly domain: StaticDomain;
	readonly placementRevision: number;
	readonly pages: readonly TexturePackingPagePixels[];
	readonly rects: readonly TexturePackingRect[];
}

export interface TexturePackingPagePixels {
	readonly pageId: string;
	readonly width: number;
	readonly height: number;
	readonly format: "rgba8";
	readonly pixels: Uint8Array;
}

export interface TexturePackingRect {
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
