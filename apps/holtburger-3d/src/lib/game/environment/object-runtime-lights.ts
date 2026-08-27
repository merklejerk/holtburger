import { sceneVec3 } from "../../assets/ac-frame";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { placeObjectLights } from "../commit/interior-static-lighting";
import type { LandblockOwnerId } from "../game-types";
import { createLandblockWorldOrigin } from "../landblocks";
import type { Mat4 } from "../math/types";
import { Vec3 } from "../math/types";
import type { ResolvedObjectLight } from "../resolution/presentation";
import { RUNTIME_LIGHT_RANGE_SCALE, type RuntimeLight } from "./runtime-lights";

/** Compose setup-authored object lights into canonical scene space for draw-time evaluation. */
export function resolveObjectRuntimeLights(
	lights: readonly ResolvedObjectLight[],
	objectToLandblock: Mat4,
	landblockId: LandblockOwnerId,
): readonly RuntimeLight[] {
	const origin = createLandblockWorldOrigin(landblockId);
	const placed: Parameters<typeof placeObjectLights>[2] = [];
	placeObjectLights(lights, objectToLandblock, placed);
	return placed.map((light) => ({
		position: sceneVec3(
			new Vec3(
				light.position.x + origin.x,
				light.position.y,
				light.position.z + origin.z,
			),
		),
		color: light.color,
		range: light.falloff * RUNTIME_LIGHT_RANGE_SCALE,
		// Authored intensity uses the same draw-time response whether the owner is static or dynamic.
		intensity:
			light.intensity *
			FRONTEND_TUNING.rendering.outdoorAuthoredLights.intensityScale,
	}));
}
