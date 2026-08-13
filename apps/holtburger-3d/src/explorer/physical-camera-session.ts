import {
	evaluateHostPhysicalCameraPath,
	type HostPhysicalCameraPath,
	type PhysicalCameraMode,
	type PhysicalCameraPlacement,
	type PhysicalCameraTickStatus,
	validateHostPhysicalCameraPath,
} from "../lib/game/motion/host-physical-camera-path";
import type { EnvCellId } from "../lib/game/game-types";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";

interface PhysicalSphereDefinition {
	/** Body-local AC-axis center in meters. */
	readonly center: readonly [number, number, number];
	/** Positive collision radius in meters. */
	readonly radius: number;
}

interface PhysicalBodyDefinition {
	/** Ordered role-bearing geometry supplied to the generic host validator. */
	readonly spheres: readonly PhysicalSphereDefinition[];
	/** Implemented response semantics and finite solve configuration. */
	readonly response:
		| {
				/** Unrestricted three-dimensional single-sphere response. */
				readonly kind: "free-sphere";
				/** Physical-fly solver limits. */
				readonly config: PhysicalFlyResponseConfig;
		  }
		| {
				/** Gravity, support, step, and edge response. */
				readonly kind: "grounded";
				/** Grounded solver and response policy. */
				readonly config: GroundedResponseConfig;
		  };
}

interface PhysicalFlyResponseConfig {
	/** Maximum distance covered by one anti-tunneling subdivision. */
	readonly maximumSubstepDistance: number;
	/** Finite subdivision budget for one host tick. */
	readonly maximumSubsteps: number;
	/** Finite contact-separation budget across one host tick. */
	readonly maximumContactPasses: number;
	/** Small outward separation after an accepted contact. */
	readonly separationEpsilon: number;
}

interface GroundedResponseConfig extends PhysicalFlyResponseConfig {
	/** Downward acceleration while airborne. */
	readonly gravity: number;
	/** Minimum upward normal component accepted as support. */
	readonly walkableNormalZ: number;
	/** Maximum step-up rise in meters. */
	readonly stepUpHeight: number;
	/** Maximum downward support search in meters. */
	readonly stepDownHeight: number;
	/** Policy for retaining support near finite authored edges. */
	readonly edgeProtection: "none" | "creature";
}

type PhysicalCameraSpeedEnvelope =
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
function physicalCameraSpeedEnvelope(
	mode: PhysicalCameraMode,
): PhysicalCameraSpeedEnvelope {
	if (mode === "grounded-walk") return { kind: "instant" };
	return {
		kind: "linear-ramp",
		accelerationSeconds:
			FRONTEND_TUNING.explorer.camera.controls.keyboardAccelerationSeconds,
		initialSpeedMultiplier:
			FRONTEND_TUNING.explorer.camera.controls.keyboardInitialSpeedMultiplier,
	};
}

/** Explorer product policy for its explicit generic camera bodies. */
function physicalCameraBody(mode: PhysicalCameraMode): PhysicalBodyDefinition {
	if (mode === "physical-fly") {
		return {
			spheres: [{ center: [0, 0, 0], radius: 0.25 }],
			response: {
				kind: "free-sphere",
				config: {
					maximumSubstepDistance: 0.25,
					maximumSubsteps: 32,
					maximumContactPasses: 8,
					separationEpsilon: 0.000_5,
				},
			},
		};
	}
	return {
		// Retail's authored human setup pair, projected in source order by SPHEREPATH::init_sphere
		// (`acclient.c:302241-302291`). These are app factory data, not simulator profiles.
		spheres: [
			{ center: [0, 0, 0.475], radius: 0.48 },
			{ center: [0, 0, 1.35], radius: 0.48 },
		],
		response: {
			kind: "grounded",
			config: {
				gravity: -9.8,
				walkableNormalZ: 0.707_106_77,
				stepUpHeight: 0.6,
				stepDownHeight: 1.5,
				edgeProtection: "creature",
				maximumSubstepDistance: 0.24,
				maximumSubsteps: 32,
				maximumContactPasses: 8,
				separationEpsilon: 0.000_5,
			},
		},
	};
}

/** Injectable Tauri boundary for one host-solved camera session. */
export interface PhysicalCameraTransport {
	invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
	listen(
		event: string,
		handler: (path: HostPhysicalCameraPath) => void,
	): Promise<() => void>;
	now(): number;
}

/** Explorer-visible diagnostics for the current host session. */
export interface PhysicalCameraStatus {
	readonly mode: PhysicalCameraMode | null;
	readonly tick: PhysicalCameraTickStatus | "awaiting-first-path";
	readonly cellId: EnvCellId | null;
	readonly grounded: boolean;
	readonly constraintCount: number;
	readonly droppedPaths: number;
	readonly missingLandblocks: readonly string[];
	readonly outsideWorld: boolean;
	readonly substeps: number;
	readonly contactPasses: number;
	readonly solveDurationMs: number;
}

