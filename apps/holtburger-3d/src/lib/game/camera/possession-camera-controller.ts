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

/** Optional motion profile for a possessed third-person camera's horizontal idle orbit. */
export interface PossessionCameraIdleOrbitPolicy {
	/** Steady-state horizontal yaw velocity after ease-in, in radians per second. */
	readonly angularSpeedRadiansPerSecond: number;
	/** Smooth ramp duration from zero angular speed to full speed, in milliseconds. */
	readonly easeInDurationMs: number;
	/** Smooth return duration back to the pre-idle yaw on non-camera wake, in milliseconds. */
	readonly returnDurationMs: number;
}

/** Per-frame world-activity context consumed by camera policy advancement. */
export interface PossessionCameraAdvanceOptions {
	/** Suppresses idle-orbit arming and wakes an active idle orbit with a smooth return. */
	readonly idleBlocked?: boolean;
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

/** Lifecycle states for the optional world-idle horizontal orbit. */
type PossessionCameraIdleOrbitState =
	| { readonly kind: "inactive" }
	| { readonly kind: "armed"; readonly deadlineMs: number }
	| {
			readonly kind: "orbiting";
			readonly startedAtMs: number;
			readonly originYawRadians: number;
			readonly originWasPinned: boolean;
	  }
	| {
			readonly kind: "returning";
			readonly fromYawRadians: number;
			readonly targetYawRadians: number;
			readonly startedAtMs: number;
			readonly restorePinned: boolean;
	  };

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
	readonly #idleOrbit: PossessionCameraIdleOrbitPolicy | null;
	readonly #session: PossessionCameraBoomSession<
		Target,
		Tick,
		Presentation,
		Status
	>;
	/** True while longitudinal or lateral player intent remains held. */
	#translationActive = false;
	/** Held orbit input owns yaw even while the mouse is stationary. */
	#orbitHeld = false;
	/** Explicit state prevents an armed dwell, transition, and pin from coexisting. */
	#recenterState: PossessionCameraRecenterState = { kind: "free" };
	/** Idle dwell in milliseconds before orbit starts; zero disables idle orbit. */
	#idleOrbitDelayMs: number;
	/** Explicit state separates idle dwell, active orbiting, and smooth return. */
	#idleOrbitState: PossessionCameraIdleOrbitState = { kind: "inactive" };
	#pendingZoomDisplacement = 0;
	/** Last queued input, recorded before async transport so idle frames queue no work. */
	#queuedLook: CameraLook | null = null;
	#queuedProjectionRevision: number | null = null;
	#queueRevision = 0;
	/** Invalidates deferred input when its camera registration is retired or replaced. */
	#sessionGeneration = 0;

	constructor(options: {
		readonly initialLook: CameraLook;
		readonly orbit: PossessionCameraOrbitPolicy;
		readonly recenter: PossessionCameraRecenterPolicy;
		readonly idleOrbit?: PossessionCameraIdleOrbitPolicy;
		readonly idleOrbitDelayMs?: number;
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
		if (options.idleOrbit !== undefined) {
			validateIdleOrbitPolicy(options.idleOrbit);
		}
		const idleOrbitDelayMs = options.idleOrbitDelayMs ?? 0;
		assertValidIdleOrbitDelay(idleOrbitDelayMs);
		this.#look = new CameraLookController(options.initialLook);
		this.#orbit = { ...options.orbit };
		this.#recenter = { ...options.recenter };
		this.#idleOrbit =
			options.idleOrbit === undefined
				? null
				: {
						angularSpeedRadiansPerSecond:
							options.idleOrbit.angularSpeedRadiansPerSecond,
						easeInDurationMs: options.idleOrbit.easeInDurationMs,
						returnDurationMs: options.idleOrbit.returnDurationMs,
					};
		this.#idleOrbitDelayMs =
			options.idleOrbit === undefined ? 0 : idleOrbitDelayMs;
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
		this.#sessionGeneration += 1;
		this.#resetRecenter();
		this.#cancelIdleOrbitInPlace();
		this.#queuedLook = null;
		this.#queuedProjectionRevision = null;
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
		this.#cancelIdleOrbitInPlace();
		this.#rearmRecenter(nowMs);
		return this.#look.rotate(
			deltaX,
			deltaY,
			this.#orbit.yawRadiansPerPixel,
			this.#orbit.pitchRadiansPerPixel,
			this.#orbit.maximumPitchRadians,
		);
	}

