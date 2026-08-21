import { Vec3 } from "../math/types";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { type ResolvedSceneLighting } from "./scene-environment";

/**
 * Retail scales the sun's magnitude by this and adds it to the ambient level to form the
 * world ambient that lights meshes (`LScape::calc_object_light`, acclient.c:140248). Terrain
 * deliberately does not receive the boost: its software path reads `LScape::ambient_level`
 * directly (`CLandBlockStruct::calc_lighting`, acclient.c:339136).
 */
export const OBJECT_AMBIENT_SUN_SCALE = 0.2;

/**
 * Ambient retail forces while the camera occupies a cell that cannot see outdoors
 * (acclient.c:140521). Flat, white, and independent of time of day.
 */
export const SEALED_INTERIOR_AMBIENT = {
	level: 0.2,
	color: { red: 1, green: 1, blue: 1, alpha: 1 },
} as const;

/**
 * Which retail lighting policy a draw follows.
 *
 * Retail expresses this as per-pass state rather than per-object data: landscape draws with
 * fixed-function lighting off and its own baked vertex colors, outdoor meshes draw with the
 * sun enabled (`Render::useSunlightSet(1)`), and the cell pass disables the sun entirely
 * (`useSunlightSet(0)`, acclient.c:441094-441234).
 */
export type SceneLightingRole =
	| "terrain"
	| "outdoor-object"
	| "interior-object";

/** One frame's lighting for every draw role, derived once to keep draw loops allocation-free. */
export type SceneLightingByRole = Readonly<
	Record<SceneLightingRole, ResolvedSceneLighting>
>;

/**
 * Derive every draw role's lighting from one frame's resolved regional lighting.
 *
 * This covers only the sun and ambient terms. Dynamic lights are frame-global rather than
 * per-role, so the renderer binds them separately and they reach every draw.
 */
export function resolveSceneLightingByRole(
	lighting: ResolvedSceneLighting,
	cameraInsideSealedCell = false,
): SceneLightingByRole {
	const objectAmbientLevel =
		Math.hypot(
			lighting.sunVector.x,
			lighting.sunVector.y,
			lighting.sunVector.z,
		) *
			OBJECT_AMBIENT_SUN_SCALE +
		lighting.ambientLevel;
	return {
		terrain: lighting,
		"outdoor-object": { ...lighting, ambientLevel: objectAmbientLevel },
		"interior-object": {
			...lighting,
			ambientLevel: cameraInsideSealedCell
				? SEALED_INTERIOR_AMBIENT.level
				: objectAmbientLevel,
			ambientColor: cameraInsideSealedCell
				? SEALED_INTERIOR_AMBIENT.color
				: lighting.ambientColor,
			// Retail's cell pass runs with the sun disabled; a zero vector removes the
			// diffuse term without needing a second shader or a branch.
			sunVector: ZERO_SUN,
		},
	};
}

/**
 * How much of an authored outdoor lamp survives the current daylight, in [0, 1].
 *
 * Retail never had to answer this: its outdoor pass binds only the sun, so authored lamps cast
 * nothing at any hour. Lighting outdoor geometry with them is our deliberate deviation, which
 * makes the daytime half of the policy ours to define — and a lamp that pins midday ground to
 * full white is what happens without one.
 *
 * The signal is what an up-facing terrain surface already receives, since that is the surface the
 * artifact appears on. Applies to authored lamps only: the viewer light is gameplay lighting and
 * keeps working at any hour.
 *
 * Bottoms out at `minimumResponse` rather than zero: lamps that fade to nothing read as being
 * switched off at dawn.
 */
export function resolveAuthoredLightResponse(
	lighting: ResolvedSceneLighting,
): number {
	// Terrain normals point up, so the sun's own up component is its diffuse term there.
	const sun = Math.max(lighting.sunVector.y, 0);
	const brightness = relativeLuminance(
		lighting.ambientLevel * lighting.ambientColor.red +
			sun * lighting.sunColor.red,
		lighting.ambientLevel * lighting.ambientColor.green +
			sun * lighting.sunColor.green,
		lighting.ambientLevel * lighting.ambientColor.blue +
			sun * lighting.sunColor.blue,
	);
	const { fullResponseBrightness, minimumResponseBrightness, minimumResponse } =
		FRONTEND_TUNING.rendering.outdoorAuthoredLights;
	const ramp = Math.min(
		1,
		Math.max(
			0,
			(brightness - fullResponseBrightness) /
				(minimumResponseBrightness - fullResponseBrightness),
		),
	);
	// Smoothstep rather than linear, so lamps neither pop out at dusk nor linger flat at noon.
	const faded = 1 - ramp * ramp * (3 - 2 * ramp);
	return minimumResponse + (1 - minimumResponse) * faded;
}

/**
 * Rec. 601 luma weights, matching how the eye weights the channels these values are judged by.
 *
 * Exported so presentation-side color grading weights channels identically; two independent luma
 * definitions would drift apart the first time either is tuned.
 */
export const REC_601_LUMA_WEIGHTS = {
	red: 0.299,
	green: 0.587,
	blue: 0.114,
} as const;

/** Rec. 601 luma, matching how the eye weights the channels this lighting is judged by. */
export function relativeLuminance(
	red: number,
	green: number,
	blue: number,
): number {
	return (
		REC_601_LUMA_WEIGHTS.red * red +
		REC_601_LUMA_WEIGHTS.green * green +
		REC_601_LUMA_WEIGHTS.blue * blue
	);
}

/** Map one object contribution's source onto its retail lighting policy. */
export function objectLightingRole(
	source:
		| "outdoor"
		| "generated"
		| "env-cell-shell"
		| "env-cell-resident"
		| "dynamic",
): SceneLightingRole {
	return source === "env-cell-shell" || source === "env-cell-resident"
		? "interior-object"
		: "outdoor-object";
}

const ZERO_SUN = Vec3.zero();
