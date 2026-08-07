import type {
	AcVector3,
	RenderVector3,
	SceneVector3,
} from "../../assets/ac-frame";
import { acVector3, renderVector3, sceneVector3 } from "../../assets/ac-frame";
import type { PreparedParticleEmitter } from "../behavior/particle-emitter-repository";
import type { ParticleInstanceRecord } from "../renderer/particle-instance-stream";
import type { DatAssetId } from "../game-types";
import type { BehaviorTarget } from "../behavior/behavior-event-router";
import type { SceneNodeId } from "../scene";
import {
	particleLifeProgress,
	particlePosition,
	particleScale,
	particleTranslucency,
	type ParticleSpawnConstants,
	type Vector3,
} from "../behavior/particle-motion";

/** Uniform [0, 1) source; injected so emission randomness is explicit and tests are exact. */
export type UniformRoll = () => number;

/** Everything the runtime needs from the rest of the app, injected once at construction. */
export interface ParticleSystemDependencies {
	readonly roll: UniformRoll;
	/** Resolve an authored emitter DID to its staged definition, or `null` if none is staged. */
	readonly resolveEmitter: (
		emitterInfoId: DatAssetId,
	) => PreparedParticleEmitter | null;
	/**
	 * Current origin of a target in the fixed scene frame, or `null` once it stops publishing one.
	 *
	 * Scene frame rather than anchor-relative because particle origins are retained across frames.
	 */
	readonly sceneOriginOf: (target: BehaviorTarget) => SceneVector3 | null;
	/**
	 * Scene-frame origin of the current render anchor, subtracted to reach anchor-relative space.
	 *
	 * Exposed as the anchor rather than as a conversion function so the subtraction can be hoisted
	 * out of the per-particle loop and written into pooled storage.
	 */
	readonly renderAnchorOrigin: () => SceneVector3;
	/** Current runtime clock, needed because commands arrive mid-dispatch. */
	readonly clock: () => number;
}

/** A pooled record the system fills in place; consumers still see the readonly contract. */
type MutableParticleInstanceRecord = {
	-readonly [K in keyof ParticleInstanceRecord]: ParticleInstanceRecord[K];
} & { origin: [number, number, number] & RenderVector3 };

