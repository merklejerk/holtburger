import {
	CameraLookController,
	type CameraLook,
} from "../controls/camera-look-controller";
import { createCameraAxesRadians } from "../math/camera-orientation";
import { clamp } from "../math/vector-utils";
import { resolveKinematicBoomDirection } from "../motion/host-kinematic-boom-path";
import { resolvePhysicalFlyViewDirection } from "../motion/host-physical-fly-path";
import {
	HostKinematicBoomSession,
	type HostKinematicBoomDistancePolicy,
	type HostKinematicBoomStatus,
	type HostKinematicBoomTarget,
	type HostKinematicBoomTransport,
} from "./host-kinematic-boom-session";
import type { ProjectionClearanceRevision } from "./projection-clearance";
import type {
	HostKinematicBoomPresentation,
	HostKinematicBoomTick,
} from "../motion/host-kinematic-boom-path";

/**
 * Source-neutral boom session seam shared by Explorer possession and the client local player.
 *
 * The session owns protocol identity, path playback, and projection acknowledgements; this
 * controller owns only orbit, zoom, and rear-facing policy. Keeping the seam structural prevents
 * the client from importing an Explorer identity or command adapter just to reuse camera UX.
 */
export interface PossessionCameraBoomSession<
	Target,
	Tick,
	Presentation,
	Status,
> {
	start(
		target: Target,
		distance: HostKinematicBoomDistancePolicy,
		viewDirection: readonly [number, number, number],
		projection: ProjectionClearanceRevision,
	): Promise<void>;
	setClearance(projection: ProjectionClearanceRevision): Promise<void>;
	setIntent(
		viewDirection: readonly [number, number, number],
		zoomDisplacement: number,
	): Promise<void>;
	receive(tick: Tick, durationMs: number, receivedAtMs: number): void;
	presentation(nowMs: number): Presentation | null;
	acknowledgedProjection(nowMs: number): ProjectionClearanceRevision | null;
	status(): Status;
	stop(): Promise<void>;
	destroy?(): void;
	readonly running: boolean;
}

/** Gesture rates injected by the composing client rather than imported from Explorer tuning. */
export interface PossessionCameraOrbitPolicy {
	readonly maximumPitchRadians: number;
	readonly pitchRadiansPerPixel: number;
	readonly yawRadiansPerPixel: number;
}

/** Time-based rear-facing policy for a possessed entity's third-person camera. */
export interface PossessionCameraRecenterPolicy {
	/** Continuous translation required before the camera begins returning behind the entity. */
	readonly delayMs: number;
	/** Duration of the desired-yaw transition; zero preserves an instantaneous snap. */
	readonly durationMs: number;
}

/** Lifecycle states for the sticky rear-facing policy. */
type PossessionCameraRecenterState =
	| { readonly kind: "free" }
	| { readonly kind: "arming"; readonly deadlineMs: number }
	| {
			readonly kind: "transition";
			readonly fromYawRadians: number;
			readonly startedAtMs: number;
	  }
	| { readonly kind: "pinned" };

const REAR_ALIGNMENT_EPSILON_RADIANS = 1e-9;

/** Reusable third-person camera behavior with no DOM or Explorer mode ownership. */
export class PossessionCameraController<
	Target = HostKinematicBoomTarget,
	Tick = HostKinematicBoomTick,
	Presentation = HostKinematicBoomPresentation,
	Status = HostKinematicBoomStatus,
