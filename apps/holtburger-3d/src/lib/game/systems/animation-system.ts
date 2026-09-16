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

/** A clip update already classified against its accepted host occurrence. */
export type AnimationLayerUpdate =
	| { readonly kind: "unchanged" }
	| { readonly kind: "remove" }
	| { readonly kind: "install"; readonly clip: PlayingClip }
	| { readonly kind: "retime"; readonly framesPerSecond: number };

/** Shared semantic activity; visibility priority is applied here in the frontend. */
export type AnimationMotionActivity = "locomotion" | "gesture" | "explicit";

interface OrdinaryPlayback {
	/** Currently traversed ordinary clip, including a naturally retiring gesture. */
	readonly current: AnimationRecord;
	/** An accepted successor waits without advancing until the final gesture clip finishes. */
	readonly successor: { readonly record: AnimationRecord | null } | null;
}

/** A node always has at least one playable track. Both tracks share one entity lifetime. */
type NodeAnimation = { readonly activity: AnimationMotionActivity } & (
	| { readonly kind: "ordinary"; readonly ordinary: OrdinaryPlayback }
	| { readonly kind: "locomotion"; readonly locomotion: AnimationRecord }
	| {
			readonly kind: "layered";
			readonly ordinary: OrdinaryPlayback;
			readonly locomotion: AnimationRecord;
	  }
);

function ordinaryPlayback(node: NodeAnimation): OrdinaryPlayback | null {
	return node.kind === "locomotion" ? null : node.ordinary;
}

function locomotionPlayback(node: NodeAnimation): AnimationRecord | null {
	return node.kind === "ordinary" ? null : node.locomotion;
}

function selectedPlayback(node: NodeAnimation): AnimationRecord {
	if (node.kind === "ordinary") return node.ordinary.current;
	if (node.kind === "locomotion") return node.locomotion;
	return node.activity !== "locomotion" || node.ordinary.successor !== null
		? node.ordinary.current
		: node.locomotion;
}

function composePlayback(
	ordinary: OrdinaryPlayback | null,
	locomotion: AnimationRecord | null,
	activity: AnimationMotionActivity,
): NodeAnimation | null {
	if (ordinary !== null && locomotion !== null)
		return { kind: "layered", ordinary, locomotion, activity };
	if (ordinary !== null) return { kind: "ordinary", ordinary, activity };
	if (locomotion !== null) return { kind: "locomotion", locomotion, activity };
	return null;
}

