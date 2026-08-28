import {
	decodeHostKinematicBoomIdentity,
	decodeHostKinematicBoomUpdateReceipt,
	evaluateHostKinematicBoomPath,
	sameHostKinematicBoomIdentity,
	type HostKinematicBoomFailureReason,
	type HostKinematicBoomIdentity,
	type HostKinematicBoomReseedReason,
	type HostKinematicBoomPresentation,
	type HostKinematicBoomTick,
} from "../motion/host-kinematic-boom-path";
import type { ProjectionClearanceRevision } from "./projection-clearance";
import type {
	HostCommandArguments,
	HostCommandName,
	HostTransport,
} from "../../host/host-transport";

/** Possessed entity tuple required before the host will create a boom generation. */
export interface HostKinematicBoomTarget {
	readonly possessionGeneration: number;
	readonly guid: number;
	readonly entityGeneration: number;
}

/** Complete operator-requested distance policy validated again at the host boundary. */
export interface HostKinematicBoomDistancePolicy {
	readonly initial: number;
	readonly minimum: number;
	readonly maximum: number;
}

type HostKinematicBoomProvenTick = Exclude<
	HostKinematicBoomTick,
	{ readonly kind: "fallback" }
>;

/** Injectable command boundary; fixed-tick delivery remains owned by the entity session. */
export interface HostKinematicBoomTransport {
	invoke(
		command: Extract<
			HostCommandName,
			| "start_kinematic_boom"
			| "set_kinematic_boom_intent"
			| "set_kinematic_boom_clearance"
			| "stop_kinematic_boom"
		>,
		args?: HostCommandArguments,
	): Promise<unknown>;
}

/** Explorer-visible host session state without frontend collision or recovery policy. */
export type HostKinematicBoomStatus =
	| { readonly kind: "stopped" }
	| { readonly kind: "awaiting-registration" }
	| {
			readonly kind: "awaiting-first-path";
			readonly identity: HostKinematicBoomIdentity;
	  }
	| {
			readonly kind: "active";
			readonly identity: HostKinematicBoomIdentity;
			readonly sequence: number;
			readonly targetSphereRole: HostKinematicBoomTick["targetSphereRole"];
			readonly clearance: HostKinematicBoomProvenTick["clearance"] | null;
			readonly desiredReach: number;
			readonly renderedReach: number;
			/**
			 * How the latest tick placed the camera, or null when it moved continuously.
			 *
			 * Not a fault indicator: a `reseeded` outcome covers the generation's ordinary first
			 * tick as well as the two recoveries, so its reason is what says whether anything went
			 * wrong. Held and fallback outcomes follow failures, but only held retains a proven
			 * placement and projection envelope.
			 */
			readonly placementOutcome:
				| {
						readonly kind: "held";
						readonly reason: HostKinematicBoomFailureReason;
				  }
				| {
						readonly kind: "reseeded";
						readonly reason: HostKinematicBoomReseedReason;
				  }
				| {
						readonly kind: "fallback";
						readonly reason: HostKinematicBoomFailureReason;
				  }
				| null;
			readonly droppedPaths: number;
			readonly diagnostics: HostKinematicBoomTick["diagnostics"];
	  };

interface ReceivedBoomTick {
	readonly tick: HostKinematicBoomTick;
	readonly durationMs: number;
	readonly receivedAtMs: number;
}

interface PlaybackPath {
	readonly tick: HostKinematicBoomTick;
	readonly durationMs: number;
}

const MAX_PRE_REGISTRATION_OUTPUTS = 2;

/** Owns exact host lifecycle, latest-wins intent, and phase-aligned camera presentation. */
export class HostKinematicBoomSession {
	readonly #transport: HostKinematicBoomTransport;
	#lifecycleRevision = 0;
	#registrationPending = false;
	#identity: HostKinematicBoomIdentity | null = null;
	#preRegistrationOutputs = new Map<number, ReceivedBoomTick>();
	#highestSequence = 0;
	#active: PlaybackPath | null = null;
	#pending: PlaybackPath | null = null;
	#activeStartedAtMs = 0;
	#droppedPaths = 0;
	#latestPath: HostKinematicBoomTick | null = null;
	#nextInputSequence = 1;
	#cumulativeZoomDisplacement = 0;
	#lastSubmittedDirection: readonly [number, number, number] | null = null;
	#lastSubmittedZoomDisplacement = 0;
	#lastRequestedProjectionRevision = 0;
	#projectionRevisions = new Map<number, ProjectionClearanceRevision>();

