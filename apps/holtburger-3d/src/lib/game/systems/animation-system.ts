import type { PreparedAnimation } from "../animation/animation-asset-repository";
import {
	advancePlayingFrame,
	clipEntryFrame,
	sampleAnimationPoseOver,
	sampleAuthoredRootTransform,
	wholeAnimationClip,
	type PlayingClip,
} from "../animation/animation-playback";
import type {
	BehaviorEventRouter,
	BehaviorTarget,
} from "../behavior/behavior-event-router";
import { requireSceneNodeId, sceneNodeIdOf } from "../scene/utils";
import type { SceneNodeId } from "../scene";
import type { Mat4 } from "../math/types";
import type { ArticulatedPose } from "./components";
import {
	BEHAVIOR_STEP_SECONDS,
	EffectSystem,
	type EffectPresentationSample,
} from "./effect-system";

const DISCONTINUITY_SECONDS = 2;
/** Absorbs timestamp subtraction noise without admitting a materially early behavior step. */
const CLOCK_EPSILON_SECONDS = 1e-9;
const advancedAnimationFrameBrand: unique symbol = Symbol(
	"advanced-animation-frame",
);

interface AnimationRecord {
	/** Replaced wholesale when a host projection names a different clip. */
	clip: PlayingClip;
	/** Dispatch identity, carried so a recycled node id cannot receive this record's commands. */
	readonly target: BehaviorTarget;
	framePosition: number;
	lastTimeSeconds: number | null;
	fractionalSeconds: number;
	/** Complete setup pose retained beneath whichever prefix the current clip authors. */
	readonly retainedPartToObjectTransforms: readonly Mat4[];
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
		// A total predicate, unlike the command methods: "do you hold this?" has a legitimate "no"
		// for a target this system could never hold at all. Sky targets are not scene residents and
		// never animate, and liveness asks every producer about every target, so treating a
		// non-scene id as an error here would reject dispatch for targets that are perfectly alive.
		const nodeId = sceneNodeIdOf(target.targetId);
		if (nodeId === null) return false;
		const record = this.#records.get(nodeId);
		return record?.target.generation === target.generation;
	}

	/**
	 * Install or replace the clip one node plays, entering at the clip's own starting frame.
	 *
	 * Motion-driven entities activate with no playback at all and receive their first clip from a
	 * host projection, so installing and swapping are the same operation. Playback is entered
	 * rather than resumed: host and receiver both advance by rate x dt from the same entry frame,
	 * so neither accumulates a phase offset against the other, and no frame number is exchanged.
	 *
	 * A clip naming a generation the node no longer holds is a defect rather than a race: the
	 * caller resolves the target from the same presentation record the staging used, and both
	 * change only inside one synchronous commit. Rejecting loudly surfaces a drift between the
	 * entity generation and the dynamics owner generation, which are separate counters.
	 */
	playClip(
		ownerId: TOwnerId,
		target: BehaviorTarget,
		clip: PlayingClip,
		initialPartToObjectTransforms: readonly Mat4[],
	): void {
		if (this.#destroyed)
			throw new Error("Cannot play a clip on destroyed animation playback.");
		const nodeId = requireSceneNodeId(target.targetId, "AnimationSystem");
		const existing = this.#records.get(nodeId);
		if (existing && existing.target.generation !== target.generation) {
			throw new Error(
				`Clip for ${nodeId} names generation ${target.generation}, but its playback holds ${existing.target.generation}.`,
			);
		}
		const retainedPartToObjectTransforms = existing
			? sampleAnimationPoseOver(
					existing.clip,
					advancePlayingFrame(
						existing.clip,
						existing.framePosition,
						existing.fractionalSeconds,
					).framePosition,
					existing.retainedPartToObjectTransforms,
				)
			: cloneCompletePose(initialPartToObjectTransforms);
		this.#records.set(
			nodeId,
			this.#createRecord(target, clip, 0, retainedPartToObjectTransforms),
		);
		let nodes = this.#owners.get(ownerId);
		if (!nodes) {
			nodes = new Set();
			this.#owners.set(ownerId, nodes);
		}
		nodes.add(nodeId);
		this.#latestAdvancedFrame = null;
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
			readonly initialPartToObjectTransforms: readonly Mat4[];
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
				const nodeId = requireSceneNodeId(
					installation.target.targetId,
					"AnimationSystem",
				);
				if (records.has(nodeId) || this.#records.has(nodeId)) {
					throw new Error(`Animation state for ${nodeId} already exists.`);
				}
				const record = this.#createRecord(
					installation.target,
					wholeAnimationClip(installation.animation),
					independentPhaseSeconds(
						installation.residentIdentity,
						installation.animation,
					),
					cloneCompletePose(installation.initialPartToObjectTransforms),
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
		const visualAdvance = advancePlayingFrame(
			record.clip,
			record.framePosition,
			record.fractionalSeconds,
		);
		return {
			articulatedPose: {
				authoredRootTransform: sampleAuthoredRootTransform(
					record.clip,
					visualAdvance.framePosition,
				),
				partToObjectTransforms: sampleAnimationPoseOver(
					record.clip,
					visualAdvance.framePosition,
					record.retainedPartToObjectTransforms,
				),
			},
			effects: this.#effects.samplePresentation(nodeId),
			nodeId,
		};
	}

	/**
	 * Build a record at its clip's entry frame, then replay `phaseSeconds` of it.
	 *
	 * Phase is the caller's policy rather than the record's: a setup-default resident desyncs from
	 * its neighbours by an identity-derived offset, while a host-projected clip must start exactly
	 * where the host started it and so replays nothing.
	 */
	#createRecord(
		target: BehaviorTarget,
		clip: PlayingClip,
		phaseSeconds: number,
		retainedPartToObjectTransforms: readonly Mat4[],
	): AnimationRecord {
		const nodeId = requireSceneNodeId(target.targetId, "AnimationSystem");
		const record: AnimationRecord = {
			clip,
			fractionalSeconds: 0,
			framePosition: clipEntryFrame(clip),
			lastTimeSeconds: null,
			retainedPartToObjectTransforms,
			target,
		};
		let remainingSeconds = phaseSeconds;
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
		// Live steps ride the shared effect clock. An initial-state replay does not: it is catching
		// one new node up to its authored phase, which a global cadence cannot express.
		if (mode === "initial-state") this.#effects.foldSemanticStep(nodeId);
		const advance = advancePlayingFrame(
			record.clip,
			record.framePosition,
			BEHAVIOR_STEP_SECONDS,
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
			for (const hook of record.clip.animation.hooks) {
				if (hook.frameIndex !== frameIndex) continue;
				if (hook.direction !== "both" && hook.direction !== "forward") continue;
				this.#router.dispatch(
					hook,
					record.target,
					{
						assetId: record.clip.animation.id,
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

/** Clone caller-owned matrices so animation retention cannot alias entity presentation state. */
function cloneCompletePose(transforms: readonly Mat4[]): readonly Mat4[] {
	return transforms.map((transform) => transform.clone());
}

/** Stable FNV-1a phase keeps entities reproducible without sharing playback clocks. */
function independentPhaseSeconds(
	identity: string,
	animation: PreparedAnimation,
): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < identity.length; index += 1) {
		hash ^= identity.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	const frame = ((hash >>> 0) / 0x1_0000_0000) * animation.frameCount;
	return frame / animation.framesPerSecond;
}
