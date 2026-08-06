import type { PreparedAnimation } from "../animation/animation-asset-repository";
import {
	advanceCyclicFrame,
	sampleAnimationPose,
} from "../animation/animation-playback";
import type {
	BehaviorEventRouter,
	BehaviorTarget,
} from "../behavior/behavior-event-router";
import type { SceneNodeId } from "../scene";
import type { ArticulatedPose } from "./components";
import { EffectSystem, type EffectPresentationSample } from "./effect-system";

const BEHAVIOR_STEP_SECONDS = 1 / 30;
const DISCONTINUITY_SECONDS = 2;
/** Absorbs timestamp subtraction noise without admitting a materially early behavior step. */
const CLOCK_EPSILON_SECONDS = 1e-9;
const advancedAnimationFrameBrand: unique symbol = Symbol(
	"advanced-animation-frame",
);

interface AnimationRecord {
	readonly animation: PreparedAnimation;
	/** Dispatch identity, carried so a recycled node id cannot receive this record's commands. */
	readonly target: BehaviorTarget;
	framePosition: number;
	lastTimeSeconds: number | null;
	fractionalSeconds: number;
}

export interface AnimationRuntimeDiagnostics {
	readonly activePlaybackCount: number;
	readonly discontinuityCount: number;
	/** Wall time spent advancing clocks and semantic behavior during the latest frame. */
	readonly lastAdvancementDurationMs: number;
	/** Number of selected presentations visually sampled during the latest sample call. */
	readonly lastSampledPresentationCount: number;
	readonly lastSamplingDurationMs: number;
	readonly lastSemanticStepCount: number;
}

/** Opaque proof that every active playback reached one specific runtime time. */
export interface AdvancedAnimationFrame {
	/** Stable active playback selection captured after semantic advancement. */
	readonly activeNodeIds: readonly SceneNodeId[];
	readonly [advancedAnimationFrameBrand]: true;
}

/** Complete render-cadence presentation produced without mutating entity or scene state. */
export interface DynamicPresentationSample {
	readonly articulatedPose: ArticulatedPose;
	readonly effects: EffectPresentationSample;
	readonly nodeId: SceneNodeId;
}

/** Fully initialized playback generation that leaves the active owner untouched until commit. */
export interface StagedAnimationOwner {
	readonly samples: readonly DynamicPresentationSample[];
	commit(): void;
	release(): void;
}

