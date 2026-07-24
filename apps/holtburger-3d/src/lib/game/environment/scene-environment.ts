import type { ActiveRegionSource } from "../../assets/active-region-source";

/** Explorer-owned inputs selecting one static regional presentation state. */
export interface ExplorerEnvironmentSelection {
	/** Absolute regional calendar day; it may span multiple authored years. */
	readonly dayIndex: number;
	/** Normalized regional day fraction in [0, 1). */
	readonly timeOfDay: number;
	/** Explicit static sky-day-group index, or retail-compatible automatic selection. */
	readonly dayGroupOverride: number | null;
}

/** RGBA color normalized for renderer frame input. */
export interface SceneColor {
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

/** Renderer-ready regional state resolved entirely in the frontend. */
export interface ResolvedSceneEnvironment {
	readonly backgroundColor: SceneColor;
	readonly distanceFog: ResolvedDistanceFog | null;
	/** Stable sky selection retained for a future sky pass. */
	readonly sky: {
		readonly dayGroupIndex: number;
		readonly dayGroupName: string;
	} | null;
	/** Stable lighting facts retained for future terrain/object lighting. */
	readonly lighting: {
		readonly ambientColor: SceneColor;
		readonly ambientBrightness: number;
	} | null;
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
		return {
			backgroundColor: BLACK,
			distanceFog: null,
			sky: null,
			lighting: null,
		};
	}
	const dayGroupIndex = resolveDayGroupIndex(activeRegion, selection);
	const dayGroup = sky.dayGroups[dayGroupIndex];
	if (dayGroup === undefined || dayGroup.skyTimes.length === 0) {
		return {
			backgroundColor: BLACK,
			distanceFog: null,
			sky: null,
			lighting: null,
		};
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
		lighting: {
			ambientColor: backgroundColor,
			ambientBrightness: lerp(
				keyframes.before.ambientBrightness,
				keyframes.after.ambientBrightness,
				keyframes.ratio,
			),
		},
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
