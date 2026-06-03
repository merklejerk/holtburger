import {
	createWebgl2Texture2D,
	type Webgl2Texture2DResource,
} from "../../webgl2-gl";
import type {
	IndexedPaletteAtlasPage,
	IndexedPaletteAtlasPlacement,
	IndexedResourceAtlasPlan,
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
	indexPlacements: readonly IndexedTexelAtlasPlacement[];
	palettePlacements: readonly IndexedPaletteAtlasPlacement[];
	indexReadyDrawUnitIds: readonly string[];
	paletteReadyDrawUnitIds: readonly string[];
	dispose(): void;
}

export function createWebgl2IndexedResourceAtlasGenerationResource({
	gl,
	plan,
}: {
	gl: WebGL2RenderingContext;
	plan: IndexedResourceAtlasPlan;
}): Webgl2IndexedResourceAtlasGenerationResource | null {
	if (!requiresIndexedResourceAtlasGeneration(plan)) {
		return null;
	}
	const p8Textures = plan.p8IndexAtlasTextures.map((page) =>
		createWebgl2IndexAtlasTexture({
			gl,
			generationKey: plan.key,
			kind: "p8-index-texels",
			page,
			bytesPerPixel: 1,
			internalFormat: gl.R8,
			format: gl.RED,
		}),
	);
	const index16Textures = plan.index16AtlasTextures.map((page) =>
		createWebgl2IndexAtlasTexture({
			gl,
			generationKey: plan.key,
			kind: "index16-index-texels",
			page,
			bytesPerPixel: 2,
			internalFormat: gl.RG8,
			format: gl.RG,
		}),
	);
	const paletteTextures = plan.paletteAtlasTextures.map((page) =>
		createWebgl2PaletteAtlasTexture({
			gl,
			generationKey: plan.key,
			page,
		}),
	);
	return {
		key: describeWebgl2IndexedResourceAtlasGenerationKey(plan.key),
		indexTextures: [...p8Textures, ...index16Textures],
		paletteTextures,
		indexPlacements: [
			...plan.p8IndexAtlasTextures.flatMap((page) => page.placements),
			...plan.index16AtlasTextures.flatMap((page) => page.placements),
		],
		palettePlacements: plan.paletteAtlasTextures.flatMap(
			(page) => page.placements,
		),
		indexReadyDrawUnitIds: plan.indexReadyDrawUnitIds,
		paletteReadyDrawUnitIds: plan.paletteReadyDrawUnitIds,
		dispose() {
			for (const texture of [
				...p8Textures,
				...index16Textures,
				...paletteTextures,
			]) {
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
	plan: IndexedResourceAtlasPlan,
): boolean {
	return (
		plan.p8IndexAtlasTextures.length > 0 ||
		plan.index16AtlasTextures.length > 0 ||
		plan.paletteAtlasTextures.length > 0
	);
}

function createWebgl2IndexAtlasTexture({
	gl,
	generationKey,
	kind,
	page,
	bytesPerPixel,
	internalFormat,
	format,
}: {
	gl: WebGL2RenderingContext;
	generationKey: string;
	kind: "p8-index-texels" | "index16-index-texels";
	page: IndexedTexelAtlasPage;
	bytesPerPixel: 1 | 2;
	internalFormat: GLenum;
	format: GLenum;
}): Webgl2IndexedResourceAtlasTextureResource {
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
	const texture = createWebgl2Texture2D(gl, {
		label: key,
		upload: {
			width: page.width,
			height: page.height,
			internalFormat,
			format,
			type: gl.UNSIGNED_BYTE,
			data: pixels,
			generateMipmaps: false,
		},
		sampler: createExactDataSampler(gl),
	});
	return {
		key,
		kind,
		textureIndex: page.textureIndex,
		texture,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
	};
}

function createWebgl2PaletteAtlasTexture({
	gl,
	generationKey,
	page,
}: {
	gl: WebGL2RenderingContext;
	generationKey: string;
	page: IndexedPaletteAtlasPage;
}): Webgl2IndexedResourceAtlasTextureResource {
	const pixels = new Uint8Array(page.width * page.height * 4);
	for (const placement of page.placements) {
		copyPalettePlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			placement,
		});
	}
	const key = `${generationKey}/palette-lookup/texture/${page.textureIndex}`;
	const texture = createWebgl2Texture2D(gl, {
		label: key,
		upload: {
			width: page.width,
			height: page.height,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
			data: pixels,
			generateMipmaps: false,
		},
		sampler: createExactDataSampler(gl),
	});
	return {
		key,
		kind: "palette-lookup",
		textureIndex: page.textureIndex,
		texture,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
	};
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
