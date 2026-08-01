import type { PreparedAnimation } from "../animation/animation-asset-repository";
import {
	advanceCyclicFrame,
	sampleAnimationPose,
} from "../animation/animation-playback";
import type { Mat4 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { ArticulatedPose } from "./components";
import { HookSystem } from "./hook-system";

const BEHAVIOR_STEP_SECONDS = 1 / 30;
const DISCONTINUITY_SECONDS = 2;
/** Absorbs timestamp subtraction noise without admitting a materially early behavior step. */
const CLOCK_EPSILON_SECONDS = 1e-9;

interface AnimationRecord {
	readonly animation: PreparedAnimation;
	framePosition: number;
	lastTimeSeconds: number | null;
	fractionalSeconds: number;
}

export interface AnimationRuntimeDiagnostics {
	readonly activePlaybackCount: number;
	readonly discontinuityCount: number;
	readonly lastSamplingDurationMs: number;
	readonly lastSemanticStepCount: number;
}

/** Render-cadence pose and visual-root sample produced without mutating scene state. */
export interface AnimatedPresentationSample {
	readonly nodeId: SceneNodeId;
	readonly pose: ArticulatedPose;
	readonly visualRootTransform: Mat4;
}

/** Fully initialized playback generation that leaves the active owner untouched until commit. */
export interface StagedAnimationOwner {
	readonly samples: readonly AnimatedPresentationSample[];
	commit(): void;
	release(): void;
}

/** Owns independent playback clocks and semantic traversal, but no scene or resource mutation. */
export class AnimationSystem<TOwnerId extends string> {
	readonly #hooks: HookSystem;
	readonly #records = new Map<SceneNodeId, AnimationRecord>();
	readonly #owners = new Map<TOwnerId, Set<SceneNodeId>>();
	#diagnostics: AnimationRuntimeDiagnostics = {
		activePlaybackCount: 0,
		discontinuityCount: 0,
		lastSamplingDurationMs: 0,
		lastSemanticStepCount: 0,
	};

	constructor(hooks: HookSystem) {
		this.#hooks = hooks;
	}

	install(
		ownerId: TOwnerId,
		nodeId: SceneNodeId,
		residentIdentity: string,
		animation: PreparedAnimation,
	): AnimatedPresentationSample {
		if (this.#records.has(nodeId))
			throw new Error(`Animation state for ${nodeId} already exists.`);
		const framePosition = independentPhase(
			residentIdentity,
			animation.frameCount,
		);
		const initialTraversal = advanceCyclicFrame(
			0,
			framePosition,
			animation.frameCount,
			"forward",
		);
		this.#hooks.install(nodeId, animation, initialTraversal.departedFrames);
		const record: AnimationRecord = {
			animation,
			fractionalSeconds: 0,
			framePosition,
			lastTimeSeconds: null,
		};
		this.#records.set(nodeId, record);
		let nodes = this.#owners.get(ownerId);
		if (!nodes) {
			nodes = new Set();
			this.#owners.set(ownerId, nodes);
		}
		nodes.add(nodeId);
		return this.#sample(nodeId, record);
	}

	/** Advance semantic state at 30 Hz and sample smooth visual state at the supplied render time. */
	update(timeSeconds: number): readonly AnimatedPresentationSample[] {
		if (!Number.isFinite(timeSeconds))
			throw new Error("Animation time must be finite.");
		const startedAt = performance.now();
		const samples: AnimatedPresentationSample[] = [];
		let semanticStepCount = 0;
		for (const [nodeId, record] of this.#records) {
			semanticStepCount += this.#advanceRecord(nodeId, record, timeSeconds);
			samples.push(this.#sample(nodeId, record));
		}
		this.#diagnostics = {
			...this.#diagnostics,
			activePlaybackCount: this.#records.size,
			lastSamplingDurationMs: performance.now() - startedAt,
			lastSemanticStepCount: semanticStepCount,
		};
		return samples;
	}

	getDiagnostics(): AnimationRuntimeDiagnostics {
		return this.#diagnostics;
	}

	/** Initialize a complete replacement generation without retiring current playback state. */
	stageOwner(
		ownerId: TOwnerId,
		installations: readonly {
			readonly animation: PreparedAnimation;
			readonly nodeId: SceneNodeId;
			readonly residentIdentity: string;
		}[],
	): StagedAnimationOwner {
		const records = new Map<SceneNodeId, AnimationRecord>();
		const samples: AnimatedPresentationSample[] = [];
		try {
			for (const installation of installations) {
				if (
					records.has(installation.nodeId) ||
					this.#records.has(installation.nodeId)
				) {
					throw new Error(
						`Animation state for ${installation.nodeId} already exists.`,
					);
				}
				const framePosition = independentPhase(
					installation.residentIdentity,
					installation.animation.frameCount,
				);
				const initialTraversal = advanceCyclicFrame(
					0,
					framePosition,
					installation.animation.frameCount,
					"forward",
				);
				this.#hooks.install(
					installation.nodeId,
					installation.animation,
					initialTraversal.departedFrames,
				);
				const record: AnimationRecord = {
					animation: installation.animation,
					fractionalSeconds: 0,
					framePosition,
					lastTimeSeconds: null,
				};
				records.set(installation.nodeId, record);
				samples.push(this.#sample(installation.nodeId, record));
			}
		} catch (cause) {
			for (const nodeId of records.keys()) this.#hooks.remove(nodeId);
			throw cause;
		}
		let state: "staged" | "committed" | "released" = "staged";
		return {
			commit: () => {
				if (state !== "staged")
					throw new Error(`Cannot commit animation stage in state ${state}.`);
				this.#removeOwnerRecords(ownerId);
				for (const [nodeId, record] of records)
					this.#records.set(nodeId, record);
				this.#owners.set(ownerId, new Set(records.keys()));
				state = "committed";
			},
			release: () => {
				if (state !== "staged") return;
				for (const nodeId of records.keys()) this.#hooks.remove(nodeId);
				state = "released";
			},
			samples,
		};
	}

	removeOwner(ownerId: TOwnerId): void {
		this.#removeOwnerRecords(ownerId);
	}

	#removeOwnerRecords(ownerId: TOwnerId): void {
		const nodes = this.#owners.get(ownerId);
		if (!nodes) return;
		for (const nodeId of nodes) {
			this.#records.delete(nodeId);
			this.#hooks.remove(nodeId);
		}
		this.#owners.delete(ownerId);
	}

	#advanceRecord(
		nodeId: SceneNodeId,
		record: AnimationRecord,
		timeSeconds: number,
	): number {
		const previousTime = record.lastTimeSeconds;
		record.lastTimeSeconds = timeSeconds;
		if (previousTime === null) return 0;
		const elapsed = timeSeconds - previousTime;
		if (elapsed < 0 || elapsed > DISCONTINUITY_SECONDS) {
			record.fractionalSeconds = 0;
			this.#diagnostics = {
				...this.#diagnostics,
				discontinuityCount: this.#diagnostics.discontinuityCount + 1,
			};
			return 0;
		}
		record.fractionalSeconds += elapsed;
		let semanticStepCount = 0;
		while (
			record.fractionalSeconds + CLOCK_EPSILON_SECONDS >=
			BEHAVIOR_STEP_SECONDS
		) {
			semanticStepCount += 1;
			this.#hooks.advanceCommittedRotation(nodeId);
			const advance = advanceCyclicFrame(
				record.framePosition,
				record.animation.framesPerSecond * BEHAVIOR_STEP_SECONDS,
				record.animation.frameCount,
				"forward",
			);
			record.framePosition = advance.framePosition;
			this.#hooks.executeDepartedFrames(
				nodeId,
				record.animation,
				advance.departedFrames,
				"forward",
			);
			record.fractionalSeconds = Math.max(
				0,
				record.fractionalSeconds - BEHAVIOR_STEP_SECONDS,
			);
		}
		return semanticStepCount;
	}

	#sample(
		nodeId: SceneNodeId,
		record: AnimationRecord,
	): AnimatedPresentationSample {
		const visualAdvance = advanceCyclicFrame(
			record.framePosition,
			record.fractionalSeconds * record.animation.framesPerSecond,
			record.animation.frameCount,
			"forward",
		);
		return {
			nodeId,
			pose: {
				partToObjectTransforms: sampleAnimationPose(
					record.animation,
					visualAdvance.framePosition,
				),
			},
			visualRootTransform: this.#hooks.sampleVisualRoot(
				nodeId,
				record.fractionalSeconds / BEHAVIOR_STEP_SECONDS,
			),
		};
	}
}

/** Stable FNV-1a phase keeps entities reproducible without sharing playback clocks. */
function independentPhase(identity: string, frameCount: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < identity.length; index += 1) {
		hash ^= identity.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return ((hash >>> 0) / 0x1_0000_0000) * frameCount;
}
