import {
	evaluateHostPhysicalFlyPath,
	type HostPhysicalFlyPath,
	type PhysicalFlyGroundState,
	type PhysicalFlyTickStatus,
	type PhysicalFlySceneResidency,
	validateHostPhysicalFlyPath,
} from "../lib/game/motion/host-physical-fly-path";
import type { HostCameraPlacement } from "../lib/game/motion/host-placed-path";
import type { EnvCellId } from "../lib/game/game-types";
import { EXPLORER_TUNING } from "./explorer-tuning";
import type {
	HostCommandArguments,
	HostCommandName,
} from "../lib/host/host-transport";

type PhysicalFlySpeedEnvelope =
	| {
			/** Apply requested speed immediately. */
			readonly kind: "instant";
	  }
	| {
			/** Linearly ramp a held nonzero request from an initial fraction to full speed. */
			readonly kind: "linear-ramp";
			/** Seconds of uninterrupted movement input required to reach full speed. */
			readonly accelerationSeconds: number;
			/** Fraction of requested speed applied when movement begins. */
			readonly initialSpeedMultiplier: number;
	  };

/** Explorer translation feel applied by the host before generic physical-body solving. */
function physicalFlyCameraSpeedEnvelope(): PhysicalFlySpeedEnvelope {
	return {
		kind: "linear-ramp",
		accelerationSeconds:
			EXPLORER_TUNING.camera.controls.keyboardAccelerationSeconds,
		initialSpeedMultiplier:
			EXPLORER_TUNING.camera.controls.keyboardInitialSpeedMultiplier,
	};
}

/** Injectable transport boundary for one host-solved camera session. */
export interface PhysicalFlyTransport {
	invoke(
		command: Extract<
			HostCommandName,
			"start_physical_fly" | "set_physical_fly_intent" | "stop_physical_fly"
		>,
		args?: HostCommandArguments,
	): Promise<unknown>;
	listenMotion(
		event: "explorer-physical-fly-motion",
		handler: (path: HostPhysicalFlyPath) => void,
	): Promise<() => void>;
	listenFailure(
		event: "explorer-physical-fly-failure",
		handler: (failure: HostPhysicalFlyFailure) => void,
	): Promise<() => void>;
	now(): number;
}

/** Terminal host failure scoped to one exact camera ownership generation. */
export interface HostPhysicalFlyFailure {
	readonly session: number;
	readonly message: string;
}

/** Explorer-visible diagnostics for the current host session. */
export interface PhysicalFlyStatus {
	readonly tick: PhysicalFlyTickStatus | "awaiting-first-path";
	readonly cellId: EnvCellId | null;
	readonly groundState: PhysicalFlyGroundState;
	readonly constraintCount: number;
	readonly droppedPaths: number;
	readonly sceneResidency: PhysicalFlySceneResidency | null;
	readonly substeps: number;
	readonly contactPasses: number;
	readonly solveDurationMs: number;
}

/** Owns transport ordering and bounded fixed-tick playback for one physical-fly handoff. */
export class PhysicalFlySession {
	readonly #transport: PhysicalFlyTransport;
	#unlisten: (() => void) | null = null;
	#session: number | null = null;
	#preRegistrationPath: HostPhysicalFlyPath | null = null;
	#preRegistrationFailure: HostPhysicalFlyFailure | null = null;
	#terminalError: Error | null = null;
	#activePath: HostPhysicalFlyPath | null = null;
	#pendingPath: HostPhysicalFlyPath | null = null;
	#activeStartedAt = 0;
	#latestPath: HostPhysicalFlyPath | null = null;
	#highestSequence = -1;
	#droppedPaths = 0;
	#intentSequence = 0;
	#movementEpoch = 0;
	#movementActive = false;
	#lastIntent: PhysicalFlyInput | null = null;
	#worldDisplacementTotal: [number, number, number] = [0, 0, 0];

	constructor(transport: PhysicalFlyTransport) {
		this.#transport = transport;
	}