/** Owns independent playback clocks and semantic traversal, but no scene or resource mutation. */
export class AnimationSystem<TOwnerId extends string> {
	readonly #effects: EffectSystem;
	readonly #router: BehaviorEventRouter;
	readonly #records = new Map<SceneNodeId, AnimationRecord>();
	readonly #owners = new Map<TOwnerId, Set<SceneNodeId>>();
	readonly #stagedNodeIds = new Set<SceneNodeId>();
	#destroyed = false;
	/** Latest semantic advancement proof, invalidated whenever active ownership changes. */
	#latestAdvancedFrame: AdvancedAnimationFrame | null = null;
	#diagnostics: AnimationRuntimeDiagnostics = {
		activePlaybackCount: 0,
		discontinuityCount: 0,
		lastAdvancementDurationMs: 0,
		lastSampledPresentationCount: 0,
		lastSamplingDurationMs: 0,
		lastSemanticStepCount: 0,
	};

	constructor(effects: EffectSystem, router: BehaviorEventRouter) {
		this.#effects = effects;
		this.#router = router;
	}

	/** Whether this system still holds the exact node and generation a command targets. */
	holds(target: BehaviorTarget): boolean {
		const record = this.#records.get(target.nodeId);
		return record?.target.generation === target.generation;
	}

	install(
		ownerId: TOwnerId,
		target: BehaviorTarget,
		residentIdentity: string,
		animation: PreparedAnimation,
	): DynamicPresentationSample {
		if (this.#destroyed)
			throw new Error("Cannot install destroyed animation playback.");
		const nodeId = target.nodeId;
		if (this.#records.has(nodeId))
			throw new Error(`Animation state for ${nodeId} already exists.`);
		const record = this.#createRecord(target, residentIdentity, animation);
		this.#records.set(nodeId, record);
		let nodes = this.#owners.get(ownerId);
		if (!nodes) {
			nodes = new Set();
			this.#owners.set(ownerId, nodes);
		}
		nodes.add(nodeId);
		this.#latestAdvancedFrame = null;
		return this.#sample(nodeId, record);
	}

	/** Advance every active playback's semantic state at the fixed 30 Hz behavior cadence. */
	advance(timeSeconds: number): AdvancedAnimationFrame {
		if (this.#destroyed)
			throw new Error("Cannot advance destroyed animation playback.");
		if (!Number.isFinite(timeSeconds))
			throw new Error("Animation time must be finite.");
		const startedAt = performance.now();
		let semanticStepCount = 0;
		for (const [nodeId, record] of this.#records) {
			semanticStepCount += this.#advanceRecord(nodeId, record, timeSeconds);
		}
		const frame: AdvancedAnimationFrame = Object.freeze({
			activeNodeIds: Object.freeze([...this.#records.keys()]),
			[advancedAnimationFrameBrand]: true as const,
		});
		this.#latestAdvancedFrame = frame;
		this.#diagnostics = {
			...this.#diagnostics,
			activePlaybackCount: this.#records.size,
			lastAdvancementDurationMs: performance.now() - startedAt,
			lastSemanticStepCount: semanticStepCount,
		};
		return frame;
	}

	/** Sample selected presentations only after all playback semantics have advanced. */
	sample(
		frame: AdvancedAnimationFrame,
		nodeIds: readonly SceneNodeId[],
	): readonly DynamicPresentationSample[] {
		if (this.#destroyed)
			throw new Error("Cannot sample destroyed animation playback.");
		if (frame !== this.#latestAdvancedFrame)
			throw new Error("Animation samples require the latest advanced frame.");
		const startedAt = performance.now();
		const requested = new Set<SceneNodeId>();
		const samples = nodeIds.map((nodeId) => {
			if (requested.has(nodeId))
				throw new Error(`Animation sample request repeats ${nodeId}.`);
			requested.add(nodeId);
			const record = this.#records.get(nodeId);
			if (!record)
				throw new Error(`Animation sample request contains unknown ${nodeId}.`);
			return this.#sample(nodeId, record);
		});
		this.#diagnostics = {
			...this.#diagnostics,
			lastSampledPresentationCount: samples.length,
			lastSamplingDurationMs: performance.now() - startedAt,
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
			readonly target: BehaviorTarget;
			readonly residentIdentity: string;
		}[],
	): StagedAnimationOwner {
		if (this.#destroyed)
			throw new Error("Cannot stage destroyed animation playback.");
		const records = new Map<SceneNodeId, AnimationRecord>();
		const samples: DynamicPresentationSample[] = [];
		try {
			for (const installation of installations) {
				const nodeId = installation.target.nodeId;
				if (records.has(nodeId) || this.#records.has(nodeId)) {
					throw new Error(`Animation state for ${nodeId} already exists.`);
				}
				const record = this.#createRecord(
					installation.target,
					installation.residentIdentity,
					installation.animation,
				);
				records.set(nodeId, record);
				this.#stagedNodeIds.add(nodeId);
				samples.push(this.#sample(nodeId, record));
			}
		} catch (cause) {
			for (const nodeId of records.keys()) this.#stagedNodeIds.delete(nodeId);
			throw cause;
		}
		let state: "staged" | "committed" | "released" = "staged";
		return {
			commit: () => {
				if (state !== "staged")
					throw new Error(`Cannot commit animation stage in state ${state}.`);
				if (this.#destroyed)
					throw new Error("Cannot commit destroyed animation playback.");
				this.#removeOwnerRecords(ownerId);
				for (const [nodeId, record] of records) {
					this.#records.set(nodeId, record);
					this.#stagedNodeIds.delete(nodeId);
				}
				this.#owners.set(ownerId, new Set(records.keys()));
				this.#latestAdvancedFrame = null;
				state = "committed";
			},
			release: () => {
				if (state !== "staged") return;
				for (const nodeId of records.keys()) this.#stagedNodeIds.delete(nodeId);
				state = "released";
			},
			samples,
		};
	}

	removeOwner(ownerId: TOwnerId): void {
		this.#removeOwnerRecords(ownerId);
		this.#latestAdvancedFrame = null;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		// Effect state belongs to the entity, not to playback, so its owner tears it down.
		this.#records.clear();
		this.#owners.clear();
		this.#stagedNodeIds.clear();
		this.#latestAdvancedFrame = null;
	}

	#removeOwnerRecords(ownerId: TOwnerId): void {
		const nodes = this.#owners.get(ownerId);
		if (!nodes) return;
		for (const nodeId of nodes) this.#records.delete(nodeId);
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
			this.#advanceSemanticStep(nodeId, record, "live");
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
	): DynamicPresentationSample {
		const visualAdvance = advanceCyclicFrame(
			record.framePosition,
			record.fractionalSeconds * record.animation.framesPerSecond,
			record.animation.frameCount,
			"forward",
		);
		return {
			articulatedPose: {
				partToObjectTransforms: sampleAnimationPose(
					record.animation,
					visualAdvance.framePosition,
				),
			},
			effects: this.#effects.samplePresentation(
				nodeId,
				record.fractionalSeconds,
				record.fractionalSeconds / BEHAVIOR_STEP_SECONDS,
			),
			nodeId,
		};
	}

	#createRecord(
		target: BehaviorTarget,
		residentIdentity: string,
		animation: PreparedAnimation,
	): AnimationRecord {
		const nodeId = target.nodeId;
		const record: AnimationRecord = {
			animation,
			fractionalSeconds: 0,
			framePosition: 0,
			lastTimeSeconds: null,
			target,
		};
		let remainingSeconds =
			independentPhase(residentIdentity, animation.frameCount) /
			animation.framesPerSecond;
		while (remainingSeconds + CLOCK_EPSILON_SECONDS >= BEHAVIOR_STEP_SECONDS) {
			this.#advanceSemanticStep(nodeId, record, "initial-state");
			remainingSeconds = Math.max(0, remainingSeconds - BEHAVIOR_STEP_SECONDS);
		}
		record.fractionalSeconds = remainingSeconds;
		return record;
	}

	#advanceSemanticStep(
		nodeId: SceneNodeId,
		record: AnimationRecord,
		mode: "initial-state" | "live",
	): void {
		this.#effects.advanceSemanticStep(nodeId, BEHAVIOR_STEP_SECONDS);
		const advance = advanceCyclicFrame(
			record.framePosition,
			record.animation.framesPerSecond * BEHAVIOR_STEP_SECONDS,
			record.animation.frameCount,
			"forward",
		);
		record.framePosition = advance.framePosition;
		this.#dispatchDepartedFrames(record, advance.departedFrames, mode);
	}

	/**
	 * Route every hook the crossed frames authored, in authored order.
	 *
	 * Direction filtering stays here rather than in the router: it is a property of animation
	 * playback (`CSequence::execute_hooks`) with no counterpart in the script lane, where retail
	 * stamps every hook `-2` and executes it unconditionally.
	 */
	#dispatchDepartedFrames(
		record: AnimationRecord,
		departedFrames: readonly number[],
		mode: "initial-state" | "live",
	): void {
		for (const frameIndex of departedFrames) {
			for (const hook of record.animation.hooks) {
				if (hook.frameIndex !== frameIndex) continue;
				if (hook.direction !== "both" && hook.direction !== "forward") continue;
				this.#router.dispatch(
					hook,
					record.target,
					{
						assetId: record.animation.id,
						authoredOrder: hook.authoredOrder,
						authoredPosition: hook.frameIndex,
						producer: "animation",
					},
					mode,
				);
			}
		}
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
