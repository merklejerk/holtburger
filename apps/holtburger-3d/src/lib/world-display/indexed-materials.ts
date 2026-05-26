import { MeshStandardMaterial, type Material, type Texture } from "three";

import type { PreparedMaterialRecipePayload } from "../assets/types";
import type { IndexedTextureResource } from "./indexed-texture-resources";
import {
	applyLegacyMaterialBehavior,
	deriveLegacyMaterialBehavior,
	isBase1ClipMapSurface,
	withLegacyMeshStandardSurfaceDefaults,
} from "./material-behavior";
import type { PaletteTextureResource } from "./palette-resources";

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
	const isClipMap = isBase1ClipMapSurface(options.recipe.surfaceType);
	const behavior = deriveLegacyMaterialBehavior({
		recipe: options.recipe,
		usesIndexedClipDiscard: isClipMap,
	});
	const material = new MeshStandardMaterial(
		applyLegacyMaterialBehavior(
			withLegacyMeshStandardSurfaceDefaults({
				color: behavior.color,
				map: options.resources.indexedTexture.texture,
			}),
			behavior,
		),
	);
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
			alphaTest: behavior.alphaTest,
			blendMode: behavior.blend.mode,
			blendEnabled: behavior.blend.enabled,
			depthWrite: behavior.blend.depthWrite,
			unsupportedSurfaceFlags: behavior.unsupportedSurfaceFlags,
		},
		holtburgerLegacyMaterialBehavior: {
			opacity: behavior.opacity,
			transparent: behavior.transparent,
			alphaTest: behavior.alphaTest,
			blendMode: behavior.blend.mode,
			blendEnabled: behavior.blend.enabled,
			depthWrite: behavior.blend.depthWrite,
			unsupportedSurfaceFlags: behavior.unsupportedSurfaceFlags,
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
