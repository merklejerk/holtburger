import { acVector3, acVectorToRender, sceneVector3 } from "../../assets/ac-frame";
import { behaviorTargetId } from "../behavior/behavior-event-router";
import { skyObjectOrigin } from "./sky-state";
import type { AcRotation, SceneVector3 } from "../../assets/ac-frame";
import type { BehaviorTargetId } from "../behavior/behavior-event-router";
import type { SkyPlacement } from "./sky-state";

/**
 * The only part index a sky object can author an emitter on.
 *
 * Every script-carrying sky Setup in the shipped region is a single part (`0x010001EC`), so part 0
 * is the object itself and no other index exists.
 */
export const SKY_OBJECT_ONLY_PART_INDEX = 0;

/**
 * A behavior target owned by the sky module rather than by the scene graph.
 *
 * Sky objects are viewer-centered: retail assigns them the viewer's own frame on every position
 * update (`GameSky::UpdatePosition`, acclient.c:297298), so their origin is a function of the
 * camera rather than a stored placement. The frame is therefore computed **on demand** instead of
 * pushed per frame — the particle runtime already polls origins for following emitters, so a pushed
 * value would only ever be pulled straight back out.
 *
 * This diverges from retail's *mechanism*, which really does give sky objects cell residency and
 * writes frames every update, while matching its observable behavior at the same cadence.
 */
export interface SkyBehaviorTarget {
	/** Current scene-frame origin, recomputed per read from the live camera. */
	readonly originOf: () => SceneVector3;
	/** Current orientation in AC's authored axes, from the object's `CalcFrame` pose. */
	readonly rotationOf: () => AcRotation;
}

/**
 * Mint the behavior target id for one sky object in one day group.
 *
 * Scoped by day group and authored index rather than by DAT id, because a day group can author the
 * same gfx id more than once and each instance runs its own script clock. The sky's own namespace,
 * disjoint from the scene's `scene-node:` ids by construction.
 */
export function skyBehaviorTargetId(
	dayGroupIndex: number,
	objectIndex: number,
): BehaviorTargetId {
	return behaviorTargetId(`sky-object:${dayGroupIndex}:${objectIndex}`);
}

/**
 * Build the frame provider for one resolved sky object.
 *
 * `viewerOrigin` is read per call rather than captured, so the target follows the camera without
 * anything having to write to it.
 */
export function createSkyBehaviorTarget(
	placement: SkyPlacement,
	orientation: readonly [number, number, number, number],
	viewerOrigin: () => SceneVector3,
): SkyBehaviorTarget {
	const rotation = skyOrientationRotation(orientation);
	return {
		originOf: () => {
			const viewer = viewerOrigin();
			// The authored pin is expressed in AC axes against the viewer's height, so it is
			// resolved there and converted once rather than applied componentwise in render axes.
			const offset = acVectorToRender(
				acVector3([...skyObjectOrigin(placement, viewer[1])]),
			);
			return sceneVector3([
				viewer[0] + offset[0],
				viewer[1] + offset[1],
				viewer[2] + offset[2],
			]);
		},
		rotationOf: () => rotation,
	};
}

/**
 * Convert one sky object's authored frame quaternion into AC-axis basis columns.
 *
 * Sky orientations are fixed for the tick that resolved them, so this is computed once per
 * activation rather than per read.
 */
function skyOrientationRotation(
	orientation: readonly [number, number, number, number],
): AcRotation {
	const [w, x, y, z] = orientation;
	const magnitude = Math.hypot(w, x, y, z);
	if (magnitude === 0) {
		throw new Error("Sky object orientation is a zero quaternion.");
	}
	const qw = w / magnitude;
	const qx = x / magnitude;
	const qy = y / magnitude;
	const qz = z / magnitude;
	return {
		columns: [
			acVector3([
				1 - 2 * (qy * qy + qz * qz),
				2 * (qx * qy + qw * qz),
				2 * (qx * qz - qw * qy),
			]),
			acVector3([
				2 * (qx * qy - qw * qz),
				1 - 2 * (qx * qx + qz * qz),
				2 * (qy * qz + qw * qx),
			]),
			acVector3([
				2 * (qx * qz + qw * qy),
				2 * (qy * qz - qw * qx),
				1 - 2 * (qx * qx + qy * qy),
			]),
		],
	};
}
