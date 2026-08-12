import {
	evaluateHostPhysicalCameraSegment,
	type HostPhysicalCameraSegment,
	type PhysicalCameraMode,
	type PhysicalCameraPlacement,
	type PhysicalCameraTickStatus,
} from "../lib/game/motion/host-physical-camera-path";
import type { EnvCellId } from "../lib/game/game-types";

/** Injectable Tauri boundary for one host-solved camera session. */
export interface PhysicalCameraTransport {
	invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
	listen(
		event: string,
		handler: (segment: HostPhysicalCameraSegment) => void,
	): Promise<() => void>;
	now(): number;
}

/** Explorer-visible diagnostics for the current host session. */
export interface PhysicalCameraStatus {
	readonly mode: PhysicalCameraMode | null;
	readonly tick: PhysicalCameraTickStatus | "awaiting-first-segment";
	readonly cellId: EnvCellId | null;
	readonly grounded: boolean;
	readonly constraintCount: number;
	readonly droppedSegments: number;
	readonly missingLandblocks: readonly string[];
	readonly outsideWorld: boolean;
	readonly substeps: number;
	readonly contactPasses: number;
	readonly solveDurationMs: number;
}

/** Owns transport ordering and bounded prediction for one physical-camera handoff. */
export class PhysicalCameraSession {
	readonly #transport: PhysicalCameraTransport;
	#unlisten: (() => void) | null = null;
	#session: number | null = null;
	#pendingSegment: HostPhysicalCameraSegment | null = null;
	#segment: HostPhysicalCameraSegment | null = null;
	#segmentArrivedAt = 0;
	#highestSequence = -1;
	#droppedSegments = 0;
	#intentSequence = 0;
	#lastIntent: PhysicalCameraInput | null = null;

	constructor(transport: PhysicalCameraTransport) {
		this.#transport = transport;
	}

	/** Registers the listener before starting the host so the first segment cannot be missed. */
	async start(
		placement: PhysicalCameraPlacement,
		viewDirection: readonly [number, number, number],
		mode: PhysicalCameraMode,
	): Promise<void> {
		if (this.#unlisten !== null) return;
		this.#unlisten = await this.#transport.listen(
			"host://physical-camera-motion",
			(segment) => this.#receiveSegment(segment),
		);
		try {
			const result = await this.#transport.invoke("start_physical_camera", {
				registration: {
					mode,
					residency: placement.residency,
					scenePosition: [
						placement.position.x,
						placement.position.y,
						placement.position.z,
					],
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
			const pending = this.#pendingSegment;
			this.#pendingSegment = null;
			if (pending?.session === this.#session) this.#acceptSegment(pending);
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
		const input = { viewDirection, worldVelocity };
		if (
			session === null ||
			(this.#lastIntent !== null && inputsEqual(input, this.#lastIntent))
		)
			return;
		this.#lastIntent = input;
		const sequence = this.#intentSequence++;
		try {
			await this.#transport.invoke("set_physical_camera_intent", {
				intent: { session, sequence, viewDirection, worldVelocity },
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
		if (this.#segment === null) return null;
		return evaluateHostPhysicalCameraSegment(
			this.#segment,
			this.#transport.now() - this.#segmentArrivedAt,
		);
	}

	status(): PhysicalCameraStatus {
		return {
			mode: this.#segment?.mode ?? null,
			tick: this.#segment?.status ?? "awaiting-first-segment",
			cellId: this.#segment?.residency.envCellId ?? null,
			grounded: this.#segment?.grounded ?? false,
			constraintCount: this.#segment?.constraintCount ?? 0,
			droppedSegments: this.#droppedSegments,
			missingLandblocks: this.#segment?.missingLandblocks ?? [],
			outsideWorld: this.#segment?.outsideWorld ?? false,
			substeps: this.#segment?.substeps ?? 0,
			contactPasses: this.#segment?.contactPasses ?? 0,
			solveDurationMs: this.#segment?.solveDurationMs ?? 0,
		};
	}

	#receiveSegment(segment: HostPhysicalCameraSegment): void {
		if (this.#session === null) {
			this.#pendingSegment = segment;
			return;
		}
		if (segment.session !== this.#session) return;
		this.#acceptSegment(segment);
	}

	#acceptSegment(segment: HostPhysicalCameraSegment): void {
		if (segment.sequence <= this.#highestSequence) return;
		this.#droppedSegments += segment.sequence - this.#highestSequence - 1;
		this.#highestSequence = segment.sequence;
		this.#segment = segment;
		this.#segmentArrivedAt = this.#transport.now();
	}

	#reset(): void {
		this.#unlisten = null;
		this.#session = null;
		this.#pendingSegment = null;
		this.#segment = null;
		this.#highestSequence = -1;
		this.#droppedSegments = 0;
		this.#intentSequence = 0;
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
