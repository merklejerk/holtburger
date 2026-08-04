/**
 * Retail scales an authored falloff by `rangeAdjust` to get a hardware light's reach
 * (`config_hardware_light`, acclient.c:432899; `rangeAdjust`, acclient.c:44671).
 *
 * The interior bake uses a different scale (`static_light_factor`, 1.3) because retail did, so
 * range is always computed by the caller and passed in already scaled.
 */
export const RUNTIME_LIGHT_RANGE_SCALE = 1.5;

/**
 * Cap on simultaneously evaluated dynamic lights.
 *
 * Retail budgets `max_dynamic_lights = 7` (acclient.c:44527) across eight hardware slots, one of
 * which the sun occupies. Eight keeps a round number with headroom; overflow drops the farthest
 * light rather than failing, per North Star 5.
 */
export const MAX_DYNAMIC_LIGHTS = 8;

/** One point light evaluated at draw time, in anchor-relative space with its reach resolved. */
export interface RuntimeLight {
	readonly position: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly color: {
		readonly red: number;
		readonly green: number;
		readonly blue: number;
	};
	/** Effective reach, with the caller's range scale already applied. */
	readonly range: number;
	readonly intensity: number;
}

/** Result of fitting a candidate light list into a fixed budget. */
export interface SelectedLights {
	readonly lights: readonly RuntimeLight[];
	/**
	 * Lights that did not fit. Dropping is normal operation rather than an error, so this exists
	 * to make the budget observable, not to be asserted on.
	 */
	readonly dropped: number;
}

/**
 * Keep the lights nearest a viewpoint and report how many did not fit.
 *
 * Mirrors retail's `Render::insert_light` (acclient.c:364013): rank by squared distance, keep the
 * nearest, discard the rest. Selection is what makes a cap graceful — without it an overflow drops
 * whatever happened to be gathered last, which could discard the light directly in front of the
 * camera while keeping one across the landblock.
 *
 * Distance only. A light behind the camera still illuminates what is in front of it, so there is
 * deliberately no visibility test here.
 */
export function selectNearestLights(
	candidates: readonly RuntimeLight[],
	viewpoint: { readonly x: number; readonly y: number; readonly z: number },
	cap: number,
): SelectedLights {
	if (cap < 0) throw new Error("Light selection cap must not be negative.");
	if (candidates.length <= cap) {
		return { lights: candidates, dropped: 0 };
	}
	const ranked = [...candidates].sort(
		(left, right) =>
			squaredDistance(left.position, viewpoint) -
			squaredDistance(right.position, viewpoint),
	);
	return {
		lights: ranked.slice(0, cap),
		dropped: ranked.length - cap,
	};
}

function squaredDistance(
	light: { readonly x: number; readonly y: number; readonly z: number },
	viewpoint: { readonly x: number; readonly y: number; readonly z: number },
): number {
	const dx = light.x - viewpoint.x;
	const dy = light.y - viewpoint.y;
	const dz = light.z - viewpoint.z;
	return dx * dx + dy * dy + dz * dz;
}