function canFinishGesture(record: AnimationRecord): boolean {
	if (record.clip.completion !== "hold" || record.clip.framesPerSecond === 0)
		return false;
	return record.clip.framesPerSecond > 0
		? record.framePosition < record.clip.highFrame
		: record.framePosition > record.clip.lowFrame;
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
	readonly #records = new Map<SceneNodeId, NodeAnimation>();
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
		return (
			record !== undefined &&
			selectedPlayback(record).target.generation === target.generation
		);
	}

	/** Apply both host track updates atomically. Visibility switches retain existing clocks. */
	applyMotion(
		ownerId: TOwnerId,
		target: BehaviorTarget,
		activity: AnimationMotionActivity,
		ordinaryUpdate: AnimationLayerUpdate,
		locomotionUpdate: AnimationLayerUpdate,
		initialPartToObjectTransforms: readonly Mat4[],
	): void {
		if (this.#destroyed)
			throw new Error("Cannot play a clip on destroyed animation playback.");
		const nodeId = requireSceneNodeId(target.targetId, "AnimationSystem");
		const existing = this.#records.get(nodeId);
		if (
			existing &&
			selectedPlayback(existing).target.generation !== target.generation
		)
			throw new Error(
				`Clip for ${nodeId} names generation ${target.generation}, but its playback holds ${selectedPlayback(existing).target.generation}.`,
			);
		const oldOrdinary = existing ? ordinaryPlayback(existing) : null;
		const oldLocomotion = existing ? locomotionPlayback(existing) : null;
		// Retiming consumes time accumulated before this update. Its hooks belong to the
		// previous visibility, even when this same update reveals or hides that track.
		const previouslyVisible = existing ? selectedPlayback(existing) : null;
		const finishing =
			oldOrdinary !== null &&
			(existing?.activity === "gesture" || oldOrdinary.successor !== null) &&
			activity === "locomotion" &&
			canFinishGesture(oldOrdinary.current);
		const acceptedOrdinary =
			oldOrdinary === null
				? null
				: oldOrdinary.successor === null
					? oldOrdinary.current
					: oldOrdinary.successor.record;
		const ordinaryRecord = this.#updateLayer(
			// A replacement inherits the pose actually being traversed, not the dormant successor.
			ordinaryUpdate.kind === "install" && oldOrdinary !== null
				? oldOrdinary.current
				: acceptedOrdinary,
			ordinaryUpdate,
			target,
			initialPartToObjectTransforms,
			acceptedOrdinary !== null && acceptedOrdinary === previouslyVisible,
		);
		const locomotion = this.#updateLayer(
			oldLocomotion,
			locomotionUpdate,
			target,
			initialPartToObjectTransforms,
			oldLocomotion !== null && oldLocomotion === previouslyVisible,
		);
		const ordinary: OrdinaryPlayback | null =
			finishing && oldOrdinary !== null
				? {
						current: oldOrdinary.current,
						successor: { record: ordinaryRecord },
					}
				: ordinaryRecord === null
					? null
					: { current: ordinaryRecord, successor: null };
		const node = composePlayback(ordinary, locomotion, activity);
		if (node === null) {
			this.#records.delete(nodeId);
		} else {
			// A newly visible track may have render-only fractional time accumulated while
			// hidden. Consume it silently before any future visible semantic step.
			const selected = selectedPlayback(node);
			if (existing && selected !== selectedPlayback(existing))
				this.#consumeFraction(selected, false);
			this.#records.set(nodeId, node);
			let nodes = this.#owners.get(ownerId);
			if (!nodes) {
				nodes = new Set();
				this.#owners.set(ownerId, nodes);
			}
			nodes.add(nodeId);
		}
		this.#latestAdvancedFrame = null;
	}

	#updateLayer(
		existing: AnimationRecord | null,
		update: AnimationLayerUpdate,
		target: BehaviorTarget,
		initialPose: readonly Mat4[],
		visible: boolean,
	): AnimationRecord | null {
		switch (update.kind) {
			case "unchanged":
				return existing;
			case "remove":
				return null;
			case "retime":
				if (existing === null)
					throw new Error("Animation rate update has no installed track.");
				this.#retime(existing, update.framesPerSecond, visible);
				return existing;
			case "install": {
				const retained =
					existing === null
						? cloneCompletePose(initialPose)
						: this.#samplePartPose(existing);
				return this.#createRecord(target, update.clip, 0, retained);
			}
		}
	}

	/** Snapshot this track's complete current pose for a partial-part successor. */
	#samplePartPose(record: AnimationRecord): readonly Mat4[] {
		return sampleAnimationPoseOver(
			record.clip,
			advancePlayingFrame(
				record.clip,
				record.framePosition,
				record.fractionalSeconds,
			).framePosition,
			record.retainedPartToObjectTransforms,
		);
	}

	#consumeFraction(record: AnimationRecord, visible: boolean): void {
		const advance = advancePlayingFrame(
			record.clip,
			record.framePosition,
			record.fractionalSeconds,
		);
		record.framePosition = advance.framePosition;
		record.fractionalSeconds = 0;
		if (visible)
			this.#dispatchDepartedFrames(record, advance.departedFrames, "live");
	}

	#retime(
		record: AnimationRecord,
		framesPerSecond: number,
		visible: boolean,
	): void {
		if (!Number.isFinite(framesPerSecond))
			throw new Error("Animation playback rate must be finite.");
		this.#consumeFraction(record, visible);
		record.clip = { ...record.clip, framesPerSecond };
	}

	/** Advance every active playback's semantic state at the fixed 30 Hz behavior cadence. */
	advance(timeSeconds: number): AdvancedAnimationFrame {
		if (this.#destroyed)
			throw new Error("Cannot advance destroyed animation playback.");
		if (!Number.isFinite(timeSeconds))
			throw new Error("Animation time must be finite.");
		const startedAt = performance.now();
		let semanticStepCount = 0;
		let activePlaybackCount = 0;
		for (const [nodeId, node] of this.#records) {
			const visible = selectedPlayback(node);
			const ordinary = ordinaryPlayback(node);
			const locomotion = locomotionPlayback(node);
			for (const record of [ordinary?.current, locomotion]) {
				if (record) {
					activePlaybackCount += 1;
					semanticStepCount += this.#advanceRecord(
						nodeId,
						record,
						timeSeconds,
						record === visible,
					);
				}
			}
			if (ordinary?.successor && !canFinishGesture(ordinary.current)) {
				const pending = ordinary.successor.record;
				// Untouched parts inherit the finishing pose, rather than the earlier pose at
				// which the host announced retirement. The pending clip has never advanced.
				const successor =
					pending === null
						? null
						: this.#createRecord(
								pending.target,
								pending.clip,
								0,
								this.#samplePartPose(ordinary.current),
							);
				if (successor !== null) successor.lastTimeSeconds = timeSeconds;
				const next = composePlayback(
					successor === null ? null : { current: successor, successor: null },
					locomotion,
					node.activity,
				);
				if (next === null) this.#records.delete(nodeId);
				else {
					this.#consumeFraction(selectedPlayback(next), false);
					this.#records.set(nodeId, next);
				}
			}
		}
		const frame: AdvancedAnimationFrame = Object.freeze({
			activeNodeIds: Object.freeze([...this.#records.keys()]),
			[advancedAnimationFrameBrand]: true as const,
		});
		this.#latestAdvancedFrame = frame;
		this.#diagnostics = {
			...this.#diagnostics,
			activePlaybackCount,
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
			return this.#sample(nodeId, selectedPlayback(record));
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
		const records = new Map<SceneNodeId, NodeAnimation>();
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
				records.set(nodeId, {
					kind: "ordinary",
					ordinary: { current: record, successor: null },
					activity: "explicit",
				});
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
		visible: boolean,
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
			this.#advanceSemanticStep(nodeId, record, visible ? "live" : "hidden");
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
	 * its neighbours by an identity-derived offset, while a host-projected clip enters at its
	 * authored boundary on receipt. No missed host phase is reconstructed.
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
		mode: "initial-state" | "live" | "hidden",
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
		if (mode !== "hidden")
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
		const playbackDirection =
			record.clip.framesPerSecond < 0 ? "backward" : "forward";
		for (const frameIndex of departedFrames) {
			for (const hook of record.clip.animation.hooks) {
				if (hook.frameIndex !== frameIndex) continue;
				if (hook.direction !== "both" && hook.direction !== playbackDirection)
					continue;
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
