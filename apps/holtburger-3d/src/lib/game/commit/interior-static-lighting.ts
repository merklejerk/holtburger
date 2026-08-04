import { transformPoint3 } from "../math/matrices";
import { type Mat4, Vec3 } from "../math/types";
import type {
	PlacedStaticLight,
	ResolvedObjectLight,
} from "../resolution/presentation";
import { pointLightFalloff } from "../environment/point-light-falloff";

export type { PlacedStaticLight };

/**
 * Retail scales an authored light's falloff by this before using it as the burn-in cutoff
 * radius (`static_light_factor`, acclient.c:44703).
 */
export const STATIC_LIGHT_RANGE_SCALE = 1.3;

/** Compose one object's authored lights with its placement into landblock space. */
export function placeObjectLights(
	lights: readonly ResolvedObjectLight[],
	objectToLandblock: Mat4,
	into: PlacedStaticLight[],
): void {
	for (const light of lights) {
		into.push({
			position: transformPoint3(
				objectToLandblock,
				light.offset,
				new Vec3(0, 0, 0),
			),
			color: light.color,
			intensity: light.intensity,
			falloff: light.falloff,
		});
	}
}

/**
 * Bake landblock-space static lights into per-vertex RGB for one geometry.
 *
 * Reproduces retail's `SetStaticLightingVertexColors` / `calc_point_light` exactly, including
 * its per-channel clamp to the light's own color and its use of unnormalized vectors. Returns
 * null when no light reaches the geometry, which then carries no baked attribute at all.
 *
 * Retail bakes with the union of nearby visible cells' lights rather than only the owning
 * cell's (`add_static_to_global_lights` over `visible_cell_table`, acclient.c:335800), which is
 * what lets light spill through doorways. Callers pass every light in the landblock and rely on
 * the range cutoff, which is equivalent for static content.
 */
export function bakeStaticLight(
	positions: Float32Array,
	normals: Float32Array,
	localToLandblock: Mat4,
	lights: readonly PlacedStaticLight[],
): Float32Array | null {
	if (lights.length === 0) return null;
	const vertexCount = Math.floor(positions.length / 3);
	const baked = new Float32Array(vertexCount * 3);
	const vertex = new Vec3(0, 0, 0);
	const landblockVertex = new Vec3(0, 0, 0);
	let anyContribution = false;
	for (let index = 0; index < vertexCount; index += 1) {
		const offset = index * 3;
		vertex.x = positions[offset]!;
		vertex.y = positions[offset + 1]!;
		vertex.z = positions[offset + 2]!;
		transformPoint3(localToLandblock, vertex, landblockVertex);
		// Normals are rotated, not translated, and retail never renormalizes them here.
		const normalX =
			localToLandblock.m11 * normals[offset]! +
			localToLandblock.m21 * normals[offset + 1]! +
			localToLandblock.m31 * normals[offset + 2]!;
		const normalY =
			localToLandblock.m12 * normals[offset]! +
			localToLandblock.m22 * normals[offset + 1]! +
			localToLandblock.m32 * normals[offset + 2]!;
		const normalZ =
			localToLandblock.m13 * normals[offset]! +
			localToLandblock.m23 * normals[offset + 1]! +
			localToLandblock.m33 * normals[offset + 2]!;
		let red = 0;
		let green = 0;
		let blue = 0;
		for (const light of lights) {
			const scale = pointLightFalloff(
				light.position.x - landblockVertex.x,
				light.position.y - landblockVertex.y,
				light.position.z - landblockVertex.z,
				normalX,
				normalY,
				normalZ,
				light.falloff * STATIC_LIGHT_RANGE_SCALE,
				light.intensity,
			);
			if (scale <= 0) continue;
			red += Math.min(scale * light.color.red, light.color.red);
			green += Math.min(scale * light.color.green, light.color.green);
			blue += Math.min(scale * light.color.blue, light.color.blue);
		}
		if (red > 0 || green > 0 || blue > 0) anyContribution = true;
		baked[offset] = Math.min(red, 1);
		baked[offset + 1] = Math.min(green, 1);
		baked[offset + 2] = Math.min(blue, 1);
	}
	return anyContribution ? baked : null;
}