	constructor(transport: HostKinematicBoomTransport) {
		this.#transport = transport;
	}

	/** Replace any prior generation and register against one exact current possession. */
	async start(
		target: HostKinematicBoomTarget,
		distance: HostKinematicBoomDistancePolicy,
		viewDirection: readonly [number, number, number],
		projection: ProjectionClearanceRevision,
	): Promise<void> {
		validateTarget(target);
		validateDistancePolicy(distance);
		validateDirection(viewDirection);
		validateProjection(projection);
		const revision = ++this.#lifecycleRevision;
		const previous = this.#identity;
		this.#resetSession();
		this.#registrationPending = true;
		this.#lastSubmittedDirection = [...viewDirection];
		this.#lastRequestedProjectionRevision = projection.revision;
		this.#projectionRevisions.set(projection.revision, projection);
		if (previous !== null) {
			await this.#transport.invoke("stop_kinematic_boom", {
				request: previous,
			});
			if (revision !== this.#lifecycleRevision) return;
		}
		try {
			const identity = decodeHostKinematicBoomIdentity(
				await this.#transport.invoke("start_kinematic_boom", {
					request: {
						possessionGeneration: target.possessionGeneration,
						guid: target.guid,
						entityGeneration: target.entityGeneration,
						initialReach: distance.initial,
						minimumReach: distance.minimum,
						maximumReach: distance.maximum,
						inputSequence: 0,
						viewDirection,
						cumulativeZoomDisplacement: 0,
						projectionRevision: projection.revision,
						clearanceRadius: projection.clearanceRadius,
					},
				}),
			);
			if (revision !== this.#lifecycleRevision) {
				await this.#transport.invoke("stop_kinematic_boom", {
					request: identity,
				});
				return;
			}
			if (
				identity.possessionGeneration !== target.possessionGeneration ||
				identity.guid !== target.guid ||
				identity.entityGeneration !== target.entityGeneration
			) {
				await this.#transport.invoke("stop_kinematic_boom", {
					request: identity,
				});
				throw new Error(
					"Host boom registration receipt changed its possession target.",
				);
			}
			this.#identity = identity;
			this.#registrationPending = false;
			const latestProjection = [...this.#projectionRevisions.values()].at(-1);
			if (
				latestProjection !== undefined &&
				latestProjection.revision > projection.revision
			) {
				await this.#submitClearance(latestProjection, identity);
			}
			const pending = [...this.#preRegistrationOutputs.values()].sort(
				(left, right) => left.tick.sequence - right.tick.sequence,
			);
			this.#preRegistrationOutputs.clear();
			for (const output of pending) {
				if (sameHostKinematicBoomIdentity(output.tick, identity)) {
					this.#receiveCurrentOutput(output);
				}
			}
		} catch (error) {
			if (revision === this.#lifecycleRevision) this.#resetSession();
			throw error;
		}
	}

	/** Submit a newer projection envelope without coupling it to orbit or zoom sequencing. */
	async setClearance(projection: ProjectionClearanceRevision): Promise<void> {
		validateProjection(projection);
		if (projection.revision <= this.#lastRequestedProjectionRevision) return;
		this.#lastRequestedProjectionRevision = projection.revision;
		this.#projectionRevisions.set(projection.revision, projection);
		const identity = this.#identity;
		if (identity === null) return;
		try {
			await this.#submitClearance(projection, identity);
		} catch (error) {
			if (
				this.#identity !== null &&
				sameHostKinematicBoomIdentity(this.#identity, identity) &&
				this.#lastRequestedProjectionRevision === projection.revision
			) {
				const activeProjection = this.#activeProjection();
				this.#lastRequestedProjectionRevision =
					activeProjection === null ? 0 : activeProjection.revision;
			}
			throw error;
		}
	}

	async #submitClearance(
		projection: ProjectionClearanceRevision,
		identity: HostKinematicBoomIdentity,
	): Promise<void> {
		decodeHostKinematicBoomUpdateReceipt(
			await this.#transport.invoke("set_kinematic_boom_clearance", {
				request: {
					...identity,
					projectionRevision: projection.revision,
					clearanceRadius: projection.clearanceRadius,
				},
			}),
		);
	}

	/** Complete frontend projection most recently acknowledged by a host camera path. */
	acknowledgedProjection(nowMs: number): ProjectionClearanceRevision | null {
		if (!Number.isFinite(nowMs)) {
			throw new Error("Boom projection sample time must be finite.");
		}
		this.#advancePlayback(nowMs);
		return this.#activeProjection();
	}

	/** Detach presentation state first, then stop exactly the generation that was owned. */
	async stop(): Promise<void> {
		++this.#lifecycleRevision;
		const identity = this.#identity;
		this.#resetSession();
		if (identity !== null) {
			await this.#transport.invoke("stop_kinematic_boom", {
				request: identity,
			});
		}
	}

	/** Send only changed view input while accumulating every wheel displacement exactly once. */
	async setIntent(
		viewDirection: readonly [number, number, number],
		zoomDisplacement: number,
	): Promise<void> {
		validateDirection(viewDirection);
		if (!Number.isFinite(zoomDisplacement)) {
			throw new Error("Boom zoom displacement must be finite.");
		}
		this.#cumulativeZoomDisplacement += zoomDisplacement;
		if (!Number.isFinite(this.#cumulativeZoomDisplacement)) {
			throw new Error("Boom cumulative zoom displacement overflowed.");
		}
		const identity = this.#identity;
		if (identity === null) return;
		if (
			this.#lastSubmittedDirection !== null &&
			vectorsEqual(viewDirection, this.#lastSubmittedDirection) &&
			this.#cumulativeZoomDisplacement === this.#lastSubmittedZoomDisplacement
		) {
			return;
		}
		if (!Number.isSafeInteger(this.#nextInputSequence)) {
			throw new Error("Boom input sequence exhausted.");
		}
		const inputSequence = this.#nextInputSequence++;
		const cumulativeZoomDisplacement = this.#cumulativeZoomDisplacement;
		this.#lastSubmittedDirection = [...viewDirection];
		this.#lastSubmittedZoomDisplacement = cumulativeZoomDisplacement;
		try {
			decodeHostKinematicBoomUpdateReceipt(
				await this.#transport.invoke("set_kinematic_boom_intent", {
					request: {
						...identity,
						inputSequence,
						viewDirection,
						cumulativeZoomDisplacement,
					},
				}),
			);
		} catch (error) {
			if (
				this.#identity !== null &&
				sameHostKinematicBoomIdentity(this.#identity, identity) &&
				this.#lastSubmittedDirection !== null &&
				vectorsEqual(this.#lastSubmittedDirection, viewDirection) &&
				this.#lastSubmittedZoomDisplacement === cumulativeZoomDisplacement
			) {
				this.#lastSubmittedDirection = null;
			}
			throw error;
		}
	}

	/** Accept one decoded tick while validating the containing envelope's shared receipt instant. */
	receive(
		tick: HostKinematicBoomTick,
		durationMs: number,
		receivedAtMs: number,
	): void {
		if (!Number.isFinite(durationMs) || durationMs <= 0) {
			throw new Error("Boom playback duration must be positive and finite.");
		}
		if (!Number.isFinite(receivedAtMs)) {
			throw new Error("Boom receipt time must be finite.");
		}
		const received: ReceivedBoomTick = { tick, durationMs, receivedAtMs };
		const identity = this.#identity;
		if (identity === null) {
			if (this.#registrationPending) {
				this.#preRegistrationOutputs.set(tick.sequence, received);
				this.#boundPreRegistrationOutputs();
			}
			return;
		}
		if (!sameHostKinematicBoomIdentity(tick, identity)) return;
		this.#receiveCurrentOutput(received);
	}

	/** Sample one phase-aligned host-authored camera placement and visual pivot. */
	presentation(nowMs: number): HostKinematicBoomPresentation | null {
		if (!Number.isFinite(nowMs))
			throw new Error("Boom sample time must be finite.");
		this.#advancePlayback(nowMs);
		const active = this.#active;
		if (active === null) return null;
		return evaluateHostKinematicBoomPath(
			active.tick.path,
			active.durationMs,
			nowMs - this.#activeStartedAtMs,
		);
	}

	/** Snapshot current host evidence for Explorer diagnostics. */
	status(): HostKinematicBoomStatus {
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

	#receiveCurrentOutput(received: ReceivedBoomTick): void {
		const sequence = received.tick.sequence;
		if (sequence <= this.#highestSequence) return;
		if (sequence > this.#highestSequence + 1) {
			this.#droppedPaths += sequence - this.#highestSequence - 1;
		}
		this.#highestSequence = sequence;
		this.#acceptOutput(received);
	}

	#acceptOutput(received: ReceivedBoomTick): void {
		const tick = received.tick;
		this.#latestPath = tick;
		if (tick.kind === "fallback") {
			this.#acceptPath(tick, received.durationMs, received.receivedAtMs);
			this.#pruneProjectionRevisions();
			return;
		}
		const projection = this.#projectionRevisions.get(
			tick.clearance.projectionRevision,
		);
		if (projection === undefined) {
			throw new Error(
				`Host acknowledged unknown camera projection revision ${tick.clearance.projectionRevision}.`,
			);
		}
		this.#acceptPath(tick, received.durationMs, received.receivedAtMs);
		this.#pruneProjectionRevisions();
	}

	#acceptPath(
		tick: HostKinematicBoomTick,
		durationMs: number,
		receivedAtMs: number,
	): void {
		const path = { tick, durationMs };
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
		const activeEndsAt = this.#activeStartedAtMs + this.#active.durationMs;
		if (receivedAtMs >= activeEndsAt) {
			const pending = this.#pending;
			if (pending === null) {
				this.#active = path;
				this.#activeStartedAtMs = receivedAtMs;
				return;
			}
			const pendingEndsAt = activeEndsAt + pending.durationMs;
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
			nowMs - this.#activeStartedAtMs < active.durationMs ||
			this.#pending === null
		) {
			return;
		}
		this.#activeStartedAtMs += active.durationMs;
		this.#active = this.#pending;
		this.#pending = null;
		this.#pruneProjectionRevisions();
	}

	#activeProjection(): ProjectionClearanceRevision | null {
		const tick = this.#active?.tick;
		if (tick === undefined || tick.kind === "fallback") return null;
		const projection = this.#projectionRevisions.get(
			tick.clearance.projectionRevision,
		);
		return projection === undefined ? null : projection;
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

	#resetSession(): void {
		this.#registrationPending = false;
		this.#identity = null;
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