	/** Registers the listener before starting the host so the first path cannot be missed. */
	async start(placement: HostCameraPlacement): Promise<void> {
		if (this.#unlisten !== null) return;
		const unlistenMotion = await this.#transport.listenMotion(
			"explorer-physical-fly-motion",
			(path) => this.#receivePath(path),
		);
		let unlistenFailure: (() => void) | null = null;
		try {
			unlistenFailure = await this.#transport.listenFailure(
				"explorer-physical-fly-failure",
				(failure) => this.#receiveFailure(failure),
			);
			this.#unlisten = () => {
				unlistenMotion();
				unlistenFailure?.();
			};
			const result = await this.#transport.invoke("start_physical_fly", {
				registration: {
					residency: placement.residency,
					scenePosition: [
						placement.position.x,
						placement.position.y,
						placement.position.z,
					],
					speedEnvelope: physicalFlyCameraSpeedEnvelope(),
				},
			});
			const receipt = physicalFlyStartReceipt(result);
			this.#session = receipt.session;
			const pending = this.#preRegistrationPath;
			this.#preRegistrationPath = null;
			if (pending?.session === receipt.session) this.#acceptPath(pending);
			const failure = this.#preRegistrationFailure;
			this.#preRegistrationFailure = null;
			if (failure?.session === receipt.session) this.#acceptFailure(failure);
		} catch (error) {
			this.#unlisten?.();
			if (this.#unlisten === null) unlistenMotion();
			this.#unlisten = null;
			throw error;
		}
	}

	/** Stops exactly this generation and releases its event listener. */
	async stop(): Promise<void> {
		const unlisten = this.#unlisten;
		const session = this.#session;
		if (unlisten === null) return;
		try {
			if (session !== null) {
				await this.#transport.invoke("stop_physical_fly", { session });
			}
		} finally {
			unlisten();
			this.#reset();
		}
	}

	get running(): boolean {
		return this.#unlisten !== null && this.#session !== null;
	}

	/** Sends one concrete movement intent only when owned input changes. */
	async setIntent(
		worldVelocity: readonly [number, number, number],
	): Promise<void> {
		const session = this.#session;
		if (session === null) return;
		const input = { worldVelocity };
		const movementActive = worldVelocity.some((component) => component !== 0);
		if (movementActive && !this.#movementActive) this.#movementEpoch += 1;
		this.#movementActive = movementActive;
		if (this.#lastIntent !== null && inputsEqual(input, this.#lastIntent))
			return;
		this.#lastIntent = input;
		const sequence = this.#intentSequence++;
		try {
			await this.#transport.invoke("set_physical_fly_intent", {
				intent: {
					movementEpoch: this.#movementEpoch,
					session,
					sequence,
					worldDisplacementTotal: this.#worldDisplacementTotal,
					worldVelocity,
				},
			});
		} catch (error) {
			// Permit an identical input event to retry, but do not roll back over a newer intent.
			if (this.#lastIntent !== null && inputsEqual(this.#lastIntent, input)) {
				this.#lastIntent = null;
			}
			throw error;
		}
	}

	/** Queues one collision-solved displacement without replacing held velocity. */
	async addDisplacement(
		worldDisplacement: readonly [number, number, number],
		worldVelocity: readonly [number, number, number],
	): Promise<void> {
		this.#worldDisplacementTotal = this.#worldDisplacementTotal.map(
			(component, index) => component + worldDisplacement[index],
		) as [number, number, number];
		this.#lastIntent = null;
		await this.setIntent(worldVelocity);
	}

	placement(): HostCameraPlacement | null {
		const now = this.#transport.now();
		this.#advancePlayback(now);
		if (this.#activePath === null) return null;
		return evaluateHostPhysicalFlyPath(
			this.#activePath,
			now - this.#activeStartedAt,
		);
	}

	status(): PhysicalFlyStatus {
		const latest = this.#latestPath;
		return {
			tick: latest?.status ?? "awaiting-first-path",
			cellId: latest?.legs.at(-1)?.end.residency.envCellId ?? null,
			groundState: latest?.groundState ?? "unknown",
			constraintCount: latest?.constraintCount ?? 0,
			droppedPaths: this.#droppedPaths,
			sceneResidency: latest?.sceneResidency ?? null,
			substeps: latest?.substeps ?? 0,
			contactPasses: latest?.contactPasses ?? 0,
			solveDurationMs: latest?.solveDurationMs ?? 0,
		};
	}

	/** Drains one terminal host error so the owning UI can perform a deliberate handoff. */
	takeTerminalError(): Error | null {
		const error = this.#terminalError;
		this.#terminalError = null;
		return error;
	}

	#receiveFailure(failure: HostPhysicalFlyFailure): void {
		validatePhysicalFlyFailure(failure);
		if (this.#session === null) {
			this.#preRegistrationFailure = failure;
			return;
		}
		if (failure.session === this.#session) this.#acceptFailure(failure);
	}

	#acceptFailure(failure: HostPhysicalFlyFailure): void {
		this.#terminalError = new Error(
			`Physical camera host tick failed: ${failure.message}`,
		);
	}

	#receivePath(path: HostPhysicalFlyPath): void {
		if (this.#session === null) {
			this.#preRegistrationPath = path;
			return;
		}
		if (path.session !== this.#session) return;
		this.#acceptPath(path);
	}

	#acceptPath(path: HostPhysicalFlyPath): void {
		if (path.sequence <= this.#highestSequence) return;
		validateHostPhysicalFlyPath(path);
		const gap = path.sequence - this.#highestSequence - 1;
		this.#droppedPaths += gap;
		this.#highestSequence = path.sequence;
		this.#latestPath = path;
		const now = this.#transport.now();
		if (this.#activePath === null || gap > 0) {
			this.#activePath = path;
			this.#pendingPath = null;
			this.#activeStartedAt = now;
			return;
		}

		const activeEndsAt = this.#activeStartedAt + this.#activePath.durationMs;
		if (now >= activeEndsAt) {
			const pending = this.#pendingPath;
			if (pending === null) {
				// A late successor owns a fresh fixed-tick interval from its explicit initial point.
				this.#activePath = path;
				this.#activeStartedAt = now;
				return;
			}
			const pendingEndsAt = activeEndsAt + pending.durationMs;
			if (now >= pendingEndsAt) {
				// Both retained ticks are stale after suspension. Resume from the newest host point.
				this.#activePath = path;
				this.#pendingPath = null;
				this.#activeStartedAt = now;
				return;
			}
			this.#activePath = pending;
			this.#pendingPath = path;
			this.#activeStartedAt = activeEndsAt;
			return;
		}

		if (this.#pendingPath === null) {
			this.#pendingPath = path;
			return;
		}
		// More than one pending tick means the renderer stopped consuming. Resume from an explicit
		// host point rather than accumulating input latency or fabricating a bridge.
		this.#activePath = path;
		this.#pendingPath = null;
		this.#activeStartedAt = now;
	}

	#advancePlayback(now: number): void {
		const active = this.#activePath;
		if (active === null || now - this.#activeStartedAt < active.durationMs)
			return;
		const pending = this.#pendingPath;
		if (pending === null) return;
		this.#activeStartedAt += active.durationMs;
		this.#activePath = pending;
		this.#pendingPath = null;
	}

	#reset(): void {
		this.#unlisten = null;
		this.#session = null;
		this.#preRegistrationPath = null;
		this.#preRegistrationFailure = null;
		this.#terminalError = null;
		this.#activePath = null;
		this.#pendingPath = null;
		this.#latestPath = null;
		this.#highestSequence = -1;
		this.#droppedPaths = 0;
		this.#intentSequence = 0;
		this.#movementEpoch = 0;
		this.#movementActive = false;
		this.#lastIntent = null;
		this.#worldDisplacementTotal = [0, 0, 0];
	}
}

function validatePhysicalFlyFailure(failure: HostPhysicalFlyFailure): void {
	if (
		!Number.isSafeInteger(failure.session) ||
		failure.session <= 0 ||
		typeof failure.message !== "string" ||
		failure.message.length === 0
	) {
		throw new Error("Host returned an invalid physical-fly failure event.");
	}
}

interface PhysicalFlyInput {
	readonly worldVelocity: readonly [number, number, number];
}

function inputsEqual(left: PhysicalFlyInput, right: PhysicalFlyInput): boolean {
	return vectorsEqual(left.worldVelocity, right.worldVelocity);
}

function vectorsEqual(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	return left.every((component, index) => component === right[index]);
}

function physicalFlyStartReceipt(value: unknown): { readonly session: number } {
	if (typeof value !== "object" || value === null) {
		throw new Error(
			"Host returned an invalid physical-fly registration receipt.",
		);
	}
	const receipt = value as Record<string, unknown>;
	if (
		typeof receipt.session !== "number" ||
		!Number.isSafeInteger(receipt.session) ||
		receipt.session <= 0
	) {
		throw new Error("Host returned an invalid physical-fly session id.");
	}
	return { session: receipt.session };
}