function blankRecord(): MutableParticleInstanceRecord {
	return {
		a: acVector3([0, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthTime: 0,
		c: acVector3([0, 0, 0]),
		finalScale: 0,
		finalTranslucency: 0,
		lifespan: 0,
		offset: acVector3([0, 0, 0]),
		origin: renderVector3([0, 0, 0]) as [number, number, number] &
			RenderVector3,
		startScale: 0,
		startTranslucency: 0,
	};
}

/** Translate a scene-frame origin by a frame-invariant displacement. */
function offsetOrigin(
	origin: SceneVector3,
	displacement: Vector3,
): SceneVector3 {
	return sceneVector3([
		origin[0] + displacement[0],
		origin[1] + displacement[1],
		origin[2] + displacement[2],
	]);
}

/**
 * Origin every particle of a following emitter shares this frame.
 *
 * Constant per emitter per frame, so it resolves once outside the per-particle loop. Frozen
 * particles already carry the hook offset from spawn; this applies it for the following case, so
 * neither kind can lose it.
 */
function followingOrigin(
	instance: EmitterInstance,
	liveOrigin: SceneVector3,
): SceneVector3 {
	return offsetOrigin(liveOrigin, instance.hookOffset);
}

/**
 * Resolve where one particle's motion formula originates, in the fixed scene frame.
 *
 * Total by construction, and the only place the follow/leave distinction is read.
 */
function resolveSceneOrigin(
	particle: LiveParticle,
	followingOriginForFrame: SceneVector3,
): SceneVector3 {
	return particle.frozenOrigin ?? followingOriginForFrame;
}

/** Retail's roll shape: `RollDice(-1, 1) * rand + base` — additive, never multiplicative. */
function rolled(roll: UniformRoll, base: number, rand: number): number {
	return base + (roll() * 2 - 1) * rand;
}

/** One live particle: spawn constants plus a birth time, and nothing else. */
interface LiveParticle {
	readonly birthTime: number;
	readonly spawn: ParticleSpawnConstants;
	/**
	 * Spawn origin frozen in the fixed scene frame, for an emitter that leaves particles behind.
	 *
	 * `null` when the emitter follows its parent (`is_parent_local != 0`,
	 * acclient.c:318262-318273), which is genuine absence rather than a branch: the origin is then
	 * resolved live instead. {@link ParticleSystem.resolveSceneOrigin} owns that choice so no
	 * consumer re-derives it.
	 */
	readonly frozenOrigin: SceneVector3 | null;
}

interface EmitterInstance {
	readonly emitter: PreparedParticleEmitter;
	readonly target: BehaviorTarget;
	/** Authored id: nonzero replaces any same-id emitter on the same target. */
	readonly emitterId: number;
	/** Spawn offset authored by the `CreateParticle` hook, added to the parent origin. */
	readonly hookOffset: Vector3;
	readonly startTime: number;
	lastEmissionTime: number | null;
	emittedCount: number;
	/** Stopped emitters release no further particles but let live ones finish their lifespans. */
	stopped: boolean;
	/**
	 * When this emitter became hidden, or `null` while it is visible.
	 *
	 * Hidden emitters are not ticked at all. Retail instead ticks them every frame purely for
	 * bookkeeping (acclient.c:318219-318252); closed-form state lets us replace that with one
	 * reconciliation at the visibility transition, so a hidden emitter costs nothing per frame.
	 */
	hiddenSince: number | null;
	particles: LiveParticle[];
}

/** One draw batch: a mesh, its motion law, and every particle sharing both. */
export interface ParticleDrawCohort {
	readonly hwGfxObjId: DatAssetId;
	/** Bound as a vertex-stage constant, so cohorts never mix motion laws. */
	readonly motionType: number;
	readonly particles: ParticleInstanceRecord[];
}

/** One particle ready to draw, in world space. */
export interface ParticleSample {
	readonly position: Vector3;
	readonly scale: number;
	readonly translucency: number;
}

export interface ParticleSystemDiagnostics {
	readonly emitterCount: number;
	readonly particleCount: number;
	readonly emittedTotal: number;
	readonly reapedEmitterCount: number;
}

/**
 * Owns live emitters and particles for authored `CreateParticle` events.
 *
 * Deliberately app-local and separate from `DynamicEntitySystem`: emitters follow entity transforms
 * but are not entities, and their particles outlive nothing but their own lifespans. Mutable state
 * is spawn constants plus birth times, because motion is closed form — this runtime schedules and
 * reaps, it does not integrate.
 */
export class ParticleSystem {
	readonly #dependencies: ParticleSystemDependencies;
	readonly #roll: UniformRoll;
	readonly #instances: EmitterInstance[] = [];
	/** Reused across frames so cohort grouping does not allocate in the renderer's hot path. */
	readonly #cohortScratch = new Map<string, ParticleDrawCohort>();
	readonly #cohortScratchOutput: ParticleDrawCohort[] = [];
	/**
	 * Reused instance records, one entry per particle drawn, each owning its origin vector.
	 *
	 * `collectCohorts` runs every frame over every live particle, so allocating a record and a
	 * vector per particle would be pure GC churn in the renderer's hot path — and churn is worse
	 * than its cost suggests, because it accumulates into collection pauses that are hard to
	 * attribute back to the code that caused them. Records are handed out by index and are valid
	 * only until the next call, which is exactly the lifetime of the cohorts that reference them.
	 */
	readonly #recordPool: MutableParticleInstanceRecord[] = [];
	#recordsUsed = 0;
	#emittedTotal = 0;
	#reapedEmitterCount = 0;

	constructor(dependencies: ParticleSystemDependencies) {
		this.#dependencies = dependencies;
		this.#roll = dependencies.roll;
	}

	/**
	 * The router's particle port.
	 *
	 * Reports `unprepared` rather than throwing when the emitter is not staged: a missing emitter is
	 * a staging gap the router records with provenance, not a runtime fault worth killing a frame
	 * over.
	 */
	createEmitter(
		target: BehaviorTarget,
		command: {
			readonly emitterInfoId: DatAssetId;
			readonly offsetOrigin: RenderVector3;
			readonly emitterId: number;
		},
	): "created" | "unprepared" {
		const emitter = this.#dependencies.resolveEmitter(command.emitterInfoId);
		if (emitter === null) return "unprepared";
		const parentOrigin = this.#dependencies.sceneOriginOf(target);
		if (parentOrigin === null) return "unprepared";
		this.create(
			target,
			emitter,
			// Already render-space: the decode layer converted it out of AC axes.
			command.offsetOrigin,
			command.emitterId,
			this.#dependencies.clock(),
			parentOrigin,
		);
		return "created";
	}

	/**
	 * Create one emitter, replacing any live emitter sharing its nonzero authored id.
	 *
	 * `emitterId === 0` requests an auto-assigned identity, so those never replace each other
	 * (acclient.c:316606-316730).
	 */
	create(
		target: BehaviorTarget,
		emitter: PreparedParticleEmitter,
		hookOffset: Vector3,
		emitterId: number,
		timeSeconds: number,
		parentOrigin: SceneVector3,
	): void {
		if (emitterId !== 0) {
			const existing = this.#instances.findIndex(
				(instance) =>
					instance.emitterId === emitterId &&
					instance.target.nodeId === target.nodeId,
			);
			if (existing >= 0) this.#instances.splice(existing, 1);
		}
		const instance: EmitterInstance = {
			emittedCount: 0,
			emitter,
			emitterId,
			hookOffset,
			hiddenSince: null,
			lastEmissionTime: null,
			particles: [],
			startTime: timeSeconds,
			stopped: false,
			target,
		};
		this.#instances.push(instance);
		// Retail releases `initial_particles` immediately at Init, before any interval applies.
		for (let index = 0; index < emitter.info.initialParticles; index += 1) {
			this.#emit(instance, timeSeconds, parentOrigin);
		}
	}

	/** Halt emission while live particles finish, then let the emitter reap itself. */
	stop(target: BehaviorTarget, emitterId: number): void {
		for (const instance of this.#instances) {
			if (
				instance.target.nodeId === target.nodeId &&
				(emitterId === 0 || instance.emitterId === emitterId)
			) {
				instance.stopped = true;
			}
		}
	}

	/** Remove emitters and their live particles at once, as retail's `Destroy` does. */
	destroy(target: BehaviorTarget, emitterId: number): void {
		for (let index = this.#instances.length - 1; index >= 0; index -= 1) {
			const instance = this.#instances[index]!;
			if (
				instance.target.nodeId === target.nodeId &&
				(emitterId === 0 || instance.emitterId === emitterId)
			) {
				this.#instances.splice(index, 1);
			}
		}
	}

	/** Owner removal vanishes live particles instantly; retail never drains them. */
	removeTarget(nodeId: BehaviorTarget["nodeId"]): void {
		for (let index = this.#instances.length - 1; index >= 0; index -= 1) {
			if (this.#instances[index]!.target.nodeId === nodeId)
				this.#instances.splice(index, 1);
		}
	}

	/**
	 * Advance every emitter to `timeSeconds`.
	 *
	 * Origins come from the injected `sceneOriginOf`, so this runtime follows published entity
	 * transforms without holding a reference to the entity itself.
	 */
	advance(
		timeSeconds: number,
		isVisible: (target: BehaviorTarget) => boolean = () => true,
	): void {
		for (let index = this.#instances.length - 1; index >= 0; index -= 1) {
			const instance = this.#instances[index]!;
			const parentOrigin = this.#dependencies.sceneOriginOf(instance.target);
			// A target that no longer publishes a transform has gone away underneath us.
			if (parentOrigin === null) {
				this.#instances.splice(index, 1);
				continue;
			}
			if (!isVisible(instance.target)) {
				// Record the suspension start once, then do no work at all until it ends.
				instance.hiddenSince ??= timeSeconds;
				continue;
			}
			if (instance.hiddenSince !== null) {
				this.#reconcileVisible(instance, timeSeconds);
				instance.hiddenSince = null;
			}
			this.#reapExpired(instance, timeSeconds);
			this.#applyAutoStop(instance, timeSeconds);
			if (!instance.stopped) this.#emitDue(instance, timeSeconds, parentOrigin);
			// A stopped emitter with nothing left alive has finished its whole job.
			if (instance.stopped && instance.particles.length === 0) {
				this.#instances.splice(index, 1);
				this.#reapedEmitterCount += 1;
			}
		}
	}

	/**
	 * Group live particles into draw cohorts, one per unique mesh and motion type.
	 *
	 * Cohorts carry the facts the vertex stage binds as constants — mesh, motion type — and the
	 * per-particle spawn records it reads as instance attributes. No position is evaluated here:
	 * that is the shader's job, and doing it twice is the CPU ceiling this design exists to avoid.
	 *
	 * `isVisible` culls at emitter granularity, never per particle, so a culled emitter contributes
	 * no instance records at all that frame.
	 *
	 * The returned cohorts, their record arrays, and the `origin` vectors inside them are all reused
	 * storage owned by this system. They are valid until the next call and must be consumed, not
	 * retained — which matches the one consumer, the particle pass, uploading them the same frame.
	 */
	collectCohorts(
		isVisible: (target: BehaviorTarget) => boolean = () => true,
	): ParticleDrawCohort[] {
		// Cohort objects and their arrays persist across frames; only the per-particle records are
		// rebuilt. Reusing those too is recorded as measured debt rather than guessed at.
		const cohorts = this.#cohortScratch;
		for (const cohort of cohorts.values()) cohort.particles.length = 0;
		// The anchor is one value for the whole frame, so it is read once rather than per particle.
		const anchor = this.#dependencies.renderAnchorOrigin();
		this.#recordsUsed = 0;
		for (const instance of this.#instances) {
			const info = instance.emitter.info;
			// An unshipped motion type has no formula in either evaluator; drawing it motionless
			// would misrepresent it as working.
			if (info.motionType === null) continue;
			if (!isVisible(instance.target)) continue;
			const liveOrigin = this.#dependencies.sceneOriginOf(instance.target);
			if (liveOrigin === null) continue;
			const following = followingOrigin(instance, liveOrigin);
			const key = `${info.hwGfxObjId}:${info.motionType}`;
			let cohort = cohorts.get(key);
			if (!cohort) {
				cohort = {
					hwGfxObjId: info.hwGfxObjId,
					motionType: info.motionType,
					particles: [],
				};
				cohorts.set(key, cohort);
			}
			for (const particle of instance.particles) {
				const record = this.#pooledRecord();
				const sceneOrigin = resolveSceneOrigin(particle, following);
				// Motion constants are shared with the spawn record rather than copied; only the
				// anchored origin is per-frame, and it is written into the record's own vector.
				record.a = particle.spawn.a;
				record.b = particle.spawn.b;
				record.birthTime = particle.birthTime;
				record.c = particle.spawn.c;
				record.finalScale = particle.spawn.finalScale;
				record.finalTranslucency = particle.spawn.finalTranslucency;
				record.lifespan = particle.spawn.lifespan;
				record.offset = particle.spawn.offset;
				record.origin[0] = sceneOrigin[0] - anchor[0];
				record.origin[1] = sceneOrigin[1] - anchor[1];
				record.origin[2] = sceneOrigin[2] - anchor[2];
				record.startScale = particle.spawn.startScale;
				record.startTranslucency = particle.spawn.startTranslucency;
				cohort.particles.push(record);
			}
		}
		this.#cohortScratchOutput.length = 0;
		for (const cohort of cohorts.values()) {
			if (cohort.particles.length > 0) this.#cohortScratchOutput.push(cohort);
		}
		return this.#cohortScratchOutput;
	}

	/**
	 * Evaluate every live particle on the CPU, in world space.
	 *
	 * Retained deliberately as the **reference** for the GPU vertex stage rather than as a draw
	 * path: the shader implements the same formulas, and this is what its output is checked
	 * against. Production drawing goes through {@link collectCohorts}.
	 */
	sample(timeSeconds: number): ParticleSample[] {
		const samples: ParticleSample[] = [];
		const anchor = this.#dependencies.renderAnchorOrigin();
		for (const instance of this.#instances) {
			const liveOrigin = this.#dependencies.sceneOriginOf(instance.target);
			if (liveOrigin === null) continue;
			const motionType = instance.emitter.info.motionType;
			if (motionType === null) continue;
			const following = followingOrigin(instance, liveOrigin);
			for (const particle of instance.particles) {
				const sceneOrigin = resolveSceneOrigin(particle, following);
				// The reference evaluator is not a draw path, so it may allocate.
				const origin = renderVector3([
					sceneOrigin[0] - anchor[0],
					sceneOrigin[1] - anchor[1],
					sceneOrigin[2] - anchor[2],
				]);
				const elapsed = timeSeconds - particle.birthTime;
				const position = particlePosition(
					motionType,
					particle.spawn,
					origin,
					elapsed,
				);
				if (position === null) continue;
				samples.push({
					position,
					scale: particleScale(particle.spawn, elapsed),
					translucency: particleTranslucency(particle.spawn, elapsed),
				});
			}
		}
		return samples;
	}

	/**
	 * Conservative radius, around the target's origin, containing every particle it currently emits.
	 *
	 * Returns `0` for a target with no live emitters, so a caller can add it to presentation bounds
	 * unconditionally. This is what lets emitters ride the existing visibility path instead of
	 * needing a parallel culling system: an owner's bounds simply grow to cover what it emits.
	 *
	 * Deliberately per-emitter, never per-particle. GPU evaluation means the CPU does not know
	 * individual particle positions, and re-deriving them to cull would reintroduce exactly the
	 * per-particle CPU ceiling this design exists to avoid.
	 */
	envelopeRadiusFor(nodeId: SceneNodeId): number {
		let radius = 0;
		for (const instance of this.#instances) {
			if (instance.target.nodeId !== nodeId) continue;
			// The hook offset displaces the whole emitter, so it extends the owner's bound too.
			const offsetLength = Math.hypot(...instance.hookOffset);
			radius = Math.max(radius, offsetLength + instance.emitter.envelopeRadius);
		}
		return radius;
	}

	getDiagnostics(): ParticleSystemDiagnostics {
		return {
			emittedTotal: this.#emittedTotal,
			emitterCount: this.#instances.length,
			particleCount: this.#instances.reduce(
				(total, instance) => total + instance.particles.length,
				0,
			),
			reapedEmitterCount: this.#reapedEmitterCount,
		};
	}

	/**
	 * Account for a hidden interval in one step, when the emitter becomes visible again.
	 *
	 * Retail's own off-screen policy splits the same way (acclient.c:305645-305662, 318189-318306):
	 * a **persistent** emitter freezes its particle ages so nothing expires unseen, and a **finite**
	 * emitter keeps advancing its bookkeeping so a burst still completes off-screen. We reproduce
	 * both, but compute them once from the suspension duration instead of ticking every frame.
	 */
	#reconcileVisible(instance: EmitterInstance, timeSeconds: number): void {
		const hiddenSeconds = timeSeconds - (instance.hiddenSince ?? timeSeconds);
		if (hiddenSeconds <= 0) return;
		if (instance.emitter.info.isPersistent) {
			// Shifting every birth time forward by the suspension is exactly an age freeze, and it
			// keeps the emission clock in step so the next particle is not immediately overdue.
			instance.particles = instance.particles.map((particle) => ({
				...particle,
				birthTime: particle.birthTime + hiddenSeconds,
			}));
			if (instance.lastEmissionTime !== null)
				instance.lastEmissionTime += hiddenSeconds;
			return;
		}
		// A finite emitter's hidden emissions are analytic: elapsed / interval, capped by its
		// remaining budget. Retail would have released them one frame at a time.
		const info = instance.emitter.info;
		if (info.emitsPerSecond && info.birthrateSeconds > 0 && !instance.stopped) {
			const due = Math.floor(hiddenSeconds / info.birthrateSeconds);
			const remaining =
				info.totalParticles > 0
					? Math.max(0, info.totalParticles - instance.emittedCount)
					: due;
			instance.emittedCount += Math.min(due, remaining);
			if (due > 0) instance.lastEmissionTime = timeSeconds;
		}
	}

	/** Particles die only by lifespan; retail never kills them any other way. */
	#reapExpired(instance: EmitterInstance, timeSeconds: number): void {
		instance.particles = instance.particles.filter(
			(particle) =>
				particleLifeProgress(particle.spawn, timeSeconds - particle.birthTime) <
				1,
		);
	}

	/** A finite emitter stops once it exhausts its particle budget or its authored duration. */
	#applyAutoStop(instance: EmitterInstance, timeSeconds: number): void {
		const info = instance.emitter.info;
		if (info.isPersistent) return;
		if (info.totalParticles > 0 && instance.emittedCount >= info.totalParticles)
			instance.stopped = true;
		if (
			info.totalSeconds > 0 &&
			timeSeconds - instance.startTime >= info.totalSeconds
		) {
			instance.stopped = true;
		}
	}

	/**
	 * Release at most one particle, and only once the minimum interval has elapsed.
	 *
	 * RETAIL QUIRK: `birthrate` is a **minimum interval**, not a rate, and retail emits at most one particle per
	 * update with no catch-up (acclient.c:312447-312476, 318289). Reproduced deliberately: emitting
	 * a burst to "catch up" a slow frame would change authored density.
	 */
	#emitDue(
		instance: EmitterInstance,
		timeSeconds: number,
		parentOrigin: SceneVector3,
	): void {
		const info = instance.emitter.info;
		// The per-meter predicate is unrecovered from the decompile, so a purely per-meter emitter
		// must report rather than guess an emission cadence.
		if (!info.emitsPerSecond) return;
		if (instance.particles.length >= info.maxParticles) return;
		if (
			instance.lastEmissionTime !== null &&
			timeSeconds - instance.lastEmissionTime < info.birthrateSeconds
		) {
			return;
		}
		this.#emit(instance, timeSeconds, parentOrigin);
	}

	/** Hand out the next pooled record, growing the pool only as the peak particle count grows. */
	#pooledRecord(): MutableParticleInstanceRecord {
		const record = (this.#recordPool[this.#recordsUsed] ??= blankRecord());
		this.#recordsUsed += 1;
		return record;
	}

	#emit(
		instance: EmitterInstance,
		timeSeconds: number,
		parentOrigin: SceneVector3,
	): void {
		const info = instance.emitter.info;
		if (instance.particles.length >= info.maxParticles) return;
		const roll = this.#roll;
		instance.particles.push({
			birthTime: timeSeconds,
			// A following emitter resolves its origin live every frame, so freezing one here would
			// be a value nothing reads. The hook offset is applied by the shared resolution instead
			// of here, so both kinds of emitter get it.
			frozenOrigin: info.followsParent
				? null
				: offsetOrigin(parentOrigin, instance.hookOffset),
			spawn: {
				a: scaledVector(info.a, rolled(roll, info.minA, info.maxA - info.minA)),
				b: scaledVector(info.b, rolled(roll, info.minB, info.maxB - info.minB)),
				c: scaledVector(info.c, rolled(roll, info.minC, info.maxC - info.minC)),
				finalScale: info.finalScale,
				finalTranslucency: info.finalTrans,
				lifespan: Math.max(0, rolled(roll, info.lifespan, info.lifespanRand)),
				offset: this.#spawnOffset(
					info.offsetDir,
					info.minOffset,
					info.maxOffset,
				),
				startScale: info.startScale,
				startTranslucency: info.startTrans,
			},
		});
		instance.emittedCount += 1;
		this.#emittedTotal += 1;
		instance.lastEmissionTime = timeSeconds;
	}

	/**
	 * A random offset perpendicular to the authored `offset_dir`, scaled into [min, max].
	 *
	 * Retail builds a random unit vector and projects out the `offset_dir` component
	 * (acclient.c:312311-312603), so particles spread across the disc normal to that axis rather
	 * than along it. A degenerate roll that lands parallel to `offset_dir` falls back to no offset,
	 * which is the same particle retail would produce from a zero-length projection.
	 */
	#spawnOffset(
		offsetDir: AcVector3,
		minOffset: number,
		maxOffset: number,
	): AcVector3 {
		const roll = this.#roll;
		// An isotropic random direction has no space of its own, but it is projected against the
		// authored `offset_dir`, so it is generated in AC axes to match it.
		const random = acVector3([roll() * 2 - 1, roll() * 2 - 1, roll() * 2 - 1]);
		const dirLength = Math.hypot(...offsetDir);
		let perpendicular = random;
		if (dirLength > 0) {
			const unit = acVector3([
				offsetDir[0] / dirLength,
				offsetDir[1] / dirLength,
				offsetDir[2] / dirLength,
			]);
			const along =
				random[0] * unit[0] + random[1] * unit[1] + random[2] * unit[2];
			perpendicular = acVector3([
				random[0] - along * unit[0],
				random[1] - along * unit[1],
				random[2] - along * unit[2],
			]);
		}
		const length = Math.hypot(...perpendicular);
		if (length === 0) return acVector3([0, 0, 0]);
		const magnitude = minOffset + roll() * (maxOffset - minOffset);
		return scaledVector(perpendicular, magnitude / length);
	}
}

/** Scale an authored motion constant, which never leaves AC axes before evaluation. */
function scaledVector(vector: AcVector3, scale: number): AcVector3 {
	return acVector3([vector[0] * scale, vector[1] * scale, vector[2] * scale]);
}