/** Host command adapter; fixed-tick listener ownership stays in one entity session. */
export function hostKinematicBoomTransport(
	host: HostTransport,
): HostKinematicBoomTransport {
	return {
		invoke: (command, args) => host.invoke(command, args),
	};
}

function validateTarget(target: HostKinematicBoomTarget): void {
	if (
		!Number.isSafeInteger(target.possessionGeneration) ||
		target.possessionGeneration <= 0 ||
		!Number.isSafeInteger(target.entityGeneration) ||
		target.entityGeneration <= 0 ||
		!Number.isSafeInteger(target.guid) ||
		target.guid < 0 ||
		target.guid > 0xffff_ffff
	) {
		throw new Error(
			"Boom target must carry valid possession, entity, and GUID identity.",
		);
	}
}

function validateDistancePolicy(policy: HostKinematicBoomDistancePolicy): void {
	if (
		!Number.isFinite(policy.minimum) ||
		policy.minimum < 0 ||
		!Number.isFinite(policy.maximum) ||
		policy.maximum < policy.minimum ||
		!Number.isFinite(policy.initial) ||
		policy.initial < policy.minimum ||
		policy.initial > policy.maximum
	) {
		throw new Error(
			"Boom distance policy requires finite ordered bounds containing the initial distance.",
		);
	}
}

function validateDirection(direction: readonly [number, number, number]): void {
	if (
		direction.some((component) => !Number.isFinite(component)) ||
		Math.hypot(...direction) <= Number.EPSILON
	) {
		throw new Error("Boom view direction must be finite and nonzero.");
	}
}

function validateProjection(projection: ProjectionClearanceRevision): void {
	if (
		!Number.isSafeInteger(projection.revision) ||
		projection.revision <= 0 ||
		!Number.isFinite(projection.clearanceRadius) ||
		projection.clearanceRadius <= 0
	) {
		throw new Error(
			"Boom projection clearance requires a positive revision and radius.",
		);
	}
}

function vectorsEqual(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	return left.every((component, index) => component === right[index]);
}
