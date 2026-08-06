import { renderVector } from "../../assets/ac-frame";
import { bracketKeyframes } from "./keyframe-bracket";
import { quantizeDayFraction } from "./game-clock";
import { resolveSkyState } from "./sky-state";
import { RUNTIME_LIGHT_RANGE_SCALE } from "./runtime-lights";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { ResolvedSkyState } from "./sky-state";
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
/**
 * Retail's authored viewer-light constants (acclient.c:43910, 728925), with `rangeAdjust`
 * (acclient.c:44671) already folded in: a hardware light reaches `falloff * 1.5`
 * (`config_hardware_light`, acclient.c:432899).
 */
export const VIEWER_LIGHT = {
	/** Retail's authored falloff of 10, scaled by `rangeAdjust` like any hardware light. */
	range: 10 * RUNTIME_LIGHT_RANGE_SCALE,
	/**
	 * Recalibrated for the authored falloff, not retail's `0.5 * 4.5 = 2.25`.
	 *
	 * Retail's value was tuned against hardware `1/d`. The authored falloff we now use for every
	 * light is effectively inverse-square, so 2.25 would leave the headlamp roughly thirty times
	 * dimmer at ten units and useless past two. This value reproduces retail's contribution at the
	 * midpoint of the light's range, giving a saturated core out to about five units that tapers
	 * to nothing at fifteen.
	 */
	intensity: 34,
	/** `RGBColor::SetColor32(&viewer_light.color, 0xFFFFFFFF)`, acclient.c:139346. */
	color: { red: 1, green: 1, blue: 1 },
} as const;

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
	/**
	 * The active day group's celestial objects, resolved on the authored sky tick. Null only when
	 * the region authors no usable sky at all.
	 */
	readonly sky: ResolvedSkyState | null;
	/*
	 * SEAM: environment override (`AdminEnvirons`).
	 *
	 * Retail lets the server replace regional ambient and fog wholesale — the graveyard near
	 * `0x482E` and similar areas look distinct because of it. `LScape::m_override_enabled` and its
	 * ambient/fog companions are written from exactly one place,
	 * `CPlayerSystem::Handle_Admin__Environs` (acclient.c:379135), driven by a one-`uint` message:
	 * 0x00 clear, 0x01-0x06 fog presets, 0x65+ ambient sounds. It is landblock-scoped server-side
	 * (ACE's `LandblockManager.SetGlobalFogColor` plus `Landblock.SendCurrentEnviron`), so a world
	 * runtime can hold it as ordinary landblock state.
	 *
	 * Overridden ambient and fog need no new shape here — they resolve through `lighting`,
	 * `backgroundColor` and `distanceFog` as they already do. What this type will need is one more
	 * fact: **whether an override is currently active**, which the sky consumes independently of the
	 * resolved colours. Sky objects with `properties` bit 2 hide while an override is active with
	 * fog on (twenty shipped objects, one per day group), and the sky pass must stop forcing fog off
	 * in that case. The bit already rides through `ResolvedSkyObject.properties`; only the
	 * active-override fact is missing, and it is deliberately absent until something can set it.
	 */
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
	// Lighting and the sky sample the same clock at their own authored cadences: 15 s and 0.8 s in
	// the shipped region. Sampling the sky at the lighting tick would step the fastest authored sun
	// sweep in visible ~1.8 degree jumps.
	const dayLength = activeRegion.data.calendar.dayLength;
	const keyframes = bracketKeyframes(
		dayGroup.skyTimes,
		quantizeDayFraction(selection.timeOfDay, sky.lightTickSize, dayLength),
	);
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
		sky: resolveSkyState(
			dayGroup,
			dayGroupIndex,
			quantizeDayFraction(selection.timeOfDay, sky.tickSize, dayLength),
		),
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
