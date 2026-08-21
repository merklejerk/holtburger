import { sceneVec3, type SceneVec3 } from "../../assets/ac-frame";
import { createLandblockWorldOrigin } from "../landblocks";
import { Vec3 } from "../math/types";
import type { ResolvedSceneOrigin } from "../scene";
import {
	advanceBoomState,
	boomCameraPosition,
	boomSweepDirection,
	clampBoomState,
	initialBoomState,
	type BoomCameraInput,
	type BoomCameraOrientation,
	type BoomCameraState,
	type BoomCameraTuning,
} from "./boom-camera-controller";
import type { BoomSweepSource } from "./boom-sweep-source";

/** Everything the boom needs about the entity it follows, resolved by its owner. */
export interface BoomFollowTarget {
	/** Root origin and residency of the followed entity, as the scene graph resolved it. */
	readonly origin: ResolvedSceneOrigin;
	/** Height above that root the boom pivots about. */
	readonly anchorHeight: number;
}

export interface BoomCameraSessionOptions {
	readonly tuning: BoomCameraTuning;
	readonly sweeps: BoomSweepSource;
	readonly sweepRadius: number;
	/** Reported rather than thrown: a failing sweep must not take down the render loop. */
	readonly onSweepError: (error: unknown) => void;
}

/**
 * Drives one third-person boom, keeping its collision query off the render frame.
 *
 * The sweep is asynchronous and the camera is not allowed to wait for it, so at most one request is
 * ever in flight and its answer is applied whenever it lands. That makes the clamp up to one round
 * trip stale against a moving anchor — bounded by how far the entity travels in that window, and
 * never wrong about where geometry *is*, because static geometry does not move.
 */
export class BoomCameraSession {
	readonly #options: BoomCameraSessionOptions;
	#state: BoomCameraState;
	/** Latest answered reach, or `null` until the first sweep lands. */
	#sweptDistance: number | null = null;
	#sweepInFlight = false;
	/** Guards a late answer from a superseded session against a newer one. */
	#generation = 0;
	#disposed = false;

	constructor(options: BoomCameraSessionOptions, distance: number) {
		this.#options = options;
		this.#state = initialBoomState(distance, options.tuning);
	}

	get state(): BoomCameraState {
		return this.#state;
	}

	/**
	 * Advance one render frame and return where the camera should be.
	 *
	 * Ordering matters: intent integrates first so the sweep is fired for where the operator is
	 * steering rather than where they were, and the clamp applies last so a stale answer can never
	 * push the camera further out than the current request.
	 */
	advance(
		target: BoomFollowTarget,
		orientation: BoomCameraOrientation,
		input: BoomCameraInput,
		deltaSeconds: number,
	): SceneVec3 {
		if (this.#disposed)
			throw new Error("Cannot advance a released boom camera.");
		this.#state = advanceBoomState(
			this.#state,
			input,
			deltaSeconds,
			this.#options.tuning,
		);
		const anchor = boomAnchor(target);
		this.#requestSweep(anchor, target.origin.envCellId, orientation);
		this.#state = clampBoomState(
			this.#state,
			this.#sweptDistance ?? this.#state.desiredDistance,
			deltaSeconds,
			this.#options.tuning,
		);
		return boomCameraPosition(anchor, this.#state, orientation);
	}

	/** Abandon in-flight answers so a released boom cannot clamp a later one. */
	dispose(): void {
		this.#disposed = true;
		this.#generation += 1;
		this.#sweepInFlight = false;
	}

	#requestSweep(
		anchor: SceneVec3,
		envCellId: ResolvedSceneOrigin["envCellId"],
		orientation: BoomCameraOrientation,
	) {
		if (this.#sweepInFlight) return;
		this.#sweepInFlight = true;
		const generation = this.#generation;
		// The sweep asks about the *desired* reach, not the rendered one: a boom pinned against a
		// wall must keep asking whether it may come back out, and a query derived from its clamped
		// distance would answer "where you already are is fine" forever.
		void this.#options.sweeps
			.sweep({
				direction: boomSweepDirection(orientation),
				distance: this.#state.desiredDistance,
				envCellId,
				origin: anchor,
				radius: this.#options.sweepRadius,
			})
			.then((distance) => {
				if (generation !== this.#generation) return;
				this.#sweptDistance = distance;
			})
			.catch((error: unknown) => {
				if (generation !== this.#generation) return;
				this.#options.onSweepError(error);
			})
			.finally(() => {
				if (generation !== this.#generation) return;
				this.#sweepInFlight = false;
			});
	}
}

/** The followed entity's head in canonical scene coordinates. */
export function boomAnchor(target: BoomFollowTarget): SceneVec3 {
	const origin = createLandblockWorldOrigin(target.origin.landblockId);
	return sceneVec3(
		new Vec3(
			origin.x + target.origin.landblockOrigin.x,
			origin.y + target.origin.landblockOrigin.y + target.anchorHeight,
			origin.z + target.origin.landblockOrigin.z,
		),
	);
}
