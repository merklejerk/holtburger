import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import type { DistantAnimationSamplingPolicy } from "../../frontend-tuning-contract";
import {
	isContentFailure,
	isHostCapacityFailure,
} from "../../host/host-command-result";
import {
	resolvedFrameRotationFromRenderTransform,
	sceneVec3,
	sceneVector3,
	writeRenderQuaternionFromRenderTransform,
	type MutableRenderQuaternion,
	type ResolvedFrameRotation,
	type SceneVector3,
} from "../../assets/ac-frame";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { PhysicsScriptTableSource } from "../../assets/physics-script-table-source";
import { selectPhysicsScript } from "../../assets/decode-physics-script-table-record";
import type { HumanoidBodyLayout } from "../animation/humanoid-body-layout";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";
import {
	SKY_OBJECT_ONLY_PART_INDEX,
	type SkyBehaviorTarget,
} from "../environment/sky-behavior-targets";
import type { DatAssetId } from "../game-types";
import { createLandblockWorldOrigin } from "../landblocks";
import { transformPoint3 } from "../math/matrices";
import { Vec3 } from "../math/types";
import type { Renderer, RendererFrameFeedback } from "../renderer/renderer";
import { SceneGraph, type SceneNodeId } from "../scene";
import { sceneNodeIdOf } from "../scene/utils";
import {
	BehaviorEventRouter,
	behaviorTargetId,
	type BehaviorConsumers,
	type BehaviorTarget,
	type BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import type { PreparedParticleEmitter } from "../behavior/particle-emitter-repository";
import { ParticleMeshCache } from "../behavior/particle-mesh-cache";
import type {
	PhysicsScriptRepository,
	PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import { PhysicsScriptTableRepository } from "../behavior/physics-script-table-repository";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import {
	AnimationSystem,
	type AnimationLayerUpdate,
} from "../systems/animation-system";
import {
	CombatEffectsSystem,
	type CombatEffectOutcome,
	type CombatEffectPlacement,
	type CombatEffectsAppearance,
	type CombatEffectsTuning,
} from "../systems/combat-effects-system";
import type { DynamicEntitySystem } from "../systems/dynamic-entity-system";
import { EffectSystem } from "../systems/effect-system";
import {
	ParticleSystem,
	SKY_PARTICLE_RENDER_OWNER,
	type ParticleRenderOwner,
	type UniformRoll,
} from "../systems/particle-system";
import { PhysicsScriptSystem } from "../systems/physics-script-system";
import { SkyScriptSystem } from "../systems/sky-script-system";
import { AnimationPresentationScheduler } from "./animation-presentation-scheduler";
import type {
	DynamicEntityMotion,
	DynamicEntityMotionLayer,
	DynamicEntityView,
} from "./dynamic-entity-feed";
import {
	classifyDynamicEntityMotionUpdate,
	playingClipForDynamicEntityMotion,
	type DynamicEntityMotionState,
} from "./dynamic-entity-motion";
import { datAssetId } from "./dynamic-entity-presentation";
import {
	SKY_OWNER_ID,
	type DynamicEntityOwnerId,
	type DynamicOwnerId,
	type ResourceOwnerId,
	type SkyOwnerId,
} from "./owner-ids";
import type { PresentationAssetService } from "./presentation-asset-service";

/** Transient high-level PlayScript input bound to one authoritative entity generation. */
export interface DynamicEntityScriptCue {
	readonly guid: number;
	readonly generation: number;
	readonly cue: number;
	readonly intensity: number;
}

/** Transient sound-table input admitted to an exact entity incarnation. */
export interface DynamicEntitySoundCue {
	readonly guid: number;
	readonly generation: number;
	readonly soundId: number;
	readonly volume: number;
}

/** Shared preparation order for the two actual server-cue consumers. */
type DynamicEntityCue =
	| ({ readonly kind: "script" } & DynamicEntityScriptCue)
	| ({
			readonly kind: "sound";
			readonly expiresAtMs: number;
	  } & DynamicEntitySoundCue);

/** Script and emitter leases owned by staging, then by the installed entity. */
export interface DynamicCueAssets {
	readonly closure: PreparedPhysicsScriptClosure;
	readonly emitterHandles: readonly PreparedAssetHandle<PreparedParticleEmitter>[];
}

/** Retail `PS_UnHide` and `PS_Hidden`, raised locally by retail object hidden assignment. */
export const RETAIL_UNHIDE_PHYSICS_SCRIPT_CUE = 0x75;
export const RETAIL_HIDDEN_PHYSICS_SCRIPT_CUE = 0x76;
const INTRINSIC_STATE_CUE_INTENSITY = 1;

export interface CueDesiredEntityInfo {
	cueHidden: boolean;
	readonly entity: {
		readonly identity: { readonly guid: number };
		readonly generation: number;
		readonly physics: { readonly hidden: boolean };
	};
	readonly scriptTableId: DatAssetId | null | undefined;
	readonly realization:
		| { readonly kind: "idle" }
		| {
				readonly kind: "preparing";
				readonly completion: Promise<CueInstalledEntityInfo | null>;
		  }
		| { readonly kind: "unavailable"; readonly error: Error };
}

export interface CueInstalledEntityInfo {
	bodyLayout: HumanoidBodyLayout | null;
	readonly generation: number;
	readonly behaviorGeneration: number;
	readonly nodeId: SceneNodeId;
	readonly ownerId: DynamicEntityOwnerId;
	motionState: {
		ordinary: DynamicEntityMotionState | null;
		locomotion: DynamicEntityMotionState | null;
	} | null;
}

export interface BehaviorCueAndEffectsContext {
	readonly scene: SceneGraph;
	readonly presentationAssets: PresentationAssetService;
	readonly physicsScriptTableSource: PhysicsScriptTableSource;
	readonly particleMeshSource: ParticleMeshSource;
	readonly roll?: UniformRoll;
	readonly clock: () => number;
	readonly isDestroyed: () => boolean;
	readonly reportContentFailure: (error: Error) => void;
	readonly pushPresentationFailure: (cause: unknown) => void;
	readonly trackRealizationContinuation: (
		continuation: Promise<unknown>,
	) => void;
	readonly createBehaviorAudioCommands: () => BehaviorConsumers["audio"];
	readonly playSoundTableKey: (
		target: Parameters<BehaviorConsumers["audio"]["playSoundTableKey"]>[0],
		soundType: number,
		packet: {
			readonly volume: number;
			readonly canReplay: () => boolean;
		} | null,
	) => ReturnType<BehaviorConsumers["audio"]["playSoundTableKey"]>;
	readonly isAudioListenerEnabled: () => boolean;
	readonly installParticleMeshes: (
		batch: Parameters<NonNullable<Renderer["particles"]>["install"]>[0],
	) => Promise<void>;
	readonly getCameraPosition: () => {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly getProtectedEntityGuids: () => {
		readonly viewer: number | null;
		readonly selected: number | null;
		readonly hovered: number | null;
	};
	readonly getDynamics: () => DynamicEntitySystem<
		DynamicOwnerId,
		ResourceOwnerId
	>;
	readonly isParticleRootSuppressed: (root: SceneNodeId) => boolean;
	readonly getDesiredEntity: (guid: number) => CueDesiredEntityInfo | undefined;
	readonly getInstalledPresentation: (
		guid: number,
	) => CueInstalledEntityInfo | undefined;
	readonly getDesiredChildren: (guid: number) => Iterable<number> | undefined;
	readonly getRendererCombatEffects: () => Renderer["combatEffects"];
}

/**
 * Owns animation motion/sampling, physics scripts, particles, cues, sky scripts,
 * and combat effects.
 */
export class BehaviorCueAndEffectsCoordinator {
	readonly #context: BehaviorCueAndEffectsContext;
	/** Rigid-part pose updates sequenced before visibility and drawing. */
	readonly #animation: AnimationSystem<ResourceOwnerId>;
	/** Optional selected-pose quality policy; offscreen scheduling remains independent. */
	#distantAnimationSampling = copyDistantAnimationSamplingPolicy(
		SHARED_FRONTEND_TUNING.animationPresentation.distantSampling,
	);
	/** Reused scene-space origin for synchronous distance decisions. */
	readonly #animationDistanceOrigin = sceneVec3(Vec3.zero());
	/** One visual scheduler; all animation semantics advance before it selects samples. */
	readonly #animationPresentation = new AnimationPresentationScheduler(
		(nodeId, selected, ordinaryInterval) =>
			this.#animationSampleIntervalSeconds(nodeId, selected, ordinaryInterval),
		(nodeId) => this.#animation.needsPresentation(nodeId),
	);
	/** Previous frame's renderer selection, which particle culling reads. */
	#selectedDynamicNodeIds = new Set<SceneNodeId>();
	/** Persistent visual-effect state advanced only by the authored behavior clock. */
	readonly #effects: EffectSystem;
	/** Routes animation plus browser-scale static and sky script consequences. */
	readonly #behaviorRouter: BehaviorEventRouter;
	/** Routes spawned-client script consequences while consuming object state as world-owned. */
	readonly #worldOwnedBehaviorRouter: BehaviorEventRouter;
	readonly #physicsScripts: PhysicsScriptRepository;
	readonly #physicsScriptTables: PhysicsScriptTableRepository;
	readonly #particleEmitters: ParticleEmitterRepository;
	readonly #particles: ParticleSystem;
	#combatEffects: CombatEffectsSystem | null = null;
	readonly #particleMeshes: ParticleMeshCache;
	/**
	 * Sky-module-owned behavior targets, which have no scene residency at all.
	 *
	 * Registered at activation and removed at teardown, so membership is also the liveness signal
	 * the residency resolvers read.
	 */
	readonly #skyTargets = new Map<BehaviorTargetId, SkyBehaviorTarget>();
	/** Runs the scripts authored on sky objects; owns their staging and lifetime. */
	readonly #skyScripts: SkyScriptSystem;
	readonly #physicsScriptSystem: PhysicsScriptSystem<
		DynamicOwnerId | SkyOwnerId
	>;
	/** Browser effects playback for spawned entities whose object state comes from world projection. */
	readonly #worldOwnedPhysicsScriptSystem: PhysicsScriptSystem<DynamicOwnerId>;
	/** One retained local racial closure per dynamic owner, replaced instead of accumulated. */
	readonly #dynamicOverrideEffects = new Map<
		DynamicOwnerId,
		DynamicCueAssets
	>();
	/** High-level cues waiting for their exact entity generation to be visually realized. */
	readonly #pendingDynamicEntityCues = new Map<number, DynamicEntityCue[]>();
	/** Discontinuities invalidate asynchronous cue preparation and cold sound replay. */
	#entityCueEpoch = 0;
	/** Additional live-cue assets retained until their dynamic owner generation retires. */
	readonly #dynamicCueAssets = new Map<DynamicOwnerId, DynamicCueAssets[]>();
	/** Per-entity insertion order; asset preparation remains concurrent and teardown tracks every tail. */
	readonly #dynamicCueInsertions = new Map<number, Promise<void>>();
	/** Missing source table/key differs from AudioSystem's intentional probability/mute outcomes. */
	#unpreparedServerSoundCount = 0;
	/** Cues whose source preparation outlived the existing audio warmup window. */
	#expiredServerSoundCount = 0;
	/** Hoisted per-frame particle visibility callbacks so render() allocates nothing. */
	readonly #isParticleTargetVisible = (target: BehaviorTarget): boolean =>
		this.#particleRenderOwner(target) !== null;
	readonly #resolveParticleRenderOwner = (
		target: BehaviorTarget,
	): ParticleRenderOwner | null => this.#particleRenderOwner(target);

	constructor(context: BehaviorCueAndEffectsContext) {
		this.#context = context;
		this.#effects = new EffectSystem();
		this.#particleMeshes = new ParticleMeshCache(
			context.particleMeshSource,
			(batch) => context.installParticleMeshes(batch),
		);
		this.#physicsScripts = context.presentationAssets.physicsScripts;
		this.#physicsScriptTables = new PhysicsScriptTableRepository(
			context.physicsScriptTableSource,
		);
		this.#particleEmitters = context.presentationAssets.particleEmitters;
		this.#particles = new ParticleSystem({
			distanceSpacingMultiplier:
				SHARED_FRONTEND_TUNING.particleDistanceSpacingMultiplier,
			clock: context.clock,
			// Reads an already-staged definition; an unstaged id returns null rather than starting
			// a load inside the frame.
			resolveEmitter: (emitterInfoId) => this.#preparedEmitter(emitterInfoId),
			sceneOriginOf: (target) => this.#originOf(target),
			targetLives: (target) => this.#targetLives(target),
			sceneRotationOf: (target) => this.#rotationOf(target),
			writeSceneRenderRotationOf: (target, output) =>
				this.#writeRenderRotationOf(target, output),
			// A part-attached emitter is positioned by its part's node, which the dynamics system owns.
			// The generation is carried through unchanged: the part belongs to the same activation, so
			// a command that has outlived its owner must still be rejected.
			partFrameOf: (target, partIndex) => this.#partFrameOf(target, partIndex),
			roll: context.roll ?? Math.random,
		});
		// Each script system both produces and consumes `CallPES`, so its router and scheduler are
		// mutually dependent by design. Holders break those construction cycles without mutable ports.
		const scriptWiring: {
			system?: PhysicsScriptSystem<DynamicOwnerId | SkyOwnerId>;
		} = {};
		const worldOwnedScriptWiring: {
			system?: PhysicsScriptSystem<DynamicOwnerId>;
		} = {};
		const behaviorAudio = context.createBehaviorAudioCommands();
		const behaviorParticles = this.#createBehaviorParticleCommands();
		const behaviorTargets: BehaviorConsumers["targets"] = {
			// Animation and scripts install independently. Any current producer makes the exact
			// generation live; neither script evaluator needs to know which population owns it.
			isLive: (target) =>
				this.#animation.holds(target) ||
				(scriptWiring.system?.holds(target) ?? false) ||
				(worldOwnedScriptWiring.system?.holds(target) ?? false),
		};
		this.#behaviorRouter = new BehaviorEventRouter(
			{
				audio: behaviorAudio,
				effects: this.#effects,
				// Authored particles arrive only from physics scripts, and no resident runs one
				// until Phase 7 activates them. Reporting unprepared keeps the outcome honest
				// instead of pretending an emitter was created.
				particles: behaviorParticles,
				objectState: {
					applyObjectState: (target, values, mode) => {
						if (values.kind !== "scale") return "no-consumer";
						this.#effects.applyScale(target, values);
						return mode === "initial-state"
							? "folded-initial-state"
							: "executed";
					},
				},
				// Chained script activation lands with the script clock in Phase 7; until an authored
				// script runs, no `CallPES` can reach this port.
				scheduler: {
					scheduleActivation: (target, activation) => {
						const system = scriptWiring.system;
						if (!system)
							throw new Error(
								"Script activation reached an unwired scheduler.",
							);
						return system.scheduleActivation(target, activation);
					},
				},
				targets: behaviorTargets,
			},
			SHARED_FRONTEND_TUNING.diagnostics.maximumRecentEffectObservations,
		);
		this.#worldOwnedBehaviorRouter = new BehaviorEventRouter(
			{
				audio: behaviorAudio,
				effects: this.#effects,
				particles: behaviorParticles,
				// Spawned entities receive scale, visibility, and emitted-light state in world projection.
				// Browser playback records each understood state hook without mutating host-owned facts.
				objectState: { applyObjectState: () => "owned-by-world" },
				scheduler: {
					scheduleActivation: (target, activation) => {
						const system = worldOwnedScriptWiring.system;
						if (!system)
							throw new Error(
								"World-owned script activation reached an unwired scheduler.",
							);
						return system.scheduleActivation(target, activation);
					},
				},
				targets: behaviorTargets,
			},
			SHARED_FRONTEND_TUNING.diagnostics.maximumRecentEffectObservations,
		);
		this.#animation = new AnimationSystem(this.#effects, this.#behaviorRouter);
		this.#physicsScriptSystem = new PhysicsScriptSystem<
			DynamicOwnerId | SkyOwnerId
		>(this.#behaviorRouter, Math.random);
		scriptWiring.system = this.#physicsScriptSystem;
		this.#worldOwnedPhysicsScriptSystem =
			new PhysicsScriptSystem<DynamicOwnerId>(
				this.#worldOwnedBehaviorRouter,
				Math.random,
			);
		worldOwnedScriptWiring.system = this.#worldOwnedPhysicsScriptSystem;
		this.#skyScripts = new SkyScriptSystem({
			onFailure: (cause) => {
				if (isContentFailure(cause))
					context.reportContentFailure(
						new Error("Sky effect unavailable; effect omitted.", { cause }),
					);
				else context.pushPresentationFailure(cause);
			},
			acquireClosure: (scriptId) =>
				this.#physicsScripts.acquireClosure(scriptId),
			acquireEmitter: (emitterInfoId) =>
				this.#particleEmitters.acquire(emitterInfoId),
			installMeshes: (emitters) =>
				this.#particleMeshes.prepare([
					...new Set(
						emitters.flatMap((emitter) =>
							emitter.kind === "drawable" ? [emitter.mesh.id] : [],
						),
					),
				]),
			installScript: (target, closure, timeSeconds) =>
				this.#physicsScriptSystem.install(
					SKY_OWNER_ID,
					target,
					closure,
					timeSeconds,
				),
			removeScript: (targetId) =>
				this.#physicsScriptSystem.remove(SKY_OWNER_ID, targetId),
			registerTarget: (targetId, target) =>
				this.#skyTargets.set(targetId, target),
			unregisterTarget: (targetId) => this.#skyTargets.delete(targetId),
			// Read per call rather than captured, so every sky target follows the live camera.
			viewerOrigin: () => {
				const position = context.getCameraPosition();
				return sceneVector3([position.x, position.y, position.z]);
			},
			clock: context.clock,
		});
	}

	get animation(): AnimationSystem<ResourceOwnerId> {
		return this.#animation;
	}

	get effects(): EffectSystem {
		return this.#effects;
	}

	get physicsScripts(): PhysicsScriptRepository {
		return this.#physicsScripts;
	}

	get physicsScriptTables(): PhysicsScriptTableRepository {
		return this.#physicsScriptTables;
	}

	get particleEmitters(): ParticleEmitterRepository {
		return this.#particleEmitters;
	}

	get particles(): ParticleSystem {
		return this.#particles;
	}

	get particleMeshes(): ParticleMeshCache {
		return this.#particleMeshes;
	}

	get skyScripts(): SkyScriptSystem {
		return this.#skyScripts;
	}

	get physicsScriptSystem(): PhysicsScriptSystem<DynamicOwnerId | SkyOwnerId> {
		return this.#physicsScriptSystem;
	}

	get worldOwnedPhysicsScriptSystem(): PhysicsScriptSystem<DynamicOwnerId> {
		return this.#worldOwnedPhysicsScriptSystem;
	}

	hasSkyTarget(targetId: BehaviorTargetId): boolean {
		return this.#skyTargets.has(targetId);
	}

	originOf(target: BehaviorTarget): SceneVector3 | null {
		return this.#originOf(target);
	}

	pendingCueGuids(): IterableIterator<number> {
		return this.#pendingDynamicEntityCues.keys();
	}

	retainPendingDynamicEntityCues(
		guid: number,
		generation: number | undefined,
	): void {
		this.#retainPendingDynamicEntityCues(guid, generation);
	}

	removeEntityCuesForGeneration(guid: number, generation: number): void {
		const pending = this.#pendingDynamicEntityCues.get(guid);
		if (pending === undefined) return;
		const retained = pending.filter((cue) => cue.generation !== generation);
		if (retained.length === 0) this.#pendingDynamicEntityCues.delete(guid);
		else this.#pendingDynamicEntityCues.set(guid, retained);
	}

	deleteCueInsertion(guid: number): void {
		this.#dynamicCueInsertions.delete(guid);
	}

	clearPendingCues(): void {
		this.#pendingDynamicEntityCues.clear();
	}

	drainDynamicEntityCues(guid: number): void {
		this.#drainDynamicEntityCues(guid);
	}

	reconcileIntrinsicHiddenCue(record: CueDesiredEntityInfo): void {
		this.#reconcileIntrinsicHiddenCue(record);
	}

	prepareDirectDynamicScript(
		rootId: DatAssetId,
	): Promise<DynamicCueAssets | null> {
		return this.#prepareDirectDynamicScript(rootId);
	}

	setDynamicOverrideEffect(
		ownerId: DynamicOwnerId,
		assets: DynamicCueAssets,
	): void {
		this.#dynamicOverrideEffects.set(ownerId, assets);
	}

	releaseDynamicOverrideEffect(ownerId: DynamicOwnerId): void {
		this.#releaseDynamicOverrideEffect(ownerId);
	}

	releaseDynamicCueAssets(ownerId: DynamicOwnerId): void {
		this.#releaseDynamicCueAssets(ownerId);
	}

	reanchorDynamicParticles(guid: number): void {
		this.#reanchorDynamicParticles(guid);
	}

	applyDynamicEntityMotion(
		installed: CueInstalledEntityInfo,
		motion: DynamicEntityMotion | null,
		entityClass: DynamicEntityView["presentation"]["entityClass"],
		placement: DynamicEntityView["placement"],
	): void {
		this.#applyDynamicEntityMotion(installed, motion, entityClass, placement);
	}

	stageParticleMeshes(
		emitters: readonly PreparedParticleEmitter[],
	): Promise<void> {
		return this.#stageParticleMeshes(emitters);
	}

	scriptMeshesReady(closure: PreparedPhysicsScriptClosure): boolean {
		return this.#scriptMeshesReady(closure);
	}

	/** Queue one server or locally triggered PlayScript cue for the exact entity generation. */
	playDynamicEntityScriptCue(cue: DynamicEntityScriptCue): void {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot play a dynamic script cue after runtime shutdown.",
			);
		if (
			!Number.isInteger(cue.guid) ||
			cue.guid < 0 ||
			!Number.isInteger(cue.generation) ||
			cue.generation < 0 ||
			!Number.isInteger(cue.cue) ||
			cue.cue < 0 ||
			!Number.isFinite(cue.intensity)
		) {
			throw new Error("Dynamic script cue is outside its typed domain.");
		}
		this.#queueDynamicEntityCue({ kind: "script", ...cue });
	}

	/** Send server effects through the same entity readiness/order path as script cues. */
	playDynamicEntitySoundCue(
		cue: DynamicEntitySoundCue,
		receivedAtMs: number,
	): void {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot play a dynamic sound cue after runtime shutdown.",
			);
		if (
			!Number.isInteger(cue.guid) ||
			cue.guid < 0 ||
			!Number.isInteger(cue.generation) ||
			cue.generation < 0 ||
			!Number.isInteger(cue.soundId) ||
			cue.soundId < 0 ||
			!Number.isFinite(cue.volume) ||
			cue.volume < 0
		)
			throw new Error("Dynamic sound cue is outside its typed domain.");
		this.#queueDynamicEntityCue({
			kind: "sound",
			...cue,
			expiresAtMs:
				receivedAtMs +
				SHARED_FRONTEND_TUNING.audio.maximumWarmupReplaySeconds * 1_000,
		});
	}

	/** Stop old-world cue work without replacing the presentation runtime. */
	clearDynamicEntityCues(): void {
		this.#entityCueEpoch += 1;
		this.#pendingDynamicEntityCues.clear();
		this.#dynamicCueInsertions.clear();
	}

	/** Set offscreen visual sampling cadence; zero preserves full render cadence. */
	setOffscreenAnimationSampleIntervalSeconds(intervalSeconds: number): void {
		this.#animationPresentation.setOffscreenSampleIntervalSeconds(
			intervalSeconds,
		);
	}

	/**
	 * Opt into held distant visual poses, including shadows, attachments and particle part anchors.
	 * Null restores selected roots to render cadence; world movement and event clocks are unaffected.
	 */
	setDistantAnimationSampling(
		policy: DistantAnimationSamplingPolicy | null,
	): void {
		this.#distantAnimationSampling = copyDistantAnimationSamplingPolicy(policy);
	}

	/** App-local entry point: correlation is already decided in core, placement is cosmetic. */
	acceptCombatOutcome(
		outcome: CombatEffectOutcome,
		target: number | null,
		tuning: CombatEffectsTuning,
		nowMs: number,
	): void {
		if (this.#context.isDestroyed()) return;
		if (this.#combatEffects === null) {
			const capability = this.#context.getRendererCombatEffects();
			if (!capability)
				throw new Error("Client renderer cannot present combat effects.");
			this.#combatEffects = new CombatEffectsSystem(tuning, capability);
		}
		const placement =
			target === null
				? { kind: "unplaced" as const }
				: this.#combatEffectPlacement(target);

		this.#combatEffects.accept(outcome, placement, nowMs);
	}

	/** Cold appearance updates preserve the effects owner and current logical instances. */
	setCombatEffectsAppearance(appearance: CombatEffectsAppearance): void {
		this.#combatEffects?.setAppearance(appearance);
	}

	refreshCombatEffectsFontAtlas(): void {
		this.#combatEffects?.refreshFontAtlas();
	}

	/** World discontinuity/resync clears transient work without allocating any resources. */
	clearCombatEffects(): void {
		this.#combatEffects?.clear();
	}

	/** Cosmetic time advances independently of scene readiness or world simulation. */
	advanceCombatEffects(nowMs: number): void {
		this.#combatEffects?.advance(nowMs);
	}

	advanceEffectsAndParticles(
		timeSeconds: number,
		sky: ResolvedSceneEnvironment["sky"],
		weatherEnabled: boolean,
	): void {
		// Reconciled before the clocks advance, so a script activated by this tick's sky state runs
		// its `t=0` records on the same tick rather than a frame late.
		this.#skyScripts.sync(sky, weatherEnabled);
		// Before either producer dispatches: a command applied this frame lands on state that has
		// already reached this frame's behavior step, exactly as it did when animation drove it.
		this.#effects.advance(timeSeconds);
		this.#physicsScriptSystem.advance(timeSeconds);
		this.#worldOwnedPhysicsScriptSystem.advance(timeSeconds);
		// Advance against the same previous-frame owner selection used below for draw routing. Sky
		// owners remain unconditionally visible through #particleRenderOwner.
		this.#particles.advance(timeSeconds, this.#isParticleTargetVisible);
	}

	advanceAndPublishAnimation(
		timeSeconds: number,
		dynamics: DynamicEntitySystem<DynamicOwnerId, ResourceOwnerId>,
	): void {
		const animationFrame = this.#animation.advance(timeSeconds);
		const presentationSelection = this.#animationPresentation.select(
			animationFrame,
			timeSeconds,
		);
		dynamics.publishPresentation(
			this.#animation.sample(
				animationFrame,
				presentationSelection.selectedNodeIds,
			),
		);
	}

	submitParticles(renderer: Renderer): void {
		// Ranges cull at emitter granularity against the previous frame's selection. They are built
		// before the renderer selects, so this is one frame behind; the owner's bounds already
		// include the particle envelope, so an emitter entering view is selected on the frame its
		// envelope crosses the frustum rather than when its mesh does.
		renderer.particles?.submit(
			this.#particles.collectDrawRanges(this.#resolveParticleRenderOwner),
			{
				data: this.#particles.recordData,
				dirtyRows: this.#particles.takeDirtyRecordRows(),
			},
		);
	}

	completeAnimationFrame(
		feedback: RendererFrameFeedback,
		timeSeconds: number,
	): void {
		this.#selectedDynamicNodeIds = new Set(feedback.selectedDynamicNodeIds);
		this.#animationPresentation.completeFrame(feedback, timeSeconds);
	}

	retryFailed(): void {
		this.#physicsScriptTables.retryFailed();
		this.#particleMeshes.retryFailed();
		this.#skyScripts.retryFailed();
	}

	getDiagnostics() {
		return {
			animation: this.#animation.getDiagnostics(),
			serverSound: {
				unpreparedCount: this.#unpreparedServerSoundCount,
				expiredCount: this.#expiredServerSoundCount,
			},
			behavior: this.#behaviorRouter.getDiagnostics(),
			worldOwnedBehavior: this.#worldOwnedBehaviorRouter.getDiagnostics(),
			particles: this.#particles.getDiagnostics(),
			physicsScripts: this.#physicsScriptSystem.getDiagnostics(),
			worldOwnedPhysicsScripts:
				this.#worldOwnedPhysicsScriptSystem.getDiagnostics(),
			skyScripts: { activeCount: this.#skyScripts.activeCount },
			effects: this.#effects.getDiagnostics(),
			presentationCadence: this.#animationPresentation.getDiagnostics(),
		};
	}

	destroyParticleMeshes(): void {
		this.#particleMeshes.destroy();
	}

	destroyPhysicsScriptTables(): void {
		this.#physicsScriptTables.destroy();
	}

	destroyWorldPhysicsScripts(): void {
		this.#worldOwnedPhysicsScriptSystem.destroy();
	}

	destroyPhysicsScripts(): void {
		this.#physicsScriptSystem.destroy();
	}

	destroyAnimation(): void {
		this.#animation.destroy();
	}

	clearAnimationSelection(): void {
		this.#animationPresentation.clear();
	}

	disposeCombatEffects(): void {
		const effects = this.#combatEffects;
		this.#combatEffects = null;
		effects?.dispose();
	}

	destroySkyScripts(): Promise<void> {
		return this.#skyScripts.destroy();
	}

	/** Stage drawable meshes before activating any producer of particle hooks. */
	async #stageParticleMeshes(
		emitters: readonly PreparedParticleEmitter[],
	): Promise<void> {
		const meshIds = [
			...new Set(
				emitters.flatMap((emitter) =>
					emitter.kind === "drawable" ? [emitter.mesh.id] : [],
				),
			),
		];
		if (meshIds.length === 0) return;
		for (const id of meshIds) {
			try {
				await this.#particleMeshes.prepare([id]);
			} catch (cause) {
				if (!isContentFailure(cause)) throw cause;
				this.#context.reportContentFailure(
					new Error(
						`Particle mesh ${id} unavailable; dependent effect omitted.`,
						{ cause },
					),
				);
			}
		}
	}

	/** A script root may run only when every drawable dependency has a renderer installation. */
	#scriptMeshesReady(closure: PreparedPhysicsScriptClosure): boolean {
		return [...closure.scripts.values()].every((script) =>
			script.dependencies.emitterInfoIds.every(
				(id) => this.#preparedEmitter(id) !== null,
			),
		);
	}

	#preparedEmitter(id: DatAssetId): PreparedParticleEmitter | null {
		const emitter = this.#particleEmitters.getReady(id);
		return emitter?.kind === "drawable" &&
			!this.#particleMeshes.isReady(emitter.mesh.id)
			? null
			: emitter;
	}

	/**
	 * Origin of a node in the fixed scene frame.
	 *
	 * Landblock-local origins are meaningless outside their own landblock, and anchor-relative ones
	 * decay the moment the camera crosses a boundary. This frame is the only one safe to retain.
	 */
	#sceneOriginOf(nodeId: SceneNodeId): SceneVector3 | null {
		const resolved = this.#context.scene.readResolvedState(nodeId)?.placement;
		if (!resolved) return null;
		const origin = resolved.localToLandblock;
		const landblockOrigin = createLandblockWorldOrigin(resolved.landblockId);
		return sceneVector3([
			origin.m41 + landblockOrigin.x,
			origin.m42 + landblockOrigin.y,
			origin.m43 + landblockOrigin.z,
		]);
	}

	/**
	 * Current rotation of a target's frame in the paired AC/render particle contract.
	 *
	 * Read from the same resolved placement as {@link BehaviorCueAndEffectsCoordinator.#sceneOriginOf}, so it reflects
	 * whatever a script has rotated the owner to rather than its authored pose.
	 */
	#sceneRotationOf(nodeId: SceneNodeId): ResolvedFrameRotation | null {
		const placement = this.#context.scene.readResolvedState(nodeId)?.placement;
		if (!placement) return null;
		return resolvedFrameRotationFromRenderTransform(placement.localToLandblock);
	}

	/**
	 * Resolve one behavior target's frame, whichever module owns it.
	 *
	 * This is the single place that knows every residency, which is what lets `BehaviorTarget` stay
	 * one id and one generation with no kind tag: consumers take origins and rotations as injected
	 * functions and never learn that sky targets exist. A target in neither residency resolves
	 * `null` rather than throwing, because that is exactly what a torn-down target should report —
	 * teardown removes its registration, and a command queued against it must be rejected as stale.
	 */
	#originOf(target: BehaviorTarget): SceneVector3 | null {
		const sky = this.#skyTargets.get(target.targetId);
		if (sky) return sky.originOf();
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId === null ? null : this.#sceneOriginOf(nodeId);
	}

	/** Shared particle sink; particles stay browser-owned for every script population. */
	#createBehaviorParticleCommands(): BehaviorConsumers["particles"] {
		return {
			createEmitter: (target, command) =>
				this.#particles.createEmitter(target, command),
			stop: (target, emitterId) => this.#particles.stop(target, emitterId),
			destroy: (target, emitterId) =>
				this.#particles.destroy(target, emitterId),
		};
	}

	/**
	 * Whether a behavior target still exists, in either residency, without resolving its frame.
	 *
	 * The liveness half of {@link BehaviorCueAndEffectsCoordinator.#originOf}, split out because per-frame consumers ask
	 * only this: both residencies always publish an origin for a target they hold, so existence and
	 * "has an origin" are the same fact, and only one of them costs a scene-hierarchy walk.
	 */
	#targetLives(target: BehaviorTarget): boolean {
		if (this.#skyTargets.has(target.targetId)) return true;
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId !== null && this.#context.scene.hasNode(nodeId);
	}

	#rotationOf(target: BehaviorTarget): ResolvedFrameRotation | null {
		const sky = this.#skyTargets.get(target.targetId);
		if (sky) return sky.rotationOf();
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId === null ? null : this.#sceneRotationOf(nodeId);
	}

	/** Write one target's render rotation without allocating an AC-axis trajectory representation. */
	#writeRenderRotationOf(
		target: BehaviorTarget,
		output: MutableRenderQuaternion,
	): boolean {
		const sky = this.#skyTargets.get(target.targetId);
		if (sky) {
			const rotation = sky.rotationOf().render;
			output.w = rotation.w;
			output.x = rotation.x;
			output.y = rotation.y;
			output.z = rotation.z;
			return true;
		}
		const nodeId = sceneNodeIdOf(target.targetId);
		if (nodeId === null) return false;
		const placement = this.#context.scene.readResolvedState(nodeId)?.placement;
		if (!placement) return false;
		writeRenderQuaternionFromRenderTransform(
			placement.localToLandblock,
			output,
		);
		return true;
	}

	/**
	 * Resolve the frame a part-attached emitter rides.
	 *
	 * Sky objects are single-part Setups — the whole censused set is one part, `0x010001EC`,
	 * carrying only a default script — so their only part is the object itself and part 0 resolves
	 * to the same frame. Any other index names a part they do not have, which is `unprepared`
	 * rather than a silent fallback to the root.
	 */
	#partFrameOf(
		target: BehaviorTarget,
		partIndex: number,
	): BehaviorTarget | null {
		if (this.#skyTargets.has(target.targetId)) {
			return partIndex === SKY_OBJECT_ONLY_PART_INDEX ? target : null;
		}
		const nodeId = sceneNodeIdOf(target.targetId);
		if (nodeId === null) return null;
		const partNodeId = this.#context
			.getDynamics()
			.requestPartNode(nodeId, partIndex);
		// The generation is carried through unchanged: the part belongs to the same activation, so
		// a command that has outlived its owner must still be rejected.
		return partNodeId === null
			? null
			: {
					generation: target.generation,
					targetId: behaviorTargetId(partNodeId),
				};
	}

	/**
	 * Resolve the render owner for a target whose particles survive this frame's culling.
	 *
	 * Scene residents cull against the renderer's previous dynamic selection. Sky targets are
	 * viewer-centered and drawn unconditionally — retail never culls the sky — so they are always
	 * selected and route through the exterior domain. Without that explicit owner they would cull
	 * to nothing every frame: a sky target is absent from a selection built out of scene node ids.
	 */
	#particleRenderOwner(target: BehaviorTarget): ParticleRenderOwner | null {
		if (this.#skyTargets.has(target.targetId)) {
			return SKY_PARTICLE_RENDER_OWNER;
		}
		const nodeId = sceneNodeIdOf(target.targetId);
		const dynamics = this.#context.getDynamics();
		const root = nodeId === null ? null : dynamics.modelRootOf(nodeId);
		return root !== null &&
			!this.#context.isParticleRootSuppressed(root) &&
			dynamics.canRenderParticles(root) &&
			this.#selectedDynamicNodeIds.has(root)
			? root
			: null;
	}

	#queueDynamicEntityCue(cue: DynamicEntityCue): void {
		const desired = this.#context.getDesiredEntity(cue.guid);
		if (desired !== undefined && desired.entity.generation !== cue.generation)
			return;
		const pending = (this.#pendingDynamicEntityCues.get(cue.guid) ?? []).filter(
			(item) => this.#isEntityCueTimely(item),
		);
		if (!this.#isEntityCueTimely(cue)) return;
		pending.push(cue);
		this.#pendingDynamicEntityCues.set(cue.guid, pending);
		this.#drainDynamicEntityCues(cue.guid);
	}

	#isEntityCueTimely(cue: DynamicEntityCue): boolean {
		if (cue.kind === "script" || performance.now() <= cue.expiresAtMs)
			return true;
		this.#expiredServerSoundCount += 1;
		return false;
	}

	/** Discard queued cues that cannot belong to the named desired generation. */
	#retainPendingDynamicEntityCues(
		guid: number,
		generation: number | undefined,
	): void {
		const pending = this.#pendingDynamicEntityCues.get(guid);
		if (pending === undefined) return;
		const retained = pending.filter((cue) => cue.generation === generation);
		if (retained.length === 0) this.#pendingDynamicEntityCues.delete(guid);
		else this.#pendingDynamicEntityCues.set(guid, retained);
	}

	/** Prepare cues concurrently with installation; serialize only their execution. */
	#drainDynamicEntityCues(guid: number): void {
		const desired = this.#context.getDesiredEntity(guid);
		if (desired === undefined || desired.scriptTableId === undefined) return;
		const installed = this.#context.getInstalledPresentation(guid);
		const ready =
			desired.realization.kind === "preparing"
				? desired.realization.completion
				: installed?.generation === desired.entity.generation
					? Promise.resolve(installed)
					: null;
		if (ready === null) return;
		const queued = this.#pendingDynamicEntityCues.get(guid);
		if (queued === undefined) return;
		const current = queued.filter(
			(cue) => cue.generation === desired.entity.generation,
		);
		const epoch = this.#entityCueEpoch;
		this.#pendingDynamicEntityCues.delete(guid);
		let tail = this.#dynamicCueInsertions.get(guid) ?? Promise.resolve();
		for (const cue of current) {
			// Handle failure immediately even when an earlier cue or installation is still pending.
			const preparation = (
				cue.kind === "script"
					? this.#prepareDynamicScriptCue(desired.scriptTableId, cue)
					: Promise.resolve(null)
			).catch((error: unknown) => {
				if (isHostCapacityFailure(error))
					console.warn(
						`Skipped script cue for ${formatGuidHex(guid)} because the host request queue is full.`,
						error,
					);
				else this.#context.pushPresentationFailure(error);
				return null;
			});
			const predecessors = Promise.allSettled([tail, ready]);
			tail = (async () => {
				const assets = await preparation;
				let transferred = false;
				try {
					const [predecessor, realization] = await predecessors;
					if (
						predecessor.status === "rejected" ||
						realization.status === "rejected"
					)
						return;
					// Appearance requests may change while the same playback owner survives.
					// Cold work binds to its own installation result, never a later GUID occupant.
					const expected =
						installed === undefined ? realization.value : installed;
					const target = this.#context.getInstalledPresentation(guid);
					if (
						expected === null ||
						epoch !== this.#entityCueEpoch ||
						target === undefined ||
						target.generation !== cue.generation ||
						target !== expected ||
						!this.#isEntityCueTimely(cue)
					)
						return;
					if (cue.kind === "script") {
						if (assets !== null)
							transferred = this.#appendDynamicScriptCue(target, assets);
						return;
					}
					// Retail behavior: explicit packet volume replaces stdata.volume_;
					// selection and probability still come from the sound table. Liveness also
					// gates cold-buffer replay.
					const outcome = this.#context.playSoundTableKey(
						{
							targetId: behaviorTargetId(target.nodeId),
							generation: target.behaviorGeneration,
						},
						cue.soundId,
						{
							volume: cue.volume,
							canReplay: () =>
								epoch === this.#entityCueEpoch &&
								this.#context.getInstalledPresentation(guid) === target &&
								this.#context.isAudioListenerEnabled() &&
								this.#isEntityCueTimely(cue),
						},
					);
					if (outcome === "unprepared") this.#unpreparedServerSoundCount += 1;
				} finally {
					if (assets !== null && !transferred) releaseCueAssets(assets);
				}
			})().catch((error: unknown) => {
				this.#context.pushPresentationFailure(error);
			});
		}
		this.#dynamicCueInsertions.set(guid, tail);
		// Clearing/replacing an insertion chain must not lose ownership of unfinished assets.
		this.#context.trackRealizationContinuation(tail);
		void tail.finally(() => {
			if (this.#dynamicCueInsertions.get(guid) !== tail) return;
			this.#dynamicCueInsertions.delete(guid);
			this.#drainDynamicEntityCues(guid);
		});
	}

	/** Stage an immutable effect closure without needing a live target. */
	async #prepareDynamicScriptCue(
		tableId: DatAssetId | null,
		cue: DynamicEntityScriptCue,
	): Promise<DynamicCueAssets | null> {
		if (tableId === null) return null;
		const tableHandle =
			await this.#physicsScriptTables.acquireOptional(tableId);
		if (tableHandle === null) return null;
		let rootId: DatAssetId | null;
		try {
			rootId = selectPhysicsScript(tableHandle.asset, cue.cue, cue.intensity);
		} finally {
			tableHandle.release();
		}
		if (rootId === null) return null;
		return this.#prepareDirectDynamicScript(rootId);
	}

	/** Shared closure preparation for table cues and explicit local racial scripts. */
	async #prepareDirectDynamicScript(
		rootId: DatAssetId,
	): Promise<DynamicCueAssets | null> {
		const closure = await this.#physicsScripts.acquireOptionalClosure(rootId);
		if (closure === null) return null;
		const emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[] = [];
		try {
			const emitterIds = new Set(
				[...closure.scripts.values()].flatMap(
					(script) => script.dependencies.emitterInfoIds,
				),
			);
			const available =
				await this.#particleEmitters.acquireAvailable(emitterIds);
			emitterHandles.push(
				...[...available.values()].flatMap((handle) =>
					handle === null ? [] : [handle],
				),
			);
			if ([...available.values()].some((handle) => handle === null)) {
				releaseCueAssets({ closure, emitterHandles });
				return null;
			}
			await this.#stageParticleMeshes(
				emitterHandles.map((handle) => handle.asset),
			);
			if (!this.#scriptMeshesReady(closure)) {
				releaseCueAssets({ closure, emitterHandles });
				return null;
			}
			return { closure, emitterHandles };
		} catch (cause) {
			releaseCueAssets({ closure, emitterHandles });
			throw cause;
		}
	}

	/** Transfer a prepared cue to its installed owner only when execution reaches its turn. */
	#appendDynamicScriptCue(
		current: CueInstalledEntityInfo,
		assets: DynamicCueAssets,
	): boolean {
		// RETAIL DIVERGENCE: retail appends immediately to the object's ScriptManager; the
		// browser appends only after its immutable script, emitter, and mesh closure is ready.
		// Backdating would lose or reorder time-zero effects unless we added a cross-process
		// recovery ledger. The archive census found 10,377 of 10,743 CreateParticle hooks at
		// time zero, so starting at readiness preserves the common effect while accepting
		// host/browser activation skew.
		if (
			!this.#worldOwnedPhysicsScriptSystem.appendRoot(
				current.ownerId,
				{
					generation: current.behaviorGeneration,
					targetId: behaviorTargetId(current.nodeId),
				},
				assets.closure,
				this.#context.clock(),
			)
		)
			return false;
		let owned = this.#dynamicCueAssets.get(current.ownerId);
		if (owned === undefined) {
			owned = [];
			this.#dynamicCueAssets.set(current.ownerId, owned);
		}
		owned.push(assets);
		return true;
	}

	/**
	 * Queue each intrinsic transition in the same receipt order as explicit packet cues.
	 *
	 * Retail behavior is to append both paths to one object-owned script queue. Preparation may
	 * finish out of order, but an earlier Hide must never run after a later UnHide. Preserve both
	 * transitions even before a model is installed: UnHide owns cleanup
	 * of the queued Hidden effect as well as restoration after an explicit packet Hide.
	 */
	#reconcileIntrinsicHiddenCue(record: CueDesiredEntityInfo): void {
		const entity = record.entity;
		const hidden = entity.physics.hidden;
		if (record.cueHidden === hidden) return;
		record.cueHidden = hidden;
		this.#queueDynamicEntityCue({
			kind: "script",
			guid: entity.identity.guid,
			generation: entity.generation,
			cue: hidden
				? RETAIL_HIDDEN_PHYSICS_SCRIPT_CUE
				: RETAIL_UNHIDE_PHYSICS_SCRIPT_CUE,
			intensity: INTRINSIC_STATE_CUE_INTENSITY,
		});
	}

	/** The single local racial closure and its playback retire with the behavior owner. */
	#releaseDynamicOverrideEffect(ownerId: DynamicOwnerId): void {
		const assets = this.#dynamicOverrideEffects.get(ownerId);
		if (assets === undefined) return;
		this.#physicsScriptSystem.removeOwner(ownerId);
		this.#dynamicOverrideEffects.delete(ownerId);
		releaseCueAssets(assets);
	}

	/** Cue asset leases belong to the retired behavior owner, not its successor's incarnation ID. */
	#releaseDynamicCueAssets(ownerId: DynamicOwnerId): void {
		for (const assets of this.#dynamicCueAssets.get(ownerId) ?? []) {
			releaseCueAssets(assets);
		}
		this.#dynamicCueAssets.delete(ownerId);
	}

	/** A parent snap also moves attached children and every emitter riding their parts. */
	#reanchorDynamicParticles(guid: number): void {
		const installed = this.#context.getInstalledPresentation(guid);
		if (installed !== undefined)
			this.#particles.reanchor({
				targetId: behaviorTargetId(installed.nodeId),
				generation: installed.behaviorGeneration,
			});
		for (const child of this.#context.getDesiredChildren(guid) ?? [])
			this.#reanchorDynamicParticles(child);
	}

	/** Apply each accepted track independently; the animation system owns clocks and visibility.
	 * Matching settled poses confirm a local hold, while absent tracks retire their ownership.
	 * Unplayable clips retain the previous track and are refused once per accepted description.
	 */
	#applyDynamicEntityMotion(
		installed: CueInstalledEntityInfo,
		motion: DynamicEntityMotion | null,
		entityClass: DynamicEntityView["presentation"]["entityClass"],
		placement: DynamicEntityView["placement"],
	): void {
		if (motion === null && installed.motionState === null) return;
		const ordinary = this.#resolveMotionLayer(
			installed,
			installed.motionState?.ordinary ?? null,
			motion?.ordinary ?? null,
		);
		const locomotion = this.#resolveMotionLayer(
			installed,
			installed.motionState?.locomotion ?? null,
			motion?.locomotion ?? null,
		);
		this.#animation.applyMotion(
			installed.ownerId,
			{
				generation: installed.behaviorGeneration,
				targetId: behaviorTargetId(installed.nodeId),
			},
			motion?.activity ?? "locomotion",
			ordinary.update,
			locomotion.update,
			this.#context.getDynamics().getPartToObjectTransforms(installed.nodeId),
			SHARED_FRONTEND_TUNING.animationPresentation.splitPlayerBody &&
				(motion?.locomotionCommandActive === true ||
					(placement.kind === "world" &&
						(placement.contact === "airborne" ||
							placement.contact === "sliding"))) &&
				entityClass === "player" &&
				installed.bodyLayout !== null
				? {
						kind: "humanoid-gesture",
						layout: installed.bodyLayout,
						chestLocomotionWeight:
							SHARED_FRONTEND_TUNING.animationPresentation
								.chestLocomotionWeight,
					}
				: { kind: "ordinary" },
		);
		installed.motionState =
			motion === null
				? null
				: { ordinary: ordinary.state, locomotion: locomotion.state };
	}

	/** Resolve each track independently so a hidden locomotion update cannot replace a gesture. */
	#resolveMotionLayer(
		installed: CueInstalledEntityInfo,
		current: DynamicEntityMotionState | null,
		next: DynamicEntityMotionLayer | null,
	): { state: DynamicEntityMotionState | null; update: AnimationLayerUpdate } {
		if (next === null) return { state: null, update: { kind: "remove" } };
		const update = classifyDynamicEntityMotionUpdate(current, next);
		if (update === "unchanged")
			return { state: current, update: { kind: "unchanged" } };
		if (update === "confirm")
			return {
				state: { level: next, playback: "installed" },
				update: { kind: "unchanged" },
			};
		const animation = this.#context
			.getDynamics()
			.getMotionClip(installed.nodeId, datAssetId(next.clip.animationId));
		if (animation === null)
			return {
				state: { level: next, playback: "unplayable" },
				update: { kind: "unchanged" },
			};
		const clip = playingClipForDynamicEntityMotion(animation, next.clip);
		return {
			state: { level: next, playback: "installed" },
			update:
				update === "retime"
					? { kind: "retime", framesPerSecond: clip.framesPerSecond }
					: { kind: "install", clip },
		};
	}

	/** Protect inspected models, their descendants and the ancestry positioning held objects. */
	#protectsAnimationPose(nodeId: SceneNodeId, guid: number | null): boolean {
		if (guid === null) return false;
		const installed = this.#context.getInstalledPresentation(guid);
		return (
			installed !== undefined &&
			(this.#context.scene.isSelfOrDescendant(installed.nodeId, nodeId) ||
				this.#context.scene.isSelfOrDescendant(nodeId, installed.nodeId))
		);
	}

	/** Read current placement rather than renderer feedback distance, so approaching roots resume now. */
	#animationSampleIntervalSeconds(
		nodeId: SceneNodeId,
		selected: boolean,
		ordinaryIntervalSeconds: number,
	): number {
		const policy = this.#distantAnimationSampling;
		if (policy === null) return ordinaryIntervalSeconds;
		const protectedGuids = this.#context.getProtectedEntityGuids();
		if (
			this.#protectsAnimationPose(nodeId, protectedGuids.viewer) ||
			this.#protectsAnimationPose(nodeId, protectedGuids.selected) ||
			this.#protectsAnimationPose(nodeId, protectedGuids.hovered)
		)
			return 0;
		if (!selected) return ordinaryIntervalSeconds;
		const resolved = this.#context.scene.readResolvedState(nodeId);
		if (resolved === undefined)
			throw new Error(`Animated scene node ${nodeId} does not exist.`);
		const { placement } = resolved;
		const origin = createLandblockWorldOrigin(
			placement.landblockId,
			this.#animationDistanceOrigin,
		);
		const matrix = placement.localToLandblock;
		const camera = this.#context.getCameraPosition();
		const x = origin.x + matrix.m41 - camera.x;
		const y = origin.y + matrix.m42 - camera.y;
		const z = origin.z + matrix.m43 - camera.z;
		return x * x + y * y + z * z >=
			policy.minimumDistance * policy.minimumDistance
			? policy.sampleIntervalSeconds
			: 0;
	}

	/** Snapshot the realized mesh center and physical membership once; never retain node/GPU identity. */
	#combatEffectPlacement(guid: number): CombatEffectPlacement {
		const nodeId = this.#context.getInstalledPresentation(guid)?.nodeId;
		if (nodeId === undefined) return { kind: "unplaced" };
		// Scene bounds include animation sweeps and particle reach; anchor to the current mesh instead.
		const bounds = this.#context
			.getDynamics()
			.getPublishedRigidPresentationBounds(nodeId);
		const placement = this.#context.scene.getResolvedPlacement(nodeId);
		const membership = this.#context.scene.getResolvedSpatialMembership(nodeId);
		if (bounds === null || placement === undefined || membership === undefined)
			return { kind: "unplaced" };
		const origin = createLandblockWorldOrigin(placement.landblockId);
		const center = transformPoint3(
			placement.localToLandblock,
			new Vec3(
				(bounds.min.x + bounds.max.x) * 0.5,
				(bounds.min.y + bounds.max.y) * 0.5,
				(bounds.min.z + bounds.max.z) * 0.5,
			),
		).add(origin);
		return {
			kind: "world",
			position: sceneVector3([center.x, center.y, center.z]),
			scopes: membership.scopes.map((scope) => ({ ...scope })),
		};
	}
}

/** Release a cue whose staging or entity ownership has ended. */
export function releaseCueAssets(assets: DynamicCueAssets): void {
	for (const handle of assets.emitterHandles) handle.release();
	assets.closure.release();
}

function formatGuidHex(guid: number): string {
	return `0x${(guid >>> 0).toString(16).padStart(8, "0")}`;
}

/** Validate and own cold policy input once, before frame-time consumers read it. */
function copyDistantAnimationSamplingPolicy(
	policy: DistantAnimationSamplingPolicy | null,
): DistantAnimationSamplingPolicy | null {
	if (policy === null) {
		return null;
	}
	if (!Number.isFinite(policy.minimumDistance) || policy.minimumDistance < 0) {
		throw new Error(
			"Distant animation distance must be finite and non-negative.",
		);
	}
	if (
		!Number.isFinite(policy.sampleIntervalSeconds) ||
		policy.sampleIntervalSeconds <= 0
	) {
		throw new Error("Distant animation interval must be finite and positive.");
	}
	return {
		minimumDistance: policy.minimumDistance,
		sampleIntervalSeconds: policy.sampleIntervalSeconds,
	};
}
