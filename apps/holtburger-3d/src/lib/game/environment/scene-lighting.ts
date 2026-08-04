import { Vec3 } from "../math/types";
import { type ResolvedSceneLighting } from "./scene-environment";

/**
 * Retail scales the sun's magnitude by this and adds it to the ambient level to form the
 * world ambient that lights meshes (`LScape::calc_object_light`, acclient.c:140248). Terrain
 * deliberately does not receive the boost: its software path reads `LScape::ambient_level`
 * directly (`CLandBlockStruct::calc_lighting`, acclient.c:339136).
 */
export const OBJECT_AMBIENT_SUN_SCALE = 0.2;

/**
 * Which retail lighting policy a draw follows.
 *
 * Retail expresses this as per-pass state rather than per-object data: landscape draws with
 * fixed-function lighting off and its own baked vertex colors, outdoor meshes draw with the
 * sun enabled (`Render::useSunlightSet(1)`), and the cell pass disables the sun entirely
 * (`useSunlightSet(0)`, acclient.c:441094-441234).
 */
export type SceneLightingRole =
	"terrain" | "outdoor-object" | "interior-object";

/** One frame's lighting for every draw role, derived once to keep draw loops allocation-free. */
export type SceneLightingByRole = Readonly<
	Record<SceneLightingRole, ResolvedSceneLighting>
>;

/**
 * Derive every draw role's lighting from one frame's resolved regional lighting.
 *
 * `viewerLight` is supplied by the renderer rather than the environment because it tracks the
 * live camera. Retail likewise attaches it to the viewer every time the viewer moves
 * (`SmartBox::set_viewer`, acclient.c:137873) and only ever registers it as a dynamic light,
 * which is why it evaluates in the shader instead of being baked.
 */
export function resolveSceneLightingByRole(
	lighting: ResolvedSceneLighting,
	viewerLight: ResolvedSceneLighting["viewerLight"] = lighting.viewerLight,
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
		// Landscape is outdoors by definition and never receives the headlamp.
		terrain: { ...lighting, viewerLight: lighting.viewerLight },
		"outdoor-object": {
			...lighting,
			ambientLevel: objectAmbientLevel,
			viewerLight: lighting.viewerLight,
		},
		"interior-object": {
			...lighting,
			ambientLevel: objectAmbientLevel,
			viewerLight,
			// Retail's cell pass runs with the sun disabled; a zero vector removes the
			// diffuse term without needing a second shader or a branch.
			sunVector: ZERO_SUN,
		},
	};
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
