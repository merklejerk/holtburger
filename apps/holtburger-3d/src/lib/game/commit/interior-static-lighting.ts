import { transformPoint3 } from "../math/matrices";
import { type Mat4, Vec3 } from "../math/types";
import type { ResolvedObjectLight } from "../resolution/presentation";

/**
 * Retail scales an authored light's falloff by this before using it as the burn-in cutoff
 * radius (`static_light_factor`, acclient.c:44703).
 */
export const STATIC_LIGHT_RANGE_SCALE = 1.3;

/**
 * Half-Lambert wrap constants from `calc_point_light` (acclient.c:434220).
 *
 * Retail computes `(0.5 * distance + dot(normal, delta)) / 1.5` using the *unnormalized*
 * light delta, which is why a zero normal still yields a direction-independent glow.
 */
const WRAP_DISTANCE_SCALE = 0.5;
const WRAP_DIVISOR = 1.5;

/** One authored light placed in landblock space, ready to light any cell in that landblock. */
export interface PlacedStaticLight {
	/**
	 * Landblock-space position as plain components: these cross a worker boundary, where
	 * structured clone drops class prototypes.
	 */
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
	readonly intensity: number;
	/** Authored falloff; the effective cutoff is this times `STATIC_LIGHT_RANGE_SCALE`. */
	readonly falloff: number;
}

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
 * null when no light reaches the geometry, so unlit geometry carries no attribute at all.
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
			const deltaX = light.position.x - landblockVertex.x;
			const deltaY = light.position.y - landblockVertex.y;
			const deltaZ = light.position.z - landblockVertex.z;
			const distanceSquared =
				deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
			const distance = Math.sqrt(distanceSquared);
			const range = light.falloff * STATIC_LIGHT_RANGE_SCALE;
			if (distance >= range) continue;
			const wrapped =
				(WRAP_DISTANCE_SCALE * distance +
					(normalX * deltaX + normalY * deltaY + normalZ * deltaZ)) /
				WRAP_DIVISOR;
			if (wrapped <= 0) continue;
			const attenuation =
				distanceSquared <= 1
					? wrapped / distance
					: wrapped / (distanceSquared * distance);
			const scale = attenuation * (1 - distance / range) * light.intensity;
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
