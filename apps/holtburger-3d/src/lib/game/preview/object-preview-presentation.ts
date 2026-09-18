import {
	resolvedFrameRotationFromRenderTransform,
	sceneVector3,
	writeRenderQuaternionFromRenderTransform,
	type MutableRenderQuaternion,
	type ResolvedFrameRotation,
	type SceneVector3,
} from "../../assets/ac-frame";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { dispatchAnimationHooks } from "../animation/animation-hook-dispatch";
import {
	BehaviorEventRouter,
	behaviorTargetId,
	type BehaviorConsumers,
	type BehaviorTarget,
	type BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type { PreparedPhysicsScriptClosure } from "../behavior/physics-script-repository";
import { multiplyMat4 } from "../math/matrices";
import { Mat4 } from "../math/types";
import type { ParticleDrawRange } from "../renderer/particle-render-routing";
import type { ParticleRecordFrame } from "../renderer/webgl2-particle-pass";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import { requireSceneNodeId } from "../scene/utils";
import type { PartRenderState } from "../systems/components";
import { EffectSystem } from "../systems/effect-system";
import { ParticleSystem } from "../systems/particle-system";
import { PhysicsScriptSystem } from "../systems/physics-script-system";
import type { PreparedObjectPreviewAssets } from "./object-preview-assets";
import { ObjectPreviewSequence } from "./object-preview-sequence";

const PREVIEW_OWNER = "object-preview-presentation";
const PREVIEW_GENERATION = 1;

type MutableParticleDrawRange = {
	-readonly [K in keyof ParticleDrawRange]: ParticleDrawRange[K];
};

type ObjectPreviewPresentationAssets = Pick<
	PreparedObjectPreviewAssets,
	| "clips"
	| "defaultScriptRoot"
	| "emitters"
	| "firstCyclicClip"
	| "scale"
	| "scripts"
	| "setupPose"
	| "translucency"
> & {
	readonly template: Pick<PreparedObjectPreviewAssets["template"], "parts">;
};

/** Borrowed synchronous render input; valid until the next advance or disposal. */
export interface ObjectPreviewFrame {
	readonly clockSeconds: number;
	readonly partToPreview: readonly Mat4[];
	readonly partRenderStates: readonly PartRenderState[];
	readonly particleRanges: readonly ParticleDrawRange[];
	readonly particleRecords: ParticleRecordFrame;
}

/** Private preview behavior, pose, effects and particles with no world-scene membership. */
export class ObjectPreviewPresentation {
	readonly #assets: ObjectPreviewPresentationAssets;
	readonly #effects = new EffectSystem();
	readonly #sequence: ObjectPreviewSequence;
	readonly #target: BehaviorTarget;
	readonly #partTargets = new Map<number, BehaviorTarget>();
	readonly #frames = new Map<BehaviorTargetId, Mat4>();
	readonly #particles: ParticleSystem;
	readonly #scripts: PhysicsScriptSystem<typeof PREVIEW_OWNER>;
	readonly #router: BehaviorEventRouter;
	readonly #partToPreview: Mat4[];
	readonly #particleRanges: MutableParticleDrawRange[] = [];
	#partRenderStates: readonly PartRenderState[];
	#clockSeconds = 0;
	#previousClockSeconds: number | null = null;
	#destroyed = false;

	constructor(
		assets: ObjectPreviewPresentationAssets,
		roll: () => number = Math.random,
	) {
		this.#assets = assets;
		this.#target = {
			generation: PREVIEW_GENERATION,
			targetId: behaviorTargetId("scene-node:0"),
		};
		for (const part of assets.template.parts) {
			this.#partTargets.set(part.partIndex, {
				generation: PREVIEW_GENERATION,
				targetId: behaviorTargetId(`scene-node:${part.partIndex + 1}`),
			});
		}
		this.#sequence = new ObjectPreviewSequence(
			assets.clips,
			assets.firstCyclicClip,
			assets.setupPose,
		);
		this.#effects.install(
			this.#rootNodeId(),
			assets.setupPose.length,
			assets.translucency,
		);
		const scriptWiring: {
			system?: PhysicsScriptSystem<typeof PREVIEW_OWNER>;
		} = {};
		const particleWiring: { system?: ParticleSystem } = {};
		const consumers: BehaviorConsumers = {
			audio: {
				playSound: () => "unprepared",
				playSoundTableKey: () => "unprepared",
			},
			effects: this.#effects,
			particles: {
				createEmitter: (target, command) => {
					const particles = particleWiring.system;
					if (!particles)
						throw new Error(
							"Preview particles received a command before wiring.",
						);
					return particles.createEmitter(target, command);
				},
				destroy: (target, emitterId) =>
					particleWiring.system?.destroy(target, emitterId),
				stop: (target, emitterId) =>
					particleWiring.system?.stop(target, emitterId),
			},
			scale: {
				applyScale: (target, values, mode) => {
					this.#effects.applyScale(target, values);
					return mode === "initial-state" ? "folded-initial-state" : "executed";
				},
			},
			scheduler: {
				scheduleActivation: (target, activation) => {
					const scripts = scriptWiring.system;
					if (!scripts)
						throw new Error(
							"Preview scripts received a command before wiring.",
						);
					scripts.scheduleActivation(target, activation);
				},
			},
			targets: { isLive: (target) => this.#targetLives(target) },
		};
		this.#router = new BehaviorEventRouter(
			consumers,
			SHARED_FRONTEND_TUNING.diagnostics.maximumRecentEffectObservations,
		);
		this.#scripts = new PhysicsScriptSystem(this.#router, roll);
		scriptWiring.system = this.#scripts;
		this.#particles = new ParticleSystem({
			clock: () => this.#clockSeconds,
			distanceSpacingMultiplier:
				SHARED_FRONTEND_TUNING.particleDistanceSpacingMultiplier,
			partFrameOf: (target, partIndex) => this.#partFrameOf(target, partIndex),
			resolveEmitter: (id) => assets.emitters.get(id) ?? null,
			roll,
			sceneOriginOf: (target) => this.#originOf(target),
			sceneRotationOf: (target) => this.#rotationOf(target),
			targetLives: (target) => this.#targetLives(target),
			writeSceneRenderRotationOf: (target, output) =>
				this.#writeRotationOf(target, output),
		});
		particleWiring.system = this.#particles;
		this.#partToPreview = assets.setupPose.map(() => Mat4.identity());
		this.#partRenderStates = assets.setupPose.map(() => ({
			textureVelocity: [0, 0] as const,
			translucency: 0,
		}));
		this.#publishPose();
		if (assets.defaultScriptRoot !== null) {
			this.#scripts.install(
				PREVIEW_OWNER,
				this.#target,
				this.#borrowedScriptClosure(assets.defaultScriptRoot),
				0,
			);
		}
	}

	advance(clockSeconds: number): ObjectPreviewFrame {
		if (this.#destroyed)
			throw new Error("Cannot advance a disposed object preview presentation.");
		if (!Number.isFinite(clockSeconds) || clockSeconds < 0)
			throw new Error("Object preview clock must be finite and non-negative.");
		if (
			this.#previousClockSeconds !== null &&
			clockSeconds < this.#previousClockSeconds
		)
			throw new Error("Object preview clock moved backwards.");
		const elapsedSeconds =
			this.#previousClockSeconds === null
				? 0
				: clockSeconds - this.#previousClockSeconds;
		this.#previousClockSeconds = clockSeconds;
		this.#clockSeconds = clockSeconds;

		this.#effects.advance(clockSeconds);
		this.#scripts.advance(clockSeconds);
		this.#particles.advance(clockSeconds);
		this.#sequence.advance(elapsedSeconds, ({ clip, departedFrames }) =>
			dispatchAnimationHooks(
				this.#router,
				this.#target,
				clip,
				departedFrames,
				"live",
			),
		);
		this.#publishPose();
		this.#collectParticleRanges();
		return {
			clockSeconds,
			particleRanges: this.#particleRanges,
			particleRecords: {
				data: this.#particles.recordData,
				dirtySlots: this.#particles.takeDirtyRecordSlots(),
			},
			partRenderStates: this.#partRenderStates,
			partToPreview: this.#partToPreview,
		};
	}

	dispose(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#scripts.removeOwner(PREVIEW_OWNER);
		this.#scripts.destroy();
		this.#particles.destroy(this.#target, 0);
		this.#effects.remove(this.#rootNodeId());
		this.#frames.clear();
		this.#partTargets.clear();
		this.#particleRanges.length = 0;
	}

	#publishPose(): void {
		const pose = this.#sequence.samplePose();
		const effects = this.#effects.samplePresentation(this.#rootNodeId());
		this.#partRenderStates = effects.partRenderStates;
		const authoredRoot = this.#sequence.sampleAuthoredRoot();
		const visualRoot =
			authoredRoot === null
				? effects.rootTransformModifier
				: multiplyMat4(authoredRoot, effects.rootTransformModifier);
		this.#frames.set(this.#target.targetId, visualRoot);
		for (const part of this.#assets.template.parts) {
			const transform = pose[part.partIndex];
			const target = this.#partTargets.get(part.partIndex);
			if (!transform || !target)
				throw new Error(
					`Preview pose has no complete frame for part ${part.partIndex}.`,
				);
			const local = composeObjectPartTransform(
				transform,
				this.#assets.scale,
				part.defaultScale,
			);
			const complete = multiplyMat4(visualRoot, local);
			this.#partToPreview[part.partIndex] = complete;
			this.#frames.set(target.targetId, complete);
		}
	}

	#collectParticleRanges(): void {
		const sources = this.#particles.collectDrawRanges();
		this.#particleRanges.length = sources.length;
		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			if (!source) throw new Error("Preview particle source disappeared.");
			const range = (this.#particleRanges[index] ??= {
				baseSlot: 0,
				count: 0,
				frame: { kind: "record" },
				hwGfxObjId: source.hwGfxObjId,
				motionType: source.motionType,
			});
			range.baseSlot = source.baseSlot;
			range.count = source.count;
			range.frame = source.frame;
			range.hwGfxObjId = source.hwGfxObjId;
			range.motionType = source.motionType;
		}
	}

	#borrowedScriptClosure(
		rootId: PreparedPhysicsScriptClosure["rootId"],
	): PreparedPhysicsScriptClosure {
		return {
			release: () => {},
			rootId,
			scripts: this.#assets.scripts,
		};
	}

	#rootNodeId() {
		return requireSceneNodeId(
			this.#target.targetId,
			"ObjectPreviewPresentation",
		);
	}

	#targetLives(target: BehaviorTarget): boolean {
		return (
			!this.#destroyed &&
			target.generation === PREVIEW_GENERATION &&
			this.#frames.has(target.targetId)
		);
	}

	#partFrameOf(
		target: BehaviorTarget,
		partIndex: number,
	): BehaviorTarget | null {
		return this.#targetLives(target)
			? (this.#partTargets.get(partIndex) ?? null)
			: null;
	}

	#originOf(target: BehaviorTarget): SceneVector3 | null {
		const frame = this.#frames.get(target.targetId);
		return frame ? sceneVector3([frame.m41, frame.m42, frame.m43]) : null;
	}

	#rotationOf(target: BehaviorTarget): ResolvedFrameRotation | null {
		const frame = this.#frames.get(target.targetId);
		return frame ? resolvedFrameRotationFromRenderTransform(frame) : null;
	}

	#writeRotationOf(
		target: BehaviorTarget,
		output: MutableRenderQuaternion,
	): boolean {
		const frame = this.#frames.get(target.targetId);
		if (!frame) return false;
		writeRenderQuaternionFromRenderTransform(frame, output);
		return true;
	}
}
