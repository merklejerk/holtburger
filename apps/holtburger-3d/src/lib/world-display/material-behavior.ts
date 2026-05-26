import {
	AddEquation,
	Color,
	CustomBlending,
	OneFactor,
	OneMinusSrcAlphaFactor,
	SrcAlphaFactor,
	type BlendingDstFactor,
	type BlendingSrcFactor,
	type MeshStandardMaterialParameters,
} from "three";

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
	blend: LegacyMaterialBlendBehavior;
	unsupportedSurfaceFlags: string[];
}

export interface LegacyMaterialBlendBehavior {
	mode: LegacyMaterialBlendMode;
	enabled: boolean;
	srcFactor: BlendingSrcFactor | null;
	dstFactor: BlendingDstFactor | null;
	depthWrite: boolean;
}

export type LegacyMaterialBlendMode =
	| "opaque"
	| "alpha"
	| "alpha-additive"
	| "inverse-alpha"
	| "inverse-alpha-additive"
	| "additive"
	| "clipmap"
	| "translucent";

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
		color: new Color(diffuse, diffuse, diffuse),
		emissive: new Color(1, 1, 1),
		emissiveIntensity: luminosity,
		opacity,
		transparent: blend.enabled,
		alphaTest,
		blend,
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
		depthWrite: behavior.blend.depthWrite,
		...(behavior.blend.enabled
			? {
					blending: CustomBlending,
					blendEquation: AddEquation,
					blendSrc: behavior.blend.srcFactor ?? SrcAlphaFactor,
					blendDst:
						behavior.blend.dstFactor ?? OneMinusSrcAlphaFactor,
				}
			: {}),
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
}): LegacyMaterialBlendBehavior {
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_TRANSLUCENT)) {
		return {
			mode: "translucent",
			enabled: true,
			srcFactor: SrcAlphaFactor,
			dstFactor: OneMinusSrcAlphaFactor,
			depthWrite: false,
		};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ALPHA)) {
		return hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)
			? {
					mode: "alpha-additive",
					enabled: true,
					srcFactor: SrcAlphaFactor,
					dstFactor: OneFactor,
					depthWrite: false,
				}
			: {
					mode: "alpha",
					enabled: true,
					srcFactor: SrcAlphaFactor,
					dstFactor: OneMinusSrcAlphaFactor,
					depthWrite: false,
				};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_INV_ALPHA)) {
		return hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)
			? {
					mode: "inverse-alpha-additive",
					enabled: true,
					srcFactor: OneMinusSrcAlphaFactor,
					dstFactor: OneFactor,
					depthWrite: false,
				}
			: {
					mode: "inverse-alpha",
					enabled: true,
					srcFactor: OneMinusSrcAlphaFactor,
					dstFactor: SrcAlphaFactor,
					depthWrite: false,
				};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)) {
		return {
			mode: "additive",
			enabled: true,
			srcFactor: OneFactor,
			dstFactor: OneFactor,
			depthWrite: false,
		};
	}
	if (options.isClipMap) {
		return {
			mode: "clipmap",
			enabled: true,
			srcFactor: OneFactor,
			dstFactor: OneMinusSrcAlphaFactor,
			depthWrite: true,
		};
	}
	if (options.opacity < 1) {
		return {
			mode: "translucent",
			enabled: true,
			srcFactor: SrcAlphaFactor,
			dstFactor: OneMinusSrcAlphaFactor,
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