/** Owns transport ordering and bounded fixed-tick playback for one physical-camera handoff. */
export class PhysicalCameraSession {
	readonly #transport: PhysicalCameraTransport;
	#unlisten: (() => void) | null = null;
	#session: number | null = null;
	#preRegistrationPath: HostPhysicalCameraPath | null = null;
	#activePath: HostPhysicalCameraPath | null = null;
	#pendingPath: HostPhysicalCameraPath | null = null;
	#activeStartedAt = 0;
	#latestPath: HostPhysicalCameraPath | null = null;
	#highestSequence = -1;
	#droppedPaths = 0;
	#intentSequence = 0;
	#movementEpoch = 0;
	#movementActive = false;
	#lastIntent: PhysicalCameraInput | null = null;

	constructor(transport: PhysicalCameraTransport) {
		this.#transport = transport;
	}

	/** Registers the listener before starting the host so the first path cannot be missed. */
	async start(
		placement: PhysicalCameraPlacement,
		viewDirection: readonly [number, number, number],
		mode: PhysicalCameraMode,
	): Promise<void> {
		if (this.#unlisten !== null) return;
		this.#unlisten = await this.#transport.listen(
			"host://physical-camera-motion",
			(path) => this.#receivePath(path),
		);
		try {
			const result = await this.#transport.invoke("start_physical_camera", {
				registration: {
					body: physicalCameraBody(mode),
					mode,
					residency: placement.residency,
					scenePosition: [
						placement.position.x,
						placement.position.y,
						placement.position.z,
					],
					speedEnvelope: physicalCameraSpeedEnvelope(mode),
					viewDirection,
				},
			});
			if (
				typeof result !== "number" ||
				!Number.isSafeInteger(result) ||
				result <= 0
			) {
				throw new Error("Host returned an invalid physical-camera session id.");
			}
			this.#session = result;
			const pending = this.#preRegistrationPath;
			this.#preRegistrationPath = null;
			if (pending?.session === this.#session) this.#acceptPath(pending);
		} catch (error) {
			this.#unlisten();
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
				await this.#transport.invoke("stop_physical_camera", { session });
			}
		} finally {
			unlisten();
			this.#reset();
		}
	}

	get running(): boolean {
		return this.#unlisten !== null && this.#session !== null;
	}

	/** Sends one concrete movement/view intent only when either owned input changes. */
	async setIntent(
		worldVelocity: readonly [number, number, number],
		viewDirection: readonly [number, number, number],
	): Promise<void> {
		const session = this.#session;
		if (session === null) return;
		const input = { viewDirection, worldVelocity };
		const movementActive = worldVelocity.some((component) => component !== 0);
		if (movementActive && !this.#movementActive) this.#movementEpoch += 1;
		this.#movementActive = movementActive;
		if (this.#lastIntent !== null && inputsEqual(input, this.#lastIntent))
			return;
		this.#lastIntent = input;
		const sequence = this.#intentSequence++;
		try {
			await this.#transport.invoke("set_physical_camera_intent", {
				intent: {
					movementEpoch: this.#movementEpoch,
					session,
					sequence,
					viewDirection,
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

	placement(): PhysicalCameraPlacement | null {
		const now = this.#transport.now();
		this.#advancePlayback(now);
		if (this.#activePath === null) return null;
		return evaluateHostPhysicalCameraPath(
			this.#activePath,
			now - this.#activeStartedAt,
		);
	}

	status(): PhysicalCameraStatus {
		const latest = this.#latestPath;
		return {
			mode: latest?.mode ?? null,
			tick: latest?.status ?? "awaiting-first-path",
			cellId: latest?.legs.at(-1)?.end.residency.envCellId ?? null,
			grounded: latest?.grounded ?? false,
			constraintCount: latest?.constraintCount ?? 0,
			droppedPaths: this.#droppedPaths,
			missingLandblocks: latest?.missingLandblocks ?? [],
			outsideWorld: latest?.outsideWorld ?? false,
			substeps: latest?.substeps ?? 0,
			contactPasses: latest?.contactPasses ?? 0,
			solveDurationMs: latest?.solveDurationMs ?? 0,
		};
	}

	#receivePath(path: HostPhysicalCameraPath): void {
		if (this.#session === null) {
			this.#preRegistrationPath = path;
			return;
		}
		if (path.session !== this.#session) return;
		this.#acceptPath(path);
	}

	#acceptPath(path: HostPhysicalCameraPath): void {
		if (path.sequence <= this.#highestSequence) return;
		validateHostPhysicalCameraPath(path);
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
		this.#activePath = null;
		this.#pendingPath = null;
		this.#latestPath = null;
		this.#highestSequence = -1;
		this.#droppedPaths = 0;
		this.#intentSequence = 0;
		this.#movementEpoch = 0;
		this.#movementActive = false;
		this.#lastIntent = null;
	}
}

interface PhysicalCameraInput {
	readonly viewDirection: readonly [number, number, number];
	readonly worldVelocity: readonly [number, number, number];
}

function inputsEqual(
	left: PhysicalCameraInput,
	right: PhysicalCameraInput,
): boolean {
	return (
		vectorsEqual(left.worldVelocity, right.worldVelocity) &&
		vectorsEqual(left.viewDirection, right.viewDirection)
	);
}

function vectorsEqual(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	return left.every((component, index) => component === right[index]);
}
