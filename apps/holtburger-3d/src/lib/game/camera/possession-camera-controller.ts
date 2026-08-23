import {
	CameraLookController,
	type CameraLook,
} from "../controls/camera-look-controller";
import { createCameraAxesRadians } from "../math/camera-orientation";
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

/** Gesture rates injected by the composing client rather than imported from Explorer tuning. */
export interface PossessionCameraOrbitPolicy {
	readonly maximumPitchRadians: number;
	readonly pitchRadiansPerPixel: number;
	readonly yawRadiansPerPixel: number;
}

/** Reusable third-person camera behavior with no DOM or Explorer mode ownership. */
export class PossessionCameraController {
	readonly #look: CameraLookController;
	readonly #orbit: PossessionCameraOrbitPolicy;
	readonly #session: HostKinematicBoomSession;
	#pendingZoomDisplacement = 0;

	constructor(options: {
		readonly initialLook: CameraLook;
		readonly orbit: PossessionCameraOrbitPolicy;
		readonly transport: HostKinematicBoomTransport;
	}) {
		validateOrbitPolicy(options.orbit);
		this.#look = new CameraLookController(options.initialLook);
		this.#orbit = { ...options.orbit };
		this.#session = new HostKinematicBoomSession(options.transport);
	}

	/** Replace any prior host generation using the current desired orbit. */
	start(
		target: HostKinematicBoomTarget,
		distance: HostKinematicBoomDistancePolicy,
		projection: ProjectionClearanceRevision,
	): Promise<void> {
		return this.#session.start(
			target,
			distance,
			this.#boomDirection(),
			projection,
		);
	}

	/** Rotate desired orbit from semantic pointer deltas. */
	orbit(deltaX: number, deltaY: number): CameraLook {
		return this.#look.rotate(
			deltaX,
			deltaY,
			this.#orbit.yawRadiansPerPixel,
			this.#orbit.pitchRadiansPerPixel,
			this.#orbit.maximumPitchRadians,
		);
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

	/** Submit the latest projection, desired orbit, and accumulated zoom through separate sequences. */
	async synchronize(projection: ProjectionClearanceRevision): Promise<void> {
		const zoom = this.#pendingZoomDisplacement;
		this.#pendingZoomDisplacement = 0;
		await Promise.all([
			this.#session.setClearance(projection),
			this.#session.setIntent(this.#boomDirection(), zoom),
		]);
	}

	/** Accept one fixed-tick host result without owning its delivery subscription. */
	receive(
		tick: HostKinematicBoomTick,
		durationMs: number,
		receivedAtMs: number,
	): void {
		this.#session.receive(tick, durationMs, receivedAtMs);
	}

	presentation(nowMs: number): HostKinematicBoomPresentation | null {
		return this.#session.presentation(nowMs);
	}

	acknowledgedProjection(nowMs: number): ProjectionClearanceRevision | null {
		return this.#session.acknowledgedProjection(nowMs);
	}

	desiredLook(): CameraLook {
		return this.#look.snapshot();
	}

	status(): HostKinematicBoomStatus {
		return this.#session.status();
	}

	stop(): Promise<void> {
		this.#pendingZoomDisplacement = 0;
		return this.#session.stop();
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
