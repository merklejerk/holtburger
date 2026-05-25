import { MeshStandardMaterial, type Material, type Texture } from "three";

import type { PreparedMaterialRecipePayload } from "../assets/types";
import type { IndexedTextureResource } from "./indexed-texture-resources";
import type { PaletteTextureResource } from "./palette-resources";

const SURFACE_TYPE_BASE1_CLIP_MAP = 0x4;
const CLIP_MAP_TRANSPARENT_INDEX_THRESHOLD = 8;

interface IndexedMaterialShader {
	uniforms: Record<string, { value: unknown }>;
	fragmentShader: string;
}

export interface IndexedMaterialResources {
	indexedTexture: IndexedTextureResource;
	palette: PaletteTextureResource;
}

export function createIndexedMeshStandardMaterial(options: {
	recipe: PreparedMaterialRecipePayload;
	resources: IndexedMaterialResources;
}): Material {
	const opacity = normalizeLegacyOpacity(options.recipe.translucency);
	const isClipMap = isBase1ClipMapSurface(options.recipe.surfaceType);
	const material = new MeshStandardMaterial({
		color: "#ffffff",
		map: options.resources.indexedTexture.texture,
		flatShading: true,
		metalness: 0.02,
		roughness: 0.88,
		transparent: opacity < 1,
		opacity,
	});
	const shaderPatch = createIndexedMaterialShaderPatch({
		indexedTexture: options.resources.indexedTexture,
		paletteTexture: options.resources.palette.texture,
		paletteColorCount: options.resources.palette.colorCount,
		clipThreshold: isClipMap ? CLIP_MAP_TRANSPARENT_INDEX_THRESHOLD : -1,
	});
	material.onBeforeCompile = shaderPatch.onBeforeCompile;
	material.customProgramCacheKey = shaderPatch.customProgramCacheKey;
	material.userData = {
		...material.userData,
		holtburgerIndexedMaterial: {
			format: options.resources.indexedTexture.format,
			paletteColorCount: options.resources.palette.colorCount,
			clipThreshold: isClipMap ? CLIP_MAP_TRANSPARENT_INDEX_THRESHOLD : -1,
		},
	};
	return material;
}

export function createIndexedMaterialShaderPatch(options: {
	indexedTexture: IndexedTextureResource;
	paletteTexture: Texture;
	paletteColorCount: number;
	clipThreshold: number;
}): {
	onBeforeCompile: (shader: IndexedMaterialShader) => void;
	customProgramCacheKey: () => string;
} {
	const indexedFormatFlag = options.indexedTexture.format === "index16" ? 1 : 0;
	return {
		onBeforeCompile: (shader) => {
			shader.uniforms.indexedPaletteMap = { value: options.paletteTexture };
			shader.uniforms.indexedPaletteColorCount = {
				value: options.paletteColorCount,
			};
			shader.uniforms.indexedFormat = { value: indexedFormatFlag };
			shader.uniforms.indexedClipThreshold = { value: options.clipThreshold };
			shader.fragmentShader = shader.fragmentShader.replace(
				"void main() {",
				`${indexedMaterialUniformDeclarations()}\nvoid main() {`,
			);
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <map_fragment>",
				indexedMapFragmentShaderChunk(),
			);
		},
		customProgramCacheKey: () =>
			[
				"holtburger-indexed-material",
				options.indexedTexture.format,
				options.paletteColorCount,
				options.clipThreshold,
			].join(":"),
	};
}

export function isBase1ClipMapSurface(surfaceType: number): boolean {
	return (
		(surfaceType & SURFACE_TYPE_BASE1_CLIP_MAP) === SURFACE_TYPE_BASE1_CLIP_MAP
	);
}

function indexedMaterialUniformDeclarations(): string {
	return `
uniform sampler2D indexedPaletteMap;
uniform float indexedPaletteColorCount;
uniform int indexedFormat;
uniform int indexedClipThreshold;
`;
}

function indexedMapFragmentShaderChunk(): string {
	return `
#ifdef USE_MAP
	vec4 sampledIndexTexel = texture2D( map, vMapUv );
	float paletteIndex = floor(sampledIndexTexel.r * 255.0 + 0.5);
	if (indexedFormat == 1) {
		paletteIndex += floor(sampledIndexTexel.g * 255.0 + 0.5) * 256.0;
	}
	if (indexedClipThreshold >= 0 && paletteIndex < float(indexedClipThreshold)) {
		discard;
	}
	float paletteU = (paletteIndex + 0.5) / indexedPaletteColorCount;
	vec4 sampledPaletteColor = texture2D( indexedPaletteMap, vec2( paletteU, 0.5 ) );
	diffuseColor *= sampledPaletteColor;
#endif
`;
}

function normalizeLegacyOpacity(translucency: number): number {
	if (translucency <= 0) {
		return 1;
	}
	return Math.max(0, Math.min(1, 1 - translucency / 255));
}
