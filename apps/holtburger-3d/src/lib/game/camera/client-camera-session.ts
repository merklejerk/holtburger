import {
	type ClientCameraIdentity,
	type ClientCameraStartReceipt,
	type ClientCameraTick,
} from "../../../client/client-host-contract";
import { ClientLifecycleSession } from "../../../client/client-lifecycle-session";
import {
	evaluateHostKinematicBoomPath,
	type HostKinematicBoomPresentation,
} from "../motion/host-kinematic-boom-path";
import type { HostKinematicBoomDistancePolicy } from "./host-kinematic-boom-session";
import type { ProjectionClearanceRevision } from "./projection-clearance";

/** Local-player identity required before a client camera generation may be registered. */
export interface ClientCameraTarget {
	readonly playerGuid: number;
	readonly entityGeneration: number;
}

/** Reach policy sent with a client camera registration request. */
export type ClientCameraDistancePolicy = HostKinematicBoomDistancePolicy;

type ClientCameraProvenTick = Exclude<
	ClientCameraTick,
	{ readonly kind: "fallback" }
>;

/** Renderer-visible camera session lifecycle and latest host evidence. */
export type ClientCameraStatus =
	| { readonly kind: "stopped" }
	| { readonly kind: "awaiting-registration" }
	| {
			readonly kind: "awaiting-first-path";
			readonly identity: ClientCameraIdentity;
	  }
	| {
			readonly kind: "active";
			readonly identity: ClientCameraIdentity;
			readonly sequence: number;
			readonly targetSphereRole: ClientCameraTick["targetSphereRole"];
			readonly clearance: ClientCameraProvenTick["clearance"] | null;
			readonly desiredReach: number;
			readonly renderedReach: number;
			readonly placementOutcome:
				| {
						readonly kind: "held";
						readonly reason: Extract<
							ClientCameraTick,
							{ readonly kind: "held" }
						>["reason"];
				  }
				| {
						readonly kind: "reseeded";
						readonly reason: Extract<
							ClientCameraTick,
							{ readonly kind: "reseeded" }
						>["reason"];
				  }
				| {
						readonly kind: "fallback";
						readonly reason: Extract<
							ClientCameraTick,
							{ readonly kind: "fallback" }
						>["reason"];
				  }
				| null;
			readonly droppedPaths: number;
			readonly diagnostics: ClientCameraTick["diagnostics"];
	  };

interface ReceivedTick {
	readonly tick: ClientCameraTick;
	readonly receivedAtMs: number;
}

interface PlaybackPath {
	readonly tick: ClientCameraTick;
}

const MAX_PRE_REGISTRATION_OUTPUTS = 2;

/**
 * Client protocol adapter for the shared third-person boom playback contract.
 *
 * Registration is event-acknowledged rather than inferred from a command's unit response. This
 * lets the host keep the renderer command boundary narrow while still making camera-generation
 * identity explicit before later intent, clearance, or path events are accepted.
 */
export class ClientCameraSession {
	readonly #lifecycle: ClientLifecycleSession;
	readonly #unsubscribe: () => void;
	#lifecycleRevision = 0;
	#registrationPending = false;
	#identity: ClientCameraIdentity | null = null;
	#registrationTarget: ClientCameraTarget | null = null;
	#registrationResolve: (() => void) | null = null;
	#registrationReject: ((error: unknown) => void) | null = null;
	#preRegistrationOutputs = new Map<number, ReceivedTick>();
	#highestSequence = 0;
	#active: PlaybackPath | null = null;
	#pending: PlaybackPath | null = null;
	#activeStartedAtMs = 0;
	#droppedPaths = 0;
	#latestPath: ClientCameraTick | null = null;
	#nextInputSequence = 1;
	#cumulativeZoomDisplacement = 0;
	#lastSubmittedDirection: readonly [number, number, number] | null = null;
	#lastSubmittedZoomDisplacement = 0;
	#lastRequestedProjectionRevision = 0;
	#projectionRevisions = new Map<number, ProjectionClearanceRevision>();

