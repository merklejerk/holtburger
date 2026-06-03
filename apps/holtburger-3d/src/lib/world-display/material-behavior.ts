import type { PreparedMaterialRecipePayload } from "../assets/types";

const BYTE_MAX = 255;
const LEGACY_OPACITY_BYTE_SCALE = 255;
const SURFACE_TYPE_BASE1_CLIP_MAP = 0x4;
const SURFACE_TYPE_TRANSLUCENT = 0x10;
const SURFACE_TYPE_DIFFUSE = 0x20;
const SURFACE_TYPE_LUMINOUS = 0x40;
const SURFACE_TYPE_ALPHA = 0x100;
const SURFACE_TYPE_INV_ALPHA = 0x200;
const SURFACE_TYPE_ADDITIVE = 0x10000;
const SURFACE_TYPE_DETAIL = 0x20000;
const INDEXED_CLIP_MAP_ALPHA_TEST_REF = 100;
const DIRECT_CLIP_MAP_ALPHA_TEST_REF = 200;
export const INDEXED_CLIP_MAP_ALPHA_TEST =
	INDEXED_CLIP_MAP_ALPHA_TEST_REF / BYTE_MAX;
export const DIRECT_CLIP_MAP_ALPHA_TEST =
	DIRECT_CLIP_MAP_ALPHA_TEST_REF / BYTE_MAX;

export interface LegacyMaterialBehaviorDto {
	color: readonly [number, number, number];
	emissive: readonly [number, number, number];
	emissiveIntensity: number;
	opacity: number;
	transparent: boolean;
	alphaTest: number;
	side: "front";
	blend: LegacyMaterialBlendBehaviorDto;
	unsupportedSurfaceFlags: string[];
}

interface LegacyMaterialBlendBehaviorDto {
	mode: LegacyMaterialBlendMode;
	enabled: boolean;
	srcFactor: LegacyMaterialBlendFactor | null;
	dstFactor: LegacyMaterialBlendFactor | null;
	depthWrite: boolean;
}

type LegacyMaterialBlendMode =
	| "opaque"
	| "alpha"
	| "alpha-additive"
	| "inverse-alpha"
	| "inverse-alpha-additive"
	| "additive"
	| "clipmap"
	| "translucent";

type LegacyMaterialBlendFactor = "one" | "src-alpha" | "one-minus-src-alpha";

export function deriveLegacyMaterialBehaviorDto(options: {
	recipe: PreparedMaterialRecipePayload;
	hasSourceAlpha?: boolean;
	usesIndexedClipDiscard?: boolean;
}): LegacyMaterialBehaviorDto {
	const recipe = options.recipe;
	const opacity = normalizeLegacyOpacity(recipe.translucency);
	const diffuse = hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_DIFFUSE)
		? clampUnit(recipe.diffuse)
		: 1;
	const luminosity = hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_LUMINOUS)
		? clampNonNegative(recipe.luminosity)
		: 0;
	const isClipMap = isBase1ClipMapSurface(recipe.surfaceType);
	const isTranslucent = hasSurfaceFlag(
		recipe.surfaceType,
		SURFACE_TYPE_TRANSLUCENT,
	);
	const alphaTest = clipMapAlphaTest({
		isClipMap,
		isTranslucent,
		hasSourceAlpha: !!options.hasSourceAlpha,
		usesIndexedClipDiscard: !!options.usesIndexedClipDiscard,
	});
	const blend = deriveLegacyBlendBehavior({
		surfaceType: recipe.surfaceType,
		opacity,
		isClipMap,
	});
	return {
		color: [diffuse, diffuse, diffuse],
		emissive: [1, 1, 1],
		emissiveIntensity: luminosity,
		opacity,
		transparent: blend.enabled,
		alphaTest,
		side: "front",
		blend,
		unsupportedSurfaceFlags: unsupportedSurfaceFlags(recipe.surfaceType),
	};
}

export function isBase1ClipMapSurface(surfaceType: number): boolean {
	return hasSurfaceFlag(surfaceType, SURFACE_TYPE_BASE1_CLIP_MAP);
}

function unsupportedSurfaceFlags(surfaceType: number): string[] {
	const unsupported: string[] = [];
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_DETAIL)) {
		unsupported.push("Detail");
	}
	return unsupported;
}

function deriveLegacyBlendBehavior(options: {
	surfaceType: number;
	opacity: number;
	isClipMap: boolean;
}): LegacyMaterialBlendBehaviorDto {
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_TRANSLUCENT)) {
		return {
			mode: "translucent",
			enabled: true,
			srcFactor: "src-alpha",
			dstFactor: "one-minus-src-alpha",
			depthWrite: false,
		};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ALPHA)) {
		return hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)
			? {
					mode: "alpha-additive",
					enabled: true,
					srcFactor: "src-alpha",
					dstFactor: "one",
					depthWrite: false,
				}
			: {
					mode: "alpha",
					enabled: true,
					srcFactor: "src-alpha",
					dstFactor: "one-minus-src-alpha",
					depthWrite: false,
				};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_INV_ALPHA)) {
		return hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)
			? {
					mode: "inverse-alpha-additive",
					enabled: true,
					srcFactor: "one-minus-src-alpha",
					dstFactor: "one",
					depthWrite: false,
				}
			: {
					mode: "inverse-alpha",
					enabled: true,
					srcFactor: "one-minus-src-alpha",
					dstFactor: "src-alpha",
					depthWrite: false,
				};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)) {
		return {
			mode: "additive",
			enabled: true,
			srcFactor: "one",
			dstFactor: "one",
			depthWrite: false,
		};
	}
	if (options.isClipMap) {
		return {
			mode: "clipmap",
			enabled: true,
			srcFactor: "one",
			dstFactor: "one-minus-src-alpha",
			depthWrite: true,
		};
	}
	if (options.opacity < 1) {
		return {
			mode: "translucent",
			enabled: true,
			srcFactor: "src-alpha",
			dstFactor: "one-minus-src-alpha",
			depthWrite: false,
		};
	}
	return {
		mode: "opaque",
		enabled: false,
		srcFactor: null,
		dstFactor: null,
		depthWrite: true,
	};
}

function clipMapAlphaTest(options: {
	isClipMap: boolean;
	isTranslucent: boolean;
	hasSourceAlpha: boolean;
	usesIndexedClipDiscard: boolean;
}): number {
	if (!options.isClipMap || options.isTranslucent) {
		return 0;
	}
	if (options.usesIndexedClipDiscard) {
		return INDEXED_CLIP_MAP_ALPHA_TEST;
	}
	return options.hasSourceAlpha ? DIRECT_CLIP_MAP_ALPHA_TEST : 0;
}

function normalizeLegacyOpacity(translucency: number): number {
	const normalized =
		translucency > 1
			? 1 - Math.min(translucency, LEGACY_OPACITY_BYTE_SCALE) / BYTE_MAX
			: 1 - translucency;
	return clampUnit(normalized);
}

function hasSurfaceFlag(surfaceType: number, flag: number): boolean {
	return (surfaceType & flag) === flag;
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function clampNonNegative(value: number): number {
	return Math.max(0, value);
}