> {
	readonly #look: CameraLookController;
	readonly #orbit: PossessionCameraOrbitPolicy;
	readonly #recenter: PossessionCameraRecenterPolicy;
	readonly #session: PossessionCameraBoomSession<
		Target,
		Tick,
		Presentation,
		Status
	>;
	/** True while longitudinal or lateral player intent remains held. */
	#translationActive = false;
	/** Explicit state prevents an armed dwell, transition, and pin from coexisting. */
	#recenterState: PossessionCameraRecenterState = { kind: "free" };
	#pendingZoomDisplacement = 0;

	constructor(options: {
		readonly initialLook: CameraLook;
		readonly orbit: PossessionCameraOrbitPolicy;
		readonly recenter: PossessionCameraRecenterPolicy;
		readonly transport?: HostKinematicBoomTransport;
		readonly session?: PossessionCameraBoomSession<
			Target,
			Tick,
			Presentation,
			Status
		>;
	}) {
		validateOrbitPolicy(options.orbit);
		validateRecenterPolicy(options.recenter);
		this.#look = new CameraLookController(options.initialLook);
		this.#orbit = { ...options.orbit };
		this.#recenter = { ...options.recenter };
		if (options.session !== undefined) {
			this.#session = options.session;
		} else {
			if (options.transport === undefined) {
				throw new Error(
					"Possession camera requires either a boom session or a host transport.",
				);
			}
			this.#session = new HostKinematicBoomSession(
				options.transport,
			) as unknown as PossessionCameraBoomSession<
				Target,
				Tick,
				Presentation,
				Status
			>;
		}
	}

	/** Replace any prior host generation using the current desired orbit. */
	start(
		target: Target,
		distance: HostKinematicBoomDistancePolicy,
		projection: ProjectionClearanceRevision,
	): Promise<void> {
		this.#resetRecenter();
		return this.#session.start(
			target,
			distance,
			this.#boomDirection(),
			projection,
		);
	}

	/** Rotate desired orbit from semantic pointer deltas. */
	orbit(deltaX: number, deltaY: number, nowMs: number): CameraLook {
		assertFiniteTimestamp(nowMs);
		this.#rearmRecenter(nowMs);
		return this.#look.rotate(
			deltaX,
			deltaY,
			this.#orbit.yawRadiansPerPixel,
			this.#orbit.pitchRadiansPerPixel,
			this.#orbit.maximumPitchRadians,
		);
	}

	/** Seed a new target's facing without carrying orbit or recenter state across generations. */
	replaceLook(look: CameraLook): CameraLook {
		this.#resetRecenter();
		return this.#look.replace(look);
	}

	/** Arms or disarms the rear-facing dwell from semantic translation intent. */
	setTranslationIntent(active: boolean, nowMs: number): void {
		assertFiniteTimestamp(nowMs);
		if (active === this.#translationActive) return;
		this.#translationActive = active;
		if (!active) {
			// A completed snap is deliberately sticky; only orbit is an explicit
			// request to release it. Before the dwell/transition, movement release
			// cancels the pending trigger instead.
			if (this.#recenterState.kind === "arming")
				this.#recenterState = { kind: "free" };
			return;
		}
		if (this.#recenterState.kind === "free")
			this.#recenterState = {
				kind: "arming",
				deadlineMs: nowMs + this.#recenter.delayMs,
			};
	}

	/** Accumulate semantic signed reach displacement until the next synchronization. */
	zoom(displacement: number): void {
		if (!Number.isFinite(displacement)) {
			throw new Error("Possession camera zoom displacement must be finite.");
		}
		this.#pendingZoomDisplacement += displacement;
		if (!Number.isFinite(this.#pendingZoomDisplacement)) {
			throw new Error("Possession camera zoom displacement overflowed.");
		}
	}

	/**
	 * Submit the latest projection, desired orbit, and accumulated zoom through separate sequences.
	 * `targetFacingYawRadians` is the current renderer yaw for the possessed entity's rear direction.
	 */
	async synchronize(
		projection: ProjectionClearanceRevision,
		nowMs: number,
		targetFacingYawRadians: number,
	): Promise<void> {
		assertFiniteTimestamp(nowMs);
		assertFiniteYaw(targetFacingYawRadians);
		this.#advanceRecenter(nowMs, targetFacingYawRadians);
		const zoom = this.#pendingZoomDisplacement;
		this.#pendingZoomDisplacement = 0;
		await Promise.all([
			this.#session.setClearance(projection),
			this.#session.setIntent(this.#boomDirection(), zoom),
		]);
	}

	/** Accept one fixed-tick host result without owning its delivery subscription. */
	receive(tick: Tick, durationMs: number, receivedAtMs: number): void {
		this.#session.receive(tick, durationMs, receivedAtMs);
	}

	presentation(nowMs: number): Presentation | null {
		return this.#session.presentation(nowMs);
	}

	acknowledgedProjection(nowMs: number): ProjectionClearanceRevision | null {
		return this.#session.acknowledgedProjection(nowMs);
	}

	desiredLook(): CameraLook {
		return this.#look.snapshot();
	}

	status(): Status {
		return this.#session.status();
	}

	stop(): Promise<void> {
		this.#pendingZoomDisplacement = 0;
		this.#resetRecenter();
		return this.#session.stop();
	}

	/** Dispose a protocol-backed session when the owning presentation surface is torn down. */
	destroy(): void {
		this.#session.destroy?.();
	}

	get running(): boolean {
		return this.#session.running;
	}

	#boomDirection(): [number, number, number] {
		const look = this.#look.snapshot();
		const axes = createCameraAxesRadians(look.yawRadians, look.pitchRadians);
		return resolveKinematicBoomDirection(
			resolvePhysicalFlyViewDirection({
				forward: [axes.forward.x, axes.forward.y, axes.forward.z],
				right: [axes.right.x, axes.right.y, axes.right.z],
				up: [axes.up.x, axes.up.y, axes.up.z],
			}),
		);
	}

	#rearmRecenter(nowMs: number): void {
		this.#recenterState = this.#translationActive
			? { kind: "arming", deadlineMs: nowMs + this.#recenter.delayMs }
			: { kind: "free" };
	}

	#resetRecenter(): void {
		this.#translationActive = false;
		this.#recenterState = { kind: "free" };
	}

	#advanceRecenter(nowMs: number, targetFacingYawRadians: number): void {
		const targetYawRadians = normalizeYaw(targetFacingYawRadians);
		const state = this.#recenterState;
		if (state.kind === "transition") {
			const progress = clamp(
				(nowMs - state.startedAtMs) / this.#recenter.durationMs,
				0,
				1,
			);
			const easedProgress = progress * progress * (3 - 2 * progress);
			const yaw =
				state.fromYawRadians +
				shortestYawDelta(state.fromYawRadians, targetYawRadians) *
					easedProgress;
			this.#replaceYaw(yaw);
			if (progress >= 1) this.#pinRear(targetYawRadians);
			return;
		}
		if (state.kind === "pinned") {
			// Once snapped, follow the entity's current facing every frame. This
			// intentionally preserves pitch and zoom while making the rear offset
			// stateful across turns and movement release.
			this.#replaceYaw(targetYawRadians);
			return;
		}
		if (!this.#translationActive) return;
		if (state.kind !== "arming" || nowMs < state.deadlineMs) return;
		const fromYawRadians = this.#look.snapshot().yawRadians;
		if (
			Math.abs(shortestYawDelta(fromYawRadians, targetYawRadians)) <=
			REAR_ALIGNMENT_EPSILON_RADIANS
		) {
			this.#pinRear(targetYawRadians);
			return;
		}
		if (this.#recenter.durationMs === 0) {
			this.#pinRear(targetYawRadians);
			return;
		}
		this.#recenterState = {
			kind: "transition",
			fromYawRadians,
			startedAtMs: state.deadlineMs,
		};
		this.#advanceRecenter(nowMs, targetYawRadians);
	}

	#pinRear(yawRadians: number): void {
		this.#replaceYaw(yawRadians);
		this.#recenterState = { kind: "pinned" };
	}

	#replaceYaw(yawRadians: number): void {
		this.#look.replace({
			...this.#look.snapshot(),
			yawRadians,
		});
	}
}