	constructor(lifecycle: ClientLifecycleSession) {
		this.#lifecycle = lifecycle;
		this.#unsubscribe = lifecycle.subscribe((event) => {
			if (event.type === "camera-started") this.#receiveStarted(event.receipt);
			if (event.type === "camera") this.#receiveCurrentOutput(event.tick);
		});
	}

	/** Register against one exact local-player generation and await the authority receipt. */
	async start(
		target: ClientCameraTarget,
		distance: ClientCameraDistancePolicy,
		viewDirection: readonly [number, number, number],
		projection: ProjectionClearanceRevision,
	): Promise<void> {
		validateTarget(target);
		validateDistancePolicy(distance);
		validateDirection(viewDirection);
		validateProjection(projection);
		const revision = ++this.#lifecycleRevision;
		const previous = this.#identity;
		this.#rejectRegistration(
			new Error("Client camera registration was superseded."),
		);
		this.#resetSession();
		this.#registrationPending = true;
		this.#registrationTarget = target;
		this.#lastSubmittedDirection = [...viewDirection];
		this.#lastRequestedProjectionRevision = projection.revision;
		this.#projectionRevisions.set(projection.revision, projection);

		if (previous !== null) {
			await this.#lifecycle.stopCamera(previous);
			if (revision !== this.#lifecycleRevision) return;
		}

		const registration = new Promise<void>((resolve, reject) => {
			this.#registrationResolve = resolve;
			this.#registrationReject = reject;
		});
		try {
			await this.#lifecycle.startCamera({
				playerGuid: target.playerGuid,
				entityGeneration: target.entityGeneration,
				initialReach: distance.initial,
				minimumReach: distance.minimum,
				maximumReach: distance.maximum,
				inputSequence: 0,
				viewDirection,
				cumulativeZoomDisplacement: 0,
				projectionRevision: projection.revision,
				clearanceRadius: projection.clearanceRadius,
			});
			await registration;
			if (revision !== this.#lifecycleRevision) return;
		} catch (error) {
			if (revision === this.#lifecycleRevision) this.#resetSession();
			throw error;
		} finally {
			if (this.#registrationResolve !== null) {
				this.#registrationResolve = null;
				this.#registrationReject = null;
			}
		}

		const pending = [...this.#preRegistrationOutputs.values()].sort(
			(left, right) => left.tick.sequence - right.tick.sequence,
		);
		this.#preRegistrationOutputs.clear();
		for (const output of pending)
			this.#receiveCurrentOutput(output.tick, output.receivedAtMs);
	}

	/** Submit a newer projection revision; acknowledgement is carried by a later camera tick. */
	async setClearance(projection: ProjectionClearanceRevision): Promise<void> {
		validateProjection(projection);
		if (projection.revision <= this.#lastRequestedProjectionRevision) return;
		this.#lastRequestedProjectionRevision = projection.revision;
		this.#projectionRevisions.set(projection.revision, projection);
		const identity = this.#identity;
		if (identity === null) return;
		try {
			await this.#lifecycle.setCameraClearance({
				...identity,
				projectionRevision: projection.revision,
				clearanceRadius: projection.clearanceRadius,
			});
		} catch (error) {
			if (
				this.#identity !== null &&
				sameIdentity(this.#identity, identity) &&
				this.#lastRequestedProjectionRevision === projection.revision
			) {
				this.#lastRequestedProjectionRevision =
					this.#activeProjection()?.revision ?? 0;
			}
			throw error;
		}
	}

	/** Submit only changed view input and accumulate wheel displacement exactly once. */
	async setIntent(
		viewDirection: readonly [number, number, number],
		zoomDisplacement: number,
	): Promise<void> {
		validateDirection(viewDirection);
		if (!Number.isFinite(zoomDisplacement))
			throw new Error("Client camera zoom displacement must be finite.");
		this.#cumulativeZoomDisplacement += zoomDisplacement;
		if (!Number.isFinite(this.#cumulativeZoomDisplacement))
			throw new Error("Client camera cumulative zoom displacement overflowed.");
		const identity = this.#identity;
		if (identity === null) return;
		if (
			this.#lastSubmittedDirection !== null &&
			vectorsEqual(viewDirection, this.#lastSubmittedDirection) &&
			this.#cumulativeZoomDisplacement === this.#lastSubmittedZoomDisplacement
		)
			return;
		if (!Number.isSafeInteger(this.#nextInputSequence))
			throw new Error("Client camera input sequence exhausted.");
		const inputSequence = this.#nextInputSequence++;
		const cumulativeZoomDisplacement = this.#cumulativeZoomDisplacement;
		this.#lastSubmittedDirection = [...viewDirection];
		this.#lastSubmittedZoomDisplacement = cumulativeZoomDisplacement;
		try {
			await this.#lifecycle.setCameraIntent({
				...identity,
				inputSequence,
				viewDirection,
				cumulativeZoomDisplacement,
			});
		} catch (error) {
			if (
				this.#identity !== null &&
				sameIdentity(this.#identity, identity) &&
				this.#lastSubmittedZoomDisplacement === cumulativeZoomDisplacement
			) {
				this.#lastSubmittedDirection = null;
			}
			throw error;
		}
	}

	/** Accept one validated host tick; path playback is latest-wins but bounded to two paths. */
	receive(tick: ClientCameraTick, receivedAtMs: number): void {
		if (!Number.isFinite(receivedAtMs))
			throw new Error("Client camera receipt time must be finite.");
		this.#receiveCurrentOutput(tick, receivedAtMs);
	}

	presentation(nowMs: number): HostKinematicBoomPresentation | null {
		if (!Number.isFinite(nowMs))
			throw new Error("Client camera sample time must be finite.");
		this.#advancePlayback(nowMs);
		const active = this.#active;
		if (active === null) return null;
		return evaluateHostKinematicBoomPath(
			active.tick.path,
			active.tick.durationMs,
			nowMs - this.#activeStartedAtMs,
		);
	}

	acknowledgedProjection(nowMs: number): ProjectionClearanceRevision | null {
		if (!Number.isFinite(nowMs))
			throw new Error("Client camera projection sample time must be finite.");
		this.#advancePlayback(nowMs);
		return this.#activeProjection();
	}

	status(): ClientCameraStatus {
		const identity = this.#identity;
		if (identity === null) {
			return this.#registrationPending
				? { kind: "awaiting-registration" }
				: { kind: "stopped" };
		}
		const latest = this.#latestPath;
		if (latest === null) return { kind: "awaiting-first-path", identity };
		return {
			kind: "active",
			identity,
			sequence: latest.sequence,
			targetSphereRole: latest.targetSphereRole,
			clearance: latest.kind === "fallback" ? null : latest.clearance,
			desiredReach: latest.desiredReach,
			renderedReach: latest.kind === "fallback" ? 0 : latest.renderedReach,
			placementOutcome:
				latest.kind === "held"
					? { kind: "held", reason: latest.reason }
					: latest.kind === "reseeded"
						? { kind: "reseeded", reason: latest.reason }
						: latest.kind === "fallback"
							? { kind: "fallback", reason: latest.reason }
							: null,
			droppedPaths: this.#droppedPaths,
			diagnostics: latest.diagnostics,
		};
	}

	get running(): boolean {
		return this.#identity !== null || this.#registrationPending;
	}

	/** Stop the current generation and release all path/projection state. */
	async stop(): Promise<void> {
		++this.#lifecycleRevision;
		const identity = this.#identity;
		this.#rejectRegistration(
			new Error("Client camera registration was cancelled."),
		);
		this.#resetSession();
		if (identity !== null) await this.#lifecycle.stopCamera(identity);
	}

	destroy(): void {
		this.#unsubscribe();
		this.#rejectRegistration(new Error("Client camera session was destroyed."));
		this.#resetSession();
	}

	#receiveStarted(receipt: ClientCameraStartReceipt): void {
		const target = this.#registrationTarget;
		if (!this.#registrationPending || target === null) return;
		if (
			receipt.playerGuid !== target.playerGuid ||
			receipt.entityGeneration !== target.entityGeneration
		) {
			this.#rejectRegistration(
				new Error("Client camera registration receipt changed its target."),
			);
			return;
		}
		this.#identity = receipt;
		this.#registrationPending = false;
		this.#registrationTarget = null;
		const resolve = this.#registrationResolve;
		this.#registrationResolve = null;
		this.#registrationReject = null;
		resolve?.();
	}

	#receiveCurrentOutput(
		tick: ClientCameraTick,
		receivedAtMs = performance.now(),
	): void {
		const received = { tick, receivedAtMs };
		const identity = this.#identity;
		if (identity === null) {
			if (this.#registrationPending) {
				this.#preRegistrationOutputs.set(tick.sequence, received);
				this.#boundPreRegistrationOutputs();
			}
			return;
		}
		if (!sameIdentity(tick, identity)) return;
		if (tick.sequence <= this.#highestSequence) return;
		if (tick.sequence > this.#highestSequence + 1)
			this.#droppedPaths += tick.sequence - this.#highestSequence - 1;
		this.#highestSequence = tick.sequence;
		this.#latestPath = tick;
		if (tick.kind === "fallback") {
			this.#acceptPath({ tick }, receivedAtMs);
			this.#pruneProjectionRevisions();
			return;
		}
		const projection = this.#projectionRevisions.get(
			tick.clearance.projectionRevision,
		);
		if (projection === undefined) {
			throw new Error(
				`Client camera acknowledged unknown projection revision ${tick.clearance.projectionRevision}.`,
			);
		}
		this.#acceptPath({ tick }, receivedAtMs);
		this.#pruneProjectionRevisions();
	}

	#acceptPath(path: PlaybackPath, receivedAtMs: number): void {
		const { tick } = path;
		if (tick.kind !== "advanced" || this.#active?.tick.kind === "fallback") {
			this.#active = path;
			this.#pending = null;
			this.#activeStartedAtMs = receivedAtMs;
			return;
		}
		if (this.#active === null) {
			this.#active = path;
			this.#activeStartedAtMs = receivedAtMs;
			return;
		}
		const activeEndsAt = this.#activeStartedAtMs + this.#active.tick.durationMs;
		if (receivedAtMs >= activeEndsAt) {
			const pending = this.#pending;
			if (pending === null) {
				this.#active = path;
				this.#activeStartedAtMs = receivedAtMs;
				return;
			}
			const pendingEndsAt = activeEndsAt + pending.tick.durationMs;
			if (receivedAtMs >= pendingEndsAt) {
				this.#active = path;
				this.#pending = null;
				this.#activeStartedAtMs = receivedAtMs;
				return;
			}
			this.#active = pending;
			this.#pending = path;
			this.#activeStartedAtMs = activeEndsAt;
			return;
		}
		if (this.#pending === null) {
			this.#pending = path;
			return;
		}
		this.#droppedPaths += 1;
		this.#active = path;
		this.#pending = null;
		this.#activeStartedAtMs = receivedAtMs;
	}

	#advancePlayback(nowMs: number): void {
		const active = this.#active;
		if (
			active === null ||
			nowMs - this.#activeStartedAtMs < active.tick.durationMs ||
			this.#pending === null
		)
			return;
		this.#activeStartedAtMs += active.tick.durationMs;
		this.#active = this.#pending;
		this.#pending = null;
		this.#pruneProjectionRevisions();
	}

	#activeProjection(): ProjectionClearanceRevision | null {
		const tick = this.#active?.tick;
		if (tick === undefined || tick.kind === "fallback") return null;
		return (
			this.#projectionRevisions.get(tick.clearance.projectionRevision) ?? null
		);
	}

	#pruneProjectionRevisions(): void {
		const retained = new Set([this.#lastRequestedProjectionRevision]);
		for (const playback of [this.#active, this.#pending]) {
			const tick = playback?.tick;
			if (tick !== undefined && tick.kind !== "fallback") {
				retained.add(tick.clearance.projectionRevision);
			}
		}
		for (const revision of this.#projectionRevisions.keys()) {
			if (!retained.has(revision)) this.#projectionRevisions.delete(revision);
		}
	}

	#boundPreRegistrationOutputs(): void {
		if (this.#preRegistrationOutputs.size <= MAX_PRE_REGISTRATION_OUTPUTS)
			return;
		const oldest = Math.min(...this.#preRegistrationOutputs.keys());
		this.#preRegistrationOutputs.delete(oldest);
		this.#droppedPaths += 1;
	}

	#rejectRegistration(error: unknown): void {
		const reject = this.#registrationReject;
		this.#registrationResolve = null;
		this.#registrationReject = null;
		reject?.(error);
	}

	#resetSession(): void {
		this.#registrationPending = false;
		this.#identity = null;
		this.#registrationTarget = null;
		this.#preRegistrationOutputs.clear();
		this.#highestSequence = 0;
		this.#active = null;
		this.#pending = null;
		this.#activeStartedAtMs = 0;
		this.#droppedPaths = 0;
		this.#latestPath = null;
		this.#nextInputSequence = 1;
		this.#cumulativeZoomDisplacement = 0;
		this.#lastSubmittedDirection = null;
		this.#lastSubmittedZoomDisplacement = 0;
		this.#lastRequestedProjectionRevision = 0;
		this.#projectionRevisions.clear();
	}
}