	/** Adjust pitch with ordinary orbit limits without releasing or restarting rear-follow. */
	pitch(deltaY: number): CameraLook {
		return this.#look.rotate(
			0,
			deltaY,
			0,
			this.#orbit.pitchRadiansPerPixel,
			this.#orbit.maximumPitchRadians,
		);
	}

	/** Release automatic rear-follow for the whole hold; release begins a fresh movement dwell. */
	setOrbitHeld(held: boolean, nowMs: number): void {
		assertFiniteTimestamp(nowMs);
		if (held) this.#cancelIdleOrbitInPlace();
		if (held === this.#orbitHeld) return;
		this.#orbitHeld = held;
		this.#rearmRecenter(nowMs);
	}

	/** Enter sticky rear-follow explicitly, bypassing the translation dwell. */
	followRear(nowMs: number): void {
		assertFiniteTimestamp(nowMs);
		this.#cancelIdleOrbitInPlace();
		if (this.#recenterState.kind === "pinned") return;
		this.#recenterState =
			this.#recenter.durationMs === 0
				? { kind: "pinned" }
				: {
						kind: "transition",
						fromYawRadians: this.#look.snapshot().yawRadians,
						startedAtMs: nowMs,
					};
	}

	/** Seed a new target's facing without carrying orbit or recenter state across generations. */
	replaceLook(look: CameraLook): CameraLook {
		this.#resetRecenter();
		this.#cancelIdleOrbitInPlace();
		return this.#look.replace(look);
	}

	/** Set idle-orbit dwell in milliseconds; zero disables it (`immediate` stops without returning). */
	setIdleOrbitDelayMs(
		delayMs: number,
		nowMs: number,
		options?: { readonly immediate?: boolean },
	): void {
		assertValidIdleOrbitDelay(delayMs);
		assertFiniteTimestamp(nowMs);
		if (this.#idleOrbit === null) return;
		if (delayMs === 0 && options?.immediate === true) {
			this.#idleOrbitDelayMs = 0;
			this.#cancelIdleOrbitInPlace();
			return;
		}
		if (delayMs === this.#idleOrbitDelayMs) return;
		this.#idleOrbitDelayMs = delayMs;
		if (delayMs === 0) {
			this.#wakeIdleOrbit(nowMs);
			return;
		}
		if (this.#idleOrbitState.kind === "armed") {
			this.#idleOrbitState = { kind: "inactive" };
		}
	}

	/** Record one-shot world activity (such as jump input) to wake idle orbit. */
	noteWorldActivity(nowMs: number): void {
		assertFiniteTimestamp(nowMs);
		this.#wakeIdleOrbit(nowMs);
	}

	/** Arms or disarms the rear-facing dwell from semantic translation intent. */
	setTranslationIntent(active: boolean, nowMs: number): void {
		assertFiniteTimestamp(nowMs);
		if (active) this.#wakeIdleOrbit(nowMs);
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
		if (
			!this.#orbitHeld &&
			this.#recenterState.kind === "free" &&
			!(
				this.#idleOrbitState.kind === "returning" &&
				this.#idleOrbitState.restorePinned
			)
		)
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
		if (displacement !== 0) this.#cancelIdleOrbitInPlace();
		this.#pendingZoomDisplacement += displacement;
		if (!Number.isFinite(this.#pendingZoomDisplacement)) {
			throw new Error("Possession camera zoom displacement overflowed.");
		}
	}

	/** Advance rear-follow and idle orbit synchronously so pending IPC cannot delay visible yaw. */
	advance(
		nowMs: number,
		targetFacingYawRadians: number,
		options?: PossessionCameraAdvanceOptions,
	): void {
		assertFiniteTimestamp(nowMs);
		assertFiniteYaw(targetFacingYawRadians);
		this.#advanceRecenter(nowMs, targetFacingYawRadians);
		this.#advanceIdleOrbit(
			nowMs,
			targetFacingYawRadians,
			options?.idleBlocked === true,
		);
	}

	/** Capture changed input once; the returned submission may be serialized by the caller. */
	queueSynchronization(
		projection: ProjectionClearanceRevision,
	): (() => Promise<void>) | null {
		const look = this.#look.snapshot();
		const queued = this.#queuedLook;
		if (
			this.#queuedProjectionRevision === projection.revision &&
			queued !== null &&
			queued.yawRadians === look.yawRadians &&
			queued.pitchRadians === look.pitchRadians &&
			this.#pendingZoomDisplacement === 0
		)
			return null;
		const direction = this.#boomDirection();
		const zoom = this.#pendingZoomDisplacement;
		this.#pendingZoomDisplacement = 0;
		this.#queuedLook = look;
		this.#queuedProjectionRevision = projection.revision;
		const revision = ++this.#queueRevision;
		const generation = this.#sessionGeneration;
		return async () => {
			if (generation !== this.#sessionGeneration) return;
			try {
				await Promise.all([
					this.#session.setClearance(projection),
					this.#session.setIntent(direction, zoom),
				]);
			} catch (error) {
				if (
					generation === this.#sessionGeneration &&
					this.#queueRevision === revision
				) {
					this.#queuedLook = null;
					this.#queuedProjectionRevision = null;
				}
				throw error;
			}
		};
	}

	/** Submit one frame directly for consumers that do not serialize camera transport. */
	synchronize(
		projection: ProjectionClearanceRevision,
		nowMs: number,
		targetFacingYawRadians: number,
		options?: PossessionCameraAdvanceOptions,
	): Promise<void> {
		this.advance(nowMs, targetFacingYawRadians, options);
		return this.queueSynchronization(projection)?.() ?? Promise.resolve();
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
		this.#sessionGeneration += 1;
		this.#pendingZoomDisplacement = 0;
		this.#queuedLook = null;
		this.#queuedProjectionRevision = null;
		this.#orbitHeld = false;
		this.#resetRecenter();
		this.#cancelIdleOrbitInPlace();
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
		this.#recenterState =
			this.#translationActive && !this.#orbitHeld
				? { kind: "arming", deadlineMs: nowMs + this.#recenter.delayMs }
				: { kind: "free" };
	}

	#resetRecenter(): void {
		this.#translationActive = false;
		this.#recenterState = { kind: "free" };
	}

	#advanceRecenter(nowMs: number, targetFacingYawRadians: number): void {
		if (this.#orbitHeld) return;
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
			this.#cancelIdleOrbitInPlace();
			this.#pinRear(targetYawRadians);
			return;
		}
		if (this.#recenter.durationMs === 0) {
			this.#cancelIdleOrbitInPlace();
			this.#pinRear(targetYawRadians);
			return;
		}
		// Active rear-recenter takes exclusive yaw ownership from any in-flight idle return.
		this.#cancelIdleOrbitInPlace();
		this.#recenterState = {
			kind: "transition",
			fromYawRadians,
			startedAtMs: state.deadlineMs,
		};
		this.#advanceRecenter(nowMs, targetYawRadians);
	}

	#cancelIdleOrbitInPlace(): void {
		this.#idleOrbitState = { kind: "inactive" };
	}

	#wakeIdleOrbit(nowMs: number): void {
		const policy = this.#idleOrbit;
		if (policy === null) return;
		const state = this.#idleOrbitState;
		if (state.kind === "armed") {
			this.#idleOrbitState = { kind: "inactive" };
			return;
		}
		if (state.kind !== "orbiting") return;
		const currentYaw = normalizeYaw(this.#look.snapshot().yawRadians);
		const targetYaw = normalizeYaw(state.originYawRadians);
		if (
			policy.returnDurationMs === 0 ||
			Math.abs(shortestYawDelta(currentYaw, targetYaw)) <=
				REAR_ALIGNMENT_EPSILON_RADIANS
		) {
			this.#idleOrbitState = { kind: "inactive" };
			this.#replaceYaw(targetYaw);
			if (
				state.originWasPinned &&
				!this.#orbitHeld &&
				this.#recenterState.kind !== "transition"
			) {
				this.#recenterState = { kind: "pinned" };
			}
			return;
		}
		this.#idleOrbitState = {
			kind: "returning",
			fromYawRadians: currentYaw,
			targetYawRadians: targetYaw,
			startedAtMs: nowMs,
			restorePinned: state.originWasPinned,
		};
	}

	#advanceIdleOrbit(
		nowMs: number,
		targetFacingYawRadians: number,
		idleBlocked: boolean,
	): void {
		const policy = this.#idleOrbit;
		if (policy === null) return;
		const state = this.#idleOrbitState;
		if (state.kind === "returning") {
			const targetYaw = state.restorePinned
				? normalizeYaw(targetFacingYawRadians)
				: state.targetYawRadians;
			// Returning state is only entered when returnDurationMs > 0.
			const progress = clamp(
				(nowMs - state.startedAtMs) / policy.returnDurationMs,
				0,
				1,
			);
			const easedProgress = progress * progress * (3 - 2 * progress);
			const yaw = normalizeYaw(
				state.fromYawRadians +
					shortestYawDelta(state.fromYawRadians, targetYaw) * easedProgress,
			);
			this.#replaceYaw(yaw);
			if (progress >= 1) {
				this.#idleOrbitState = { kind: "inactive" };
				if (state.restorePinned) this.#pinRear(targetYaw);
			}
			return;
		}
		const blocked =
			this.#idleOrbitDelayMs === 0 ||
			idleBlocked ||
			this.#orbitHeld ||
			this.#translationActive ||
			this.#recenterState.kind === "arming" ||
			this.#recenterState.kind === "transition";
		if (blocked) {
			this.#wakeIdleOrbit(nowMs);
			// Zero-duration return that restored rear-pin should align immediately with current facing.
			if (state.kind === "orbiting" && this.#recenterState.kind === "pinned") {
				this.#replaceYaw(normalizeYaw(targetFacingYawRadians));
			}
			return;
		}
		if (state.kind === "inactive") {
			this.#idleOrbitState = {
				kind: "armed",
				deadlineMs: nowMs + this.#idleOrbitDelayMs,
			};
			return;
		}
		if (state.kind === "armed") {
			if (nowMs < state.deadlineMs) return;
			// Capture and release sticky rear-pin so neither pinned follow nor followRear fights orbit.
			const originYawRadians = normalizeYaw(this.#look.snapshot().yawRadians);
			const originWasPinned = this.#recenterState.kind === "pinned";
			this.#recenterState = { kind: "free" };
			// Stamp start to nowMs rather than deadlineMs so resume from sleep always eases in from rest.
			this.#idleOrbitState = {
				kind: "orbiting",
				startedAtMs: nowMs,
				originYawRadians,
				originWasPinned,
			};
			return;
		}
		const elapsedSeconds = Math.max(0, nowMs - state.startedAtMs) / 1_000;
		const deltaYaw = idleOrbitAngleOffset(elapsedSeconds, policy);
		this.#replaceYaw(normalizeYaw(state.originYawRadians + deltaYaw));
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

