import {
	createWebgl2Texture2D,
	type Webgl2Texture2DResource,
} from "../../webgl2-gl";
import type {
	IndexedPaletteAtlasPage,
	IndexedPaletteAtlasPlacement,
	IndexedTexelAtlasPage,
	IndexedTexelAtlasPlacement,
} from "../../texture-pages/indexed-resource-atlas-planner";

type Webgl2IndexedAtlasTextureKind =
	| "p8-index-texels"
	| "index16-index-texels"
	| "palette-lookup";

export interface Webgl2IndexedResourceAtlasTextureResource {
	key: string;
	kind: Webgl2IndexedAtlasTextureKind;
	textureIndex: number;
	texture: Webgl2Texture2DResource;
	width: number;
	height: number;
	placementCount: number;
}

export interface Webgl2IndexedResourceAtlasGenerationResource {
	key: string;
	indexTextures: readonly Webgl2IndexedResourceAtlasTextureResource[];
	paletteTextures: readonly Webgl2IndexedResourceAtlasTextureResource[];
	indexPlacements: readonly IndexedResourceAtlasPlacement[];
	palettePlacements: readonly IndexedResourcePaletteAtlasPlacement[];
	indexReadyDrawUnitIds: readonly string[];
	paletteReadyDrawUnitIds: readonly string[];
	dispose(): void;
}

interface IndexedResourceAtlasPlacement {
	indexTextureKey: string;
	format: "p8" | "index16";
	atlasTextureIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface IndexedResourcePaletteAtlasPlacement {
	paletteTextureKey: string;
	atlasTextureIndex: number;
	x: number;
	y: number;
	colorCount: number;
}

interface IndexedResourceAtlasCpuTexture {
	key: string;
	kind: Webgl2IndexedAtlasTextureKind;
	textureIndex: number;
	width: number;
	height: number;
	placementCount: number;
	pixels: Uint8Array;
}

export interface IndexedResourceAtlasCpuGeneration {
	key: string;
	indexTextures: readonly IndexedResourceAtlasCpuTexture[];
	paletteTextures: readonly IndexedResourceAtlasCpuTexture[];
	indexPlacements: readonly IndexedResourceAtlasPlacement[];
	palettePlacements: readonly IndexedResourcePaletteAtlasPlacement[];
	indexReadyDrawUnitIds: readonly string[];
	paletteReadyDrawUnitIds: readonly string[];
}

export interface IndexedResourceAtlasCpuGenerationPlan {
	key: string;
	indexReadyDrawUnitIds: readonly string[];
	paletteReadyDrawUnitIds: readonly string[];
	p8IndexAtlasTextures: readonly IndexedTexelAtlasPage[];
	index16AtlasTextures: readonly IndexedTexelAtlasPage[];
	paletteAtlasTextures: readonly IndexedPaletteAtlasPage[];
}

export function createIndexedResourceAtlasCpuGeneration(
	plan: IndexedResourceAtlasCpuGenerationPlan,
): IndexedResourceAtlasCpuGeneration | null {
	if (!requiresIndexedResourceAtlasGeneration(plan)) {
		return null;
	}
	const p8Textures = plan.p8IndexAtlasTextures.map((page) =>
		createIndexAtlasCpuTexture({
			generationKey: plan.key,
			kind: "p8-index-texels",
			page,
			bytesPerPixel: 1,
		}),
	);
	const index16Textures = plan.index16AtlasTextures.map((page) =>
		createIndexAtlasCpuTexture({
			generationKey: plan.key,
			kind: "index16-index-texels",
			page,
			bytesPerPixel: 2,
		}),
	);
	const paletteTextures = plan.paletteAtlasTextures.map((page) =>
		createPaletteAtlasCpuTexture({
			generationKey: plan.key,
			page,
		}),
	);
	return {
		key: describeWebgl2IndexedResourceAtlasGenerationKey(plan.key),
		indexTextures: [...p8Textures, ...index16Textures],
		paletteTextures,
		indexPlacements: [
			...plan.p8IndexAtlasTextures.flatMap((page) =>
				page.placements.map(stripIndexPlacementSourceBytes),
			),
			...plan.index16AtlasTextures.flatMap((page) =>
				page.placements.map(stripIndexPlacementSourceBytes),
			),
		],
		palettePlacements: plan.paletteAtlasTextures.flatMap((page) =>
			page.placements.map(stripPalettePlacementSourceBytes),
		),
		indexReadyDrawUnitIds: plan.indexReadyDrawUnitIds,
		paletteReadyDrawUnitIds: plan.paletteReadyDrawUnitIds,
	};
}

function stripIndexPlacementSourceBytes(
	placement: IndexedTexelAtlasPage["placements"][number],
): IndexedResourceAtlasPlacement {
	return {
		indexTextureKey: placement.indexTextureKey,
		format: placement.format,
		atlasTextureIndex: placement.atlasTextureIndex,
		x: placement.x,
		y: placement.y,
		width: placement.width,
		height: placement.height,
	};
}

function stripPalettePlacementSourceBytes(
	placement: IndexedPaletteAtlasPage["placements"][number],
): IndexedResourcePaletteAtlasPlacement {
	return {
		paletteTextureKey: placement.paletteTextureKey,
		atlasTextureIndex: placement.atlasTextureIndex,
		x: placement.x,
		y: placement.y,
		colorCount: placement.colorCount,
	};
}

export function createWebgl2IndexedResourceAtlasGenerationResourceFromCpu({
	gl,
	cpuGeneration,
}: {
	gl: WebGL2RenderingContext;
	cpuGeneration: IndexedResourceAtlasCpuGeneration;
}): Webgl2IndexedResourceAtlasGenerationResource {
	const indexTextures = cpuGeneration.indexTextures.map((texture) =>
		createWebgl2IndexedAtlasTexture({ gl, cpuTexture: texture }),
	);
	const paletteTextures = cpuGeneration.paletteTextures.map((texture) =>
		createWebgl2IndexedAtlasTexture({ gl, cpuTexture: texture }),
	);
	return {
		key: cpuGeneration.key,
		indexTextures,
		paletteTextures,
		indexPlacements: cpuGeneration.indexPlacements,
		palettePlacements: cpuGeneration.palettePlacements,
		indexReadyDrawUnitIds: cpuGeneration.indexReadyDrawUnitIds,
		paletteReadyDrawUnitIds: cpuGeneration.paletteReadyDrawUnitIds,
		dispose() {
			for (const texture of [...indexTextures, ...paletteTextures]) {
				texture.texture.dispose();
			}
		},
	};
}

export function describeWebgl2IndexedResourceAtlasGenerationKey(
	planKey: string,
): string {
	return `${planKey};indexed-webgl2`;
}

function requiresIndexedResourceAtlasGeneration(
	plan: IndexedResourceAtlasCpuGenerationPlan,
): boolean {
	return (
		plan.p8IndexAtlasTextures.length > 0 ||
		plan.index16AtlasTextures.length > 0 ||
		plan.paletteAtlasTextures.length > 0
	);
}

function createIndexAtlasCpuTexture({
	generationKey,
	kind,
	page,
	bytesPerPixel,
}: {
	generationKey: string;
	kind: "p8-index-texels" | "index16-index-texels";
	page: IndexedTexelAtlasPage;
	bytesPerPixel: 1 | 2;
}): IndexedResourceAtlasCpuTexture {
	const pixels = new Uint8Array(page.width * page.height * bytesPerPixel);
	for (const placement of page.placements) {
		copyIndexPlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			bytesPerPixel,
			placement,
		});
	}
	const key = `${generationKey}/${kind}/texture/${page.textureIndex}`;
	return {
		key,
		kind,
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
		pixels,
	};
}