function sameIdentity(
	left: ClientCameraIdentity | ClientCameraTick,
	right: ClientCameraIdentity,
): boolean {
	return (
		left.cameraGeneration === right.cameraGeneration &&
		left.playerGuid === right.playerGuid &&
		left.entityGeneration === right.entityGeneration
	);
}

function validateTarget(target: ClientCameraTarget): void {
	if (
		!Number.isSafeInteger(target.playerGuid) ||
		target.playerGuid < 0 ||
		target.playerGuid > 0xffff_ffff ||
		!Number.isSafeInteger(target.entityGeneration) ||
		target.entityGeneration < 0
	)
		throw new Error("Client camera target must carry a valid player identity.");
}

function validateDistancePolicy(policy: ClientCameraDistancePolicy): void {
	if (
		!Number.isFinite(policy.minimum) ||
		policy.minimum < 0 ||
		!Number.isFinite(policy.maximum) ||
		policy.maximum < policy.minimum ||
		!Number.isFinite(policy.initial) ||
		policy.initial < policy.minimum ||
		policy.initial > policy.maximum
	)
		throw new Error(
			"Client camera distance policy requires finite ordered bounds containing the initial distance.",
		);
}

function validateDirection(direction: readonly [number, number, number]): void {
	if (
		direction.some((component) => !Number.isFinite(component)) ||
		Math.hypot(...direction) <= Number.EPSILON
	)
		throw new Error("Client camera view direction must be finite and nonzero.");
}

function validateProjection(projection: ProjectionClearanceRevision): void {
	if (
		!Number.isSafeInteger(projection.revision) ||
		projection.revision <= 0 ||
		!Number.isFinite(projection.clearanceRadius) ||
		projection.clearanceRadius <= 0
	)
		throw new Error(
			"Client camera projection clearance requires a positive revision and radius.",
		);
}

function vectorsEqual(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	return left.every((component, index) => component === right[index]);
}
