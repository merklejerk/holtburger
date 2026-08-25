import type { SceneVec3 } from "../../assets/ac-frame";
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

/**
 * Cap on simultaneously evaluated static lights for one landblock.
 *
 * The largest set any landblock owns in the archive is 51, and neighbour spill is bounded by a
 * roughly 22.5-unit band on a 192-unit edge, so 64 has real headroom. Overflow drops the farthest
 * light rather than failing.
 *
 * Uniform budget: both light arrays together declare `2 * 64 + 2 * 8 = 144` vec4 slots. The
 * binding constraint is the *fragment* stage, not the vertex stage, because terrain evaluates
 * point lights per pixel and so includes these declarations in its fragment shader. WebGL2
 * guarantees only 224 fragment uniform vectors against 256 vertex ones, so raising this cap eats
 * the tighter budget first.
 */
export const MAX_STATIC_LIGHTS = 64;

/**
 * One point light evaluated at draw time, with its reach already resolved.
 *
 * Positions are canonical scene space, the same frame landblock world origins live in. Shaders
 * work in anchor-relative space, so the bind subtracts the frame anchor's origin — one conversion
 * at one place, rather than each producer having to know the frame anchor.
 */
export interface RuntimeLight {
	readonly position: SceneVec3;
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
export interface FittedLights {
	readonly lights: readonly RuntimeLight[];
	/**
	 * Lights that did not fit. Dropping is normal operation rather than an error, so this exists
	 * to make the budget observable, not to be asserted on.
	 */
	readonly dropped: number;
}

/**
 * Fit candidate lights into a fixed shader budget, keeping the ones nearest the camera.
 *
 * Named for the job rather than for the rule: under budget this is a pass-through, and distance
 * only decides anything once there are more candidates than slots. "Selection" elsewhere in the
 * renderer means visibility culling, which this is not — a light that fits is bound whether or not
 * anything it reaches is on screen.
 *
 * Ranking is distance only. A light behind the camera still illuminates what is in front of it, so
 * there is deliberately no visibility test here. Without ranking, an overflow would drop whatever
 * happened to be gathered last, which could discard the light directly in front of the camera
 * while keeping one across the landblock.
 *
 * RETAIL DIVERGENCE: retail ranks the same way but measures from `Render::player_pos`
 * (`Render::insert_light`, acclient.c:364043), which is the player's own body
 * (acclient.c:138839) rather than the eye. We measure from the camera, because the frustum starts
 * there: with a third-person boom the body is metres from where the picture is taken, and the
 * lights that matter are the ones reaching visible pixels. "Correcting" it back to the carrier
 * would, on overflow, prefer lights behind the camera over lights in front of it. The two rank
 * identically except on overflow, which content cannot author: the static budget has documented
 * headroom over the archive's largest authored set (51 lights against `MAX_STATIC_LIGHTS`), so
 * only the `MAX_DYNAMIC_LIGHTS` slots can overflow, and only with more simultaneously lit entities
 * near the camera than there are slots.
 */
export function fitLightsToBudget(
	candidates: readonly RuntimeLight[],
	cameraPosition: SceneVec3,
	capacity: number,
): FittedLights {
	if (capacity < 0) throw new Error("Light budget must not be negative.");
	if (candidates.length <= capacity) {
		return { lights: candidates, dropped: 0 };
	}
	const ranked = [...candidates].sort(
		(left, right) =>
			left.position.distanceSquaredTo(cameraPosition) -
			right.position.distanceSquaredTo(cameraPosition),
	);
	return {
		lights: ranked.slice(0, capacity),
		dropped: ranked.length - capacity,
	};
}
