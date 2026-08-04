import { renderVector } from "../../assets/ac-frame";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { Vec3 } from "../math/types";

/**
 * Retail's ambient floor (`LScape::min_ambient`, acclient.c:747815). Applied after keyframe
 * interpolation so authored night values never drive the world fully black.
 */
export const MINIMUM_AMBIENT_LEVEL = 0.2;

/**
 * Retail's lighting when a day group authors no keyframes (`SkyDesc::GetLighting`,
 * acclient.c:290949): mid ambient, white light, and a fixed low sun.
 */
export const UNAUTHORED_LIGHTING = {
	ambientLevel: 0.3,
	sunDirection: { x: 0.5, y: 0, z: 0.8 },
} as const;

/** Explorer-owned inputs selecting one static regional presentation state. */
export interface ExplorerEnvironmentSelection {
	/** Absolute regional calendar day; it may span multiple authored years. */
	readonly dayIndex: number;
	/** Normalized regional day fraction in [0, 1). */
	readonly timeOfDay: number;
	/** Explicit static sky-day-group index, or retail-compatible automatic selection. */
	readonly dayGroupOverride: number | null;
}

/** One authored sky keyframe from the active region's selected day group. */
type SkyKeyframe = NonNullable<
	ActiveRegionSource["data"]["sky"]
>["dayGroups"][number]["skyTimes"][number];

/** RGBA color normalized for renderer frame input. */
interface SceneColor {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
	readonly alpha: number;
}

/** Optional distance-fog state shared by clear and terrain passes. */
export interface ResolvedDistanceFog {
	readonly near: number;
	readonly far: number;
	readonly color: SceneColor;
}

/**
 * Regional sun and ambient resolved from authored sky keyframes.
 *
 * These are the raw regional facts. Per-draw policy — the interior ambient override, the
 * outdoor object ambient formula, and which draws see the sun at all — belongs to the
 * renderer's lighting context, not here.
 */
export interface ResolvedSceneLighting {
	/** Interpolated ambient level, floored at `MINIMUM_AMBIENT_LEVEL`. */
	readonly ambientLevel: number;
	readonly ambientColor: SceneColor;
	/**
	 * Sun direction in render axes, deliberately left unnormalized: its magnitude carries the
	 * authored directional brightness, exactly as retail's `SkyDesc::GetLighting` builds it
	 * (acclient.c:290949). Consumers multiply by it rather than applying brightness separately.
	 */
	readonly sunVector: Vec3;
	readonly sunColor: SceneColor;
}

/** Renderer-ready regional state resolved entirely in the frontend. */
export interface ResolvedSceneEnvironment {
	readonly backgroundColor: SceneColor;
	readonly distanceFog: ResolvedDistanceFog | null;
	/** Stable sky selection retained for a future sky pass. */
	readonly sky: {
		readonly dayGroupIndex: number;
		readonly dayGroupName: string;
	} | null;
	/**
	 * Always present: a region without authored sky keyframes still lights the world, using
	 * retail's unauthored-lighting fallback rather than going dark.
	 */
	readonly lighting: ResolvedSceneLighting;
}

/** Resolve Explorer-selected static sky state using retail's cyclic keyframe rules. */
export function resolveSceneEnvironment(
	activeRegion: ActiveRegionSource,
	selection: ExplorerEnvironmentSelection,
): ResolvedSceneEnvironment {
	if (!Number.isInteger(selection.dayIndex) || selection.dayIndex < 0) {
		throw new Error(
			"Explorer environment day index must be a non-negative integer.",
		);
	}
	if (
		!Number.isFinite(selection.timeOfDay) ||
		selection.timeOfDay < 0 ||
		selection.timeOfDay >= 1
	) {
		throw new Error(
			"Explorer environment time of day must be normalized to [0, 1).",
		);
	}
	const sky = activeRegion.data.sky;
	if (sky === null || sky.dayGroups.length === 0) {
		return UNAUTHORED_ENVIRONMENT;
	}
	const dayGroupIndex = resolveDayGroupIndex(activeRegion, selection);
	const dayGroup = sky.dayGroups[dayGroupIndex];
	if (dayGroup === undefined || dayGroup.skyTimes.length === 0) {
		return UNAUTHORED_ENVIRONMENT;
	}
	const keyframes = bracketKeyframes(dayGroup.skyTimes, selection.timeOfDay);
	const backgroundColor = lerpColor(
		unpackColor(keyframes.before.ambientColor),
		unpackColor(keyframes.after.ambientColor),
		keyframes.ratio,
	);
	const distanceFog =
		keyframes.before.worldFog !== 0 && keyframes.after.worldFog !== 0
			? {
					near: lerp(
						keyframes.before.minWorldFog,
						keyframes.after.minWorldFog,
						keyframes.ratio,
					),
					far: lerp(
						keyframes.before.maxWorldFog,
						keyframes.after.maxWorldFog,
						keyframes.ratio,
					),
					color: lerpColor(
						unpackColor(keyframes.before.worldFogColor),
						unpackColor(keyframes.after.worldFogColor),
						keyframes.ratio,
					),
				}
			: null;
	return {
		backgroundColor,
		distanceFog,
		sky: { dayGroupIndex, dayGroupName: dayGroup.dayName },
		lighting: resolveLighting(keyframes),
	};
}