function createPaletteAtlasCpuTexture({
	generationKey,
	page,
}: {
	generationKey: string;
	page: IndexedPaletteAtlasPage;
}): IndexedResourceAtlasCpuTexture {
	const pixels = new Uint8Array(page.width * page.height * 4);
	for (const placement of page.placements) {
		copyPalettePlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			placement,
		});
	}
	const key = `${generationKey}/palette-lookup/texture/${page.textureIndex}`;
	return {
		key,
		kind: "palette-lookup",
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
		pixels,
	};
}

function createWebgl2IndexedAtlasTexture({
	gl,
	cpuTexture,
}: {
	gl: WebGL2RenderingContext;
	cpuTexture: IndexedResourceAtlasCpuTexture;
}): Webgl2IndexedResourceAtlasTextureResource {
	const formats = resolveIndexedAtlasTextureFormats(gl, cpuTexture.kind);
	const texture = createWebgl2Texture2D(gl, {
		label: cpuTexture.key,
		upload: {
			width: cpuTexture.width,
			height: cpuTexture.height,
			internalFormat: formats.internalFormat,
			format: formats.format,
			type: gl.UNSIGNED_BYTE,
			data: cpuTexture.pixels,
			generateMipmaps: false,
		},
		sampler: createExactDataSampler(gl),
	});
	return {
		key: cpuTexture.key,
		kind: cpuTexture.kind,
		textureIndex: cpuTexture.textureIndex,
		texture,
		width: cpuTexture.width,
		height: cpuTexture.height,
		placementCount: cpuTexture.placementCount,
	};
}

function resolveIndexedAtlasTextureFormats(
	gl: WebGL2RenderingContext,
	kind: Webgl2IndexedAtlasTextureKind,
): { internalFormat: GLenum; format: GLenum } {
	switch (kind) {
		case "p8-index-texels":
			return { internalFormat: gl.R8, format: gl.RED };
		case "index16-index-texels":
			return { internalFormat: gl.RG8, format: gl.RG };
		case "palette-lookup":
			return { internalFormat: gl.RGBA8, format: gl.RGBA };
	}
}

function copyIndexPlacement({
	atlasPixels,
	atlasWidth,
	bytesPerPixel,
	placement,
}: {
	atlasPixels: Uint8Array;
	atlasWidth: number;
	bytesPerPixel: 1 | 2;
	placement: IndexedTexelAtlasPlacement;
}): void {
	for (let row = 0; row < placement.height; row += 1) {
		const sourceOffset = row * placement.width * bytesPerPixel;
		const targetOffset =
			((placement.y + row) * atlasWidth + placement.x) * bytesPerPixel;
		atlasPixels.set(
			placement.sourceBytes.subarray(
				sourceOffset,
				sourceOffset + placement.width * bytesPerPixel,
			),
			targetOffset,
		);
	}
}

function copyPalettePlacement({
	atlasPixels,
	atlasWidth,
	placement,
}: {
	atlasPixels: Uint8Array;
	atlasWidth: number;
	placement: IndexedPaletteAtlasPlacement;
}): void {
	const targetOffset = (placement.y * atlasWidth + placement.x) * 4;
	atlasPixels.set(
		placement.rgbaBytes.subarray(0, placement.colorCount * 4),
		targetOffset,
	);
}

function createExactDataSampler(gl: WebGL2RenderingContext) {
	return {
		wrapS: gl.CLAMP_TO_EDGE,
		wrapT: gl.CLAMP_TO_EDGE,
		minFilter: gl.NEAREST,
		magFilter: gl.NEAREST,
	};
}