/** Closed-form integral of smoothstep angular velocity from rest to steady orbit speed. */
function idleOrbitAngleOffset(
	elapsedSeconds: number,
	policy: PossessionCameraIdleOrbitPolicy,
): number {
	const rampSeconds = policy.easeInDurationMs / 1_000;
	const speed = policy.angularSpeedRadiansPerSecond;
	if (rampSeconds <= 0) return speed * elapsedSeconds;
	if (elapsedSeconds < rampSeconds) {
		const u = elapsedSeconds / rampSeconds;
		return speed * rampSeconds * (u * u * u - 0.5 * u * u * u * u);
	}
	return speed * (elapsedSeconds - 0.5 * rampSeconds);
}

function validateIdleOrbitPolicy(
	policy: PossessionCameraIdleOrbitPolicy,
): void {
	if (
		!Number.isFinite(policy.angularSpeedRadiansPerSecond) ||
		policy.angularSpeedRadiansPerSecond === 0 ||
		!Number.isFinite(policy.easeInDurationMs) ||
		policy.easeInDurationMs < 0 ||
		!Number.isFinite(policy.returnDurationMs) ||
		policy.returnDurationMs < 0
	) {
		throw new Error(
			"Possession camera idle orbit policy requires finite non-negative durations and non-zero speed.",
		);
	}
}

function assertValidIdleOrbitDelay(delayMs: number): void {
	if (!Number.isFinite(delayMs) || delayMs < 0) {
		throw new Error(
			"Possession camera idle orbit delay must be finite and non-negative.",
		);
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
