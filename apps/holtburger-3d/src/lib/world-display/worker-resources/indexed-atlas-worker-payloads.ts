import {
	createIndexedResourceAtlasCpuGeneration,
	type IndexedResourceAtlasCpuGeneration,
} from "../webgl2/resources/indexed-resource-atlas-generation";
import type {
	IndexedPaletteAtlasPage,
	IndexedPaletteAtlasPlacement,
	IndexedResourceAtlasPlan,
	IndexedTexelAtlasPage,
	IndexedTexelAtlasPlacement,
} from "../texture-pages/indexed-resource-atlas-planner";

export interface BuildIndexedResourceAtlasWorkerJob {
	type: "build-indexed-resource-atlas";
	key: string;
	input: BuildIndexedResourceAtlasWorkerInput;
}

export interface BuildIndexedResourceAtlasWorkerResult {
	type: "build-indexed-resource-atlas";
	key: string;
	generation: IndexedResourceAtlasCpuGeneration | null;
}

export interface BuildIndexedResourceAtlasWorkerInput {
	key: string;
	indexReadyDrawUnitIds: readonly string[];
	paletteReadyDrawUnitIds: readonly string[];
	p8IndexAtlasTextures: readonly IndexedTexelAtlasPage[];
	index16AtlasTextures: readonly IndexedTexelAtlasPage[];
	paletteAtlasTextures: readonly IndexedPaletteAtlasPage[];
}

export function createBuildIndexedResourceAtlasWorkerInput(
	plan: IndexedResourceAtlasPlan,
): BuildIndexedResourceAtlasWorkerInput {
	return {
		key: plan.key,
		indexReadyDrawUnitIds: [...plan.indexReadyDrawUnitIds],
		paletteReadyDrawUnitIds: [...plan.paletteReadyDrawUnitIds],
		p8IndexAtlasTextures: plan.p8IndexAtlasTextures.map(copyIndexAtlasPage),
		index16AtlasTextures: plan.index16AtlasTextures.map(copyIndexAtlasPage),
		paletteAtlasTextures: plan.paletteAtlasTextures.map(copyPaletteAtlasPage),
	};
}

export function buildIndexedResourceAtlasWorkerResult(
	input: BuildIndexedResourceAtlasWorkerInput,
): BuildIndexedResourceAtlasWorkerResult {
	return {
		type: "build-indexed-resource-atlas",
		key: input.key,
		generation: createIndexedResourceAtlasCpuGeneration(input),
	};
}

export function collectBuildIndexedResourceAtlasInputTransferables(
	input: BuildIndexedResourceAtlasWorkerInput,
): Transferable[] {
	return uniqueTransferables([
		...input.p8IndexAtlasTextures.flatMap((page) =>
			page.placements.map((placement) => placement.sourceBytes.buffer),
		),
		...input.index16AtlasTextures.flatMap((page) =>
			page.placements.map((placement) => placement.sourceBytes.buffer),
		),
		...input.paletteAtlasTextures.flatMap((page) =>
			page.placements.map((placement) => placement.rgbaBytes.buffer),
		),
	]);
}

export function collectBuildIndexedResourceAtlasResultTransferables(
	result: BuildIndexedResourceAtlasWorkerResult,
): Transferable[] {
	const generation = result.generation;
	if (!generation) {
		return [];
	}
	return uniqueTransferables([
		...generation.indexTextures.map((texture) => texture.pixels.buffer),
		...generation.paletteTextures.map((texture) => texture.pixels.buffer),
	]);
}

function copyIndexAtlasPage(
	page: IndexedTexelAtlasPage,
): IndexedTexelAtlasPage {
	return {
		format: page.format,
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placements: page.placements.map(copyIndexPlacement),
	};
}

function copyIndexPlacement(
	placement: IndexedTexelAtlasPlacement,
): IndexedTexelAtlasPlacement {
	return {
		indexTextureKey: placement.indexTextureKey,
		format: placement.format,
		atlasTextureIndex: placement.atlasTextureIndex,
		x: placement.x,
		y: placement.y,
		width: placement.width,
		height: placement.height,
		sourceBytes: new Uint8Array(placement.sourceBytes),
	};
}

function copyPaletteAtlasPage(
	page: IndexedPaletteAtlasPage,
): IndexedPaletteAtlasPage {
	return {
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placements: page.placements.map(copyPalettePlacement),
	};
}

function copyPalettePlacement(
	placement: IndexedPaletteAtlasPlacement,
): IndexedPaletteAtlasPlacement {
	return {
		paletteTextureKey: placement.paletteTextureKey,
		atlasTextureIndex: placement.atlasTextureIndex,
		x: placement.x,
		y: placement.y,
		colorCount: placement.colorCount,
		rgbaBytes: new Uint8Array(placement.rgbaBytes),
	};
}

function uniqueTransferables(
	buffers: readonly (ArrayBufferLike | undefined)[],
): Transferable[] {
	const transferables = new Set<Transferable>();
	for (const buffer of buffers) {
		if (buffer instanceof ArrayBuffer) {
			transferables.add(buffer);
		}
	}
	return [...transferables];
}