/**
 * Reproduce retail's `SkyDesc::GetLighting` (acclient.c:290949): interpolate the bracketing
 * keyframes, then fold the directional brightness into the sun vector's length.
 */
function resolveLighting(keyframes: {
	readonly before: SkyKeyframe;
	readonly after: SkyKeyframe;
	readonly ratio: number;
}): ResolvedSceneLighting {
	const { before, after, ratio } = keyframes;
	const brightness = lerp(
		before.directionalBrightness,
		after.directionalBrightness,
		ratio,
	);
	const heading = degreesToRadians(
		lerp(before.directionalHeading, after.directionalHeading, ratio),
	);
	const pitch = degreesToRadians(
		lerp(before.directionalPitch, after.directionalPitch, ratio),
	);
	return {
		ambientLevel: Math.max(
			lerp(before.ambientBrightness, after.ambientBrightness, ratio),
			MINIMUM_AMBIENT_LEVEL,
		),
		ambientColor: lerpColor(
			unpackColor(before.ambientColor),
			unpackColor(after.ambientColor),
			ratio,
		),
		sunVector: renderVector(
			Math.sin(heading) * Math.cos(pitch) * brightness,
			Math.cos(heading) * Math.cos(pitch) * brightness,
			Math.sin(pitch) * brightness,
		),
		sunColor: lerpColor(
			unpackColor(before.directionalColor),
			unpackColor(after.directionalColor),
			ratio,
		),
	};
}

function resolveDayGroupIndex(
	activeRegion: ActiveRegionSource,
	selection: ExplorerEnvironmentSelection,
): number {
	const count = activeRegion.data.sky?.dayGroups.length ?? 0;
	if (selection.dayGroupOverride !== null) {
		if (
			!Number.isInteger(selection.dayGroupOverride) ||
			selection.dayGroupOverride < 0 ||
			selection.dayGroupOverride >= count
		) {
			throw new Error(
				"Explorer day-group override is outside the active region.",
			);
		}
		return selection.dayGroupOverride;
	}
	const daysPerYear = activeRegion.data.calendar.daysPerYear;
	if (daysPerYear <= 0)
		throw new Error("Active-region calendar has no days per year.");
	const year =
		activeRegion.data.calendar.zeroYear +
		Math.floor(selection.dayIndex / daysPerYear);
	const day = selection.dayIndex % daysPerYear;
	const seed = (day + year * daysPerYear) >>> 0;
	const hash = (Math.imul(1_782_775_218, seed) - 1_967_253_934) >>> 0;
	return Math.floor((hash / 0x1_0000_0000) * count);
}

function bracketKeyframes<T extends { readonly begin: number }>(
	keyframes: readonly T[],
	timeOfDay: number,
): { readonly before: T; readonly after: T; readonly ratio: number } {
	const ordered = [...keyframes].sort(
		(left, right) => left.begin - right.begin,
	);
	let before = ordered.at(-1);
	let after = ordered[0];
	if (before === undefined || after === undefined)
		throw new Error("Sky day group has no keyframes.");
	for (const keyframe of ordered) {
		if (keyframe.begin <= timeOfDay) before = keyframe;
		if (keyframe.begin > timeOfDay) {
			after = keyframe;
			break;
		}
	}
	const beforeTime = before.begin;
	const afterTime = after.begin <= beforeTime ? after.begin + 1 : after.begin;
	const currentTime = timeOfDay < beforeTime ? timeOfDay + 1 : timeOfDay;
	return {
		before,
		after,
		ratio: (currentTime - beforeTime) / (afterTime - beforeTime),
	};
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function unpackColor(color: number): SceneColor {
	return {
		red: (color & 0xff) / 0xff,
		green: ((color >>> 8) & 0xff) / 0xff,
		blue: ((color >>> 16) & 0xff) / 0xff,
		alpha: 1,
	};
}

function lerp(start: number, end: number, ratio: number): number {
	return start + (end - start) * ratio;
}

function lerpColor(
	start: SceneColor,
	end: SceneColor,
	ratio: number,
): SceneColor {
	return {
		red: lerp(start.red, end.red, ratio),
		green: lerp(start.green, end.green, ratio),
		blue: lerp(start.blue, end.blue, ratio),
		alpha: 1,
	};
}

const BLACK: SceneColor = { red: 0, green: 0, blue: 0, alpha: 1 };
const WHITE: SceneColor = { red: 1, green: 1, blue: 1, alpha: 1 };

/** Retail's lighting for a region or day group that authors no usable sky keyframes. */
export const UNAUTHORED_SCENE_LIGHTING: ResolvedSceneLighting = {
	ambientLevel: UNAUTHORED_LIGHTING.ambientLevel,
	ambientColor: WHITE,
	sunVector: renderVector(
		UNAUTHORED_LIGHTING.sunDirection.x,
		UNAUTHORED_LIGHTING.sunDirection.y,
		UNAUTHORED_LIGHTING.sunDirection.z,
	),
	sunColor: WHITE,
};

const UNAUTHORED_ENVIRONMENT: ResolvedSceneEnvironment = {
	backgroundColor: BLACK,
	distanceFog: null,
	sky: null,
	lighting: UNAUTHORED_SCENE_LIGHTING,
};
