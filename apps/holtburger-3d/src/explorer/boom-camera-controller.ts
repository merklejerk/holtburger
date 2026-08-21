import { createCameraAxesRadians } from "../lib/game/math/camera-orientation";
import { sceneVec3, type SceneVec3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";

/**
 * Camera orientation the boom orbits with, owned by the existing look controller.
 *
 * The boom deliberately does not integrate its own yaw and pitch. Pointer look already produces
 * exactly this, and the physical-camera path already overrides only *position* while leaving
 * orientation to the same controller. A second source would have to be handed authority across
 * possession and release, and would pop whenever the two disagreed.
 */
export interface BoomCameraOrientation {
	readonly yawRadians: number;
	readonly pitchRadians: number;
}

/**
 * Third-person boom length about the followed anchor.
 *
 * The world position is *derived* from the anchor every frame rather than accumulated, which is
 * what makes this unable to wedge: a chasing body that collision blocks stays wherever it was
 * stopped, while a derived position returns to the boom direction as soon as the obstruction
 * clears.
 *
 * Zoom is velocity on `desiredDistance`; "settle for less when blocked" is the clamp against a
 * swept distance; and smooth recovery is `desiredDistance` easing back out while the clamp relaxes
 * with it. Orbit is {@link BoomCameraOrientation}, supplied by the look controller.
 */
export interface BoomCameraState {
	/** Distance the operator has asked for, before collision has any say. */
	readonly desiredDistance: number;
	/**
	 * Distance actually rendered at, after clamping and asymmetric smoothing.
	 *
	 * Retained rather than recomputed because the ease-out is a function of the previous frame's
	 * rendered distance; without it the clamp would snap back out the instant geometry cleared.
	 */
	readonly renderedDistance: number;
}

/** Operator intent for one frame, in rates rather than deltas so it is frame-rate independent. */
export interface BoomCameraInput {
	/** Positive zooms out. */
	readonly zoomMetersPerSecond: number;
}

export interface BoomCameraTuning {
	/** Closest the camera may sit, so a fully pinned boom stops at the entity's back. */
	readonly minimumDistance: number;
	readonly maximumDistance: number;
	/**
	 * Seconds for the rendered distance to ease back out once the clamp relaxes.
	 *
	 * Pulling in is deliberately immediate and has no matching constant: easing inward would let
	 * the camera sit inside geometry for the duration of the ease.
	 */
	readonly easeOutSeconds: number;
}

/** No input held, which is also what a frame with no operator intent submits. */
export const IDLE_BOOM_INPUT: BoomCameraInput = { zoomMetersPerSecond: 0 };

/** Initial state for a newly possessed entity, entered at the requested distance. */
export function initialBoomState(
	distance: number,
	tuning: BoomCameraTuning,
): BoomCameraState {
	const clamped = clamp(
		distance,
		tuning.minimumDistance,
		tuning.maximumDistance,
	);
	return { desiredDistance: clamped, renderedDistance: clamped };
}

/**
 * Integrate operator intent into the boom's own coordinates.
 *
 * Deliberately knows nothing about collision: this is what the operator asked for, and the world
 * gets its say in {@link clampBoomState}. Keeping them separate is what lets the desired distance
 * keep easing outward while the rendered one is still pinned against a wall.
 */
export function advanceBoomState(
	state: BoomCameraState,
	input: BoomCameraInput,
	deltaSeconds: number,
	tuning: BoomCameraTuning,
): BoomCameraState {
	if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
		throw new Error("Boom advancement requires a non-negative finite step.");
	return {
		...state,
		desiredDistance: clamp(
			state.desiredDistance + input.zoomMetersPerSecond * deltaSeconds,
			tuning.minimumDistance,
			tuning.maximumDistance,
		),
	};
}

/**
 * Apply the world's answer, asymmetrically.
 *
 * Pull in immediately: the swept distance is the furthest the camera can be without entering
 * geometry, so easing inward would render frames inside a wall. Ease out over `easeOutSeconds`,
 * because the clamp can relax by metres in a single frame when the entity clears a corner, and
 * snapping outward reads as a jump cut.
 *
 * `sweptDistance` is the host's answer for this boom direction, already in meters. A caller with
 * no answer yet passes the desired distance, which leaves the boom unclamped.
 */
export function clampBoomState(
	state: BoomCameraState,
	sweptDistance: number,
	deltaSeconds: number,
	tuning: BoomCameraTuning,
): BoomCameraState {
	if (!Number.isFinite(sweptDistance) || sweptDistance < 0)
		throw new Error("Boom clamping requires a non-negative finite sweep.");
	const target = clamp(
		Math.min(state.desiredDistance, sweptDistance),
		tuning.minimumDistance,
		tuning.maximumDistance,
	);
	if (target <= state.renderedDistance)
		return { ...state, renderedDistance: target };
	const fraction =
		tuning.easeOutSeconds <= 0
			? 1
			: Math.min(1, deltaSeconds / tuning.easeOutSeconds);
	return {
		...state,
		renderedDistance:
			state.renderedDistance + (target - state.renderedDistance) * fraction,
	};
}

/**
 * Derive the camera's scene position behind the anchor.
 *
 * The anchor is the followed entity's head, and the camera sits back along the view direction, so
 * the entity is always in front of the camera by construction — the property a chasing body cannot
 * offer.
 */
export function boomCameraPosition(
	anchor: SceneVec3,
	state: BoomCameraState,
	orientation: BoomCameraOrientation,
): SceneVec3 {
	const { forward } = createCameraAxesRadians(
		orientation.yawRadians,
		orientation.pitchRadians,
	);
	return sceneVec3(
		new Vec3(
			anchor.x - forward.x * state.renderedDistance,
			anchor.y - forward.y * state.renderedDistance,
			anchor.z - forward.z * state.renderedDistance,
		),
	);
}

/**
 * The direction the host sweeps along: from the anchor toward where the camera wants to be.
 *
 * Returned separately from the position because the sweep asks about the *desired* reach while the
 * position renders the *clamped* one, and conflating them would let a pinned camera stop asking
 * whether it may come back out.
 */
export function boomSweepDirection(orientation: BoomCameraOrientation): Vec3 {
	const { forward } = createCameraAxesRadians(
		orientation.yawRadians,
		orientation.pitchRadians,
	);
	return new Vec3(-forward.x, -forward.y, -forward.z);
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}
