import { Color, type MeshStandardMaterialParameters } from "three";

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

export interface LegacyMaterialBehavior {
	color: Color;
	emissive: Color;
	emissiveIntensity: number;
	opacity: number;
	transparent: boolean;
	alphaTest: number;
	unsupportedSurfaceFlags: string[];
}

export function deriveLegacyMaterialBehavior(options: {
	recipe: PreparedMaterialRecipePayload;
	hasSourceAlpha?: boolean;
	usesIndexedClipDiscard?: boolean;
}): LegacyMaterialBehavior {
	const recipe = options.recipe;
	const opacity = normalizeLegacyOpacity(recipe.translucency);
	const diffuse = hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_DIFFUSE)
		? clampUnit(recipe.diffuse)
		: 1;
	const luminosity = hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_LUMINOUS)
		? clampNonNegative(recipe.luminosity)
		: 0;
	const isClipMap = isBase1ClipMapSurface(recipe.surfaceType);
	const alphaTest = clipMapAlphaTest({
		isClipMap,
		hasSourceAlpha: !!options.hasSourceAlpha,
		usesIndexedClipDiscard: !!options.usesIndexedClipDiscard,
	});
	return {
		color: new Color(diffuse, diffuse, diffuse),
		emissive: new Color(1, 1, 1),
		emissiveIntensity: luminosity,
		opacity,
		transparent:
			opacity < 1 ||
			hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_TRANSLUCENT) ||
			hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_ALPHA) ||
			(hasSurfaceFlag(recipe.surfaceType, SURFACE_TYPE_ADDITIVE) &&
				opacity < 1),
		alphaTest,
		unsupportedSurfaceFlags: unsupportedSurfaceFlags(recipe.surfaceType),
	};
}

export function applyLegacyMaterialBehavior(
	parameters: MeshStandardMaterialParameters,
	behavior: LegacyMaterialBehavior,
): MeshStandardMaterialParameters {
	return {
		...parameters,
		color: parameters.color ?? behavior.color,
		emissive: behavior.emissive,
		emissiveIntensity: behavior.emissiveIntensity,
		transparent: behavior.transparent,
		opacity: behavior.opacity,
		alphaTest: behavior.alphaTest,
	};
}

export function isBase1ClipMapSurface(surfaceType: number): boolean {
	return hasSurfaceFlag(surfaceType, SURFACE_TYPE_BASE1_CLIP_MAP);
}

function unsupportedSurfaceFlags(surfaceType: number): string[] {
	const unsupported: string[] = [];
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_INV_ALPHA)) {
		unsupported.push("InvAlpha");
	}
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_ADDITIVE)) {
		unsupported.push("Additive");
	}
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_DETAIL)) {
		unsupported.push("Detail");
	}
	return unsupported;
}

function clipMapAlphaTest(options: {
	isClipMap: boolean;
	hasSourceAlpha: boolean;
	usesIndexedClipDiscard: boolean;
}): number {
	if (!options.isClipMap) {
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