function validateOrbitPolicy(policy: PossessionCameraOrbitPolicy): void {
	if (
		!Number.isFinite(policy.maximumPitchRadians) ||
		policy.maximumPitchRadians <= 0 ||
		!Number.isFinite(policy.pitchRadiansPerPixel) ||
		!Number.isFinite(policy.yawRadiansPerPixel)
	) {
		throw new Error(
			"Possession camera orbit policy must be finite and pitch-bounded.",
		);
	}
}

function validateRecenterPolicy(policy: PossessionCameraRecenterPolicy): void {
	if (
		!Number.isFinite(policy.delayMs) ||
		policy.delayMs < 0 ||
		!Number.isFinite(policy.durationMs) ||
		policy.durationMs < 0
	) {
		throw new Error(
			"Possession camera recenter policy must use finite non-negative durations.",
		);
	}
}

function assertFiniteTimestamp(nowMs: number): void {
	if (!Number.isFinite(nowMs))
		throw new Error("Possession camera timestamps must be finite.");
}

function assertFiniteYaw(yawRadians: number): void {
	if (!Number.isFinite(yawRadians))
		throw new Error("Possession camera target yaw must be finite.");
}

function normalizeYaw(yawRadians: number): number {
	const wrapped = (yawRadians + Math.PI) % (2 * Math.PI);
	const normalized = wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
	return normalized === 0 ? Math.PI : normalized - Math.PI;
}

function shortestYawDelta(
	fromYawRadians: number,
	toYawRadians: number,
): number {
	return normalizeYaw(toYawRadians - fromYawRadians);
}
