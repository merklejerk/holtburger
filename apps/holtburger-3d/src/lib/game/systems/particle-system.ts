import type {
	AcVector3,
	LandblockVector3,
	SceneVector3,
} from "../../assets/ac-frame";
import {
	acVector3,
	landblockVector3,
	renderVector3,
	rotateAcVector,
	sceneVector3,
} from "../../assets/ac-frame";
import type {
	MutableRenderQuaternion,
	RenderQuaternion,
	ResolvedFrameRotation,
} from "../../assets/ac-frame";
import type {
	DrawableParticleEmitter,
	PreparedParticleEmitter,
} from "../behavior/particle-emitter-repository";
import type { ParticleInstanceRecord } from "../renderer/particle-record-layout";
import type { DatAssetId } from "../game-types";
import type {
	BehaviorTarget,
	BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type { SceneNodeId } from "../scene";
import {
	ParticleRecordSlots,
	type ParticleSlotRegion,
} from "../behavior/particle-record-slots";
import { PARTICLE_RECORD_BIRTH_TIME_FLOAT } from "../renderer/particle-record-layout";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import {
	PARTICLE_TYPE,
	particlePosition,
	rotatedSpawnConstants,
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
	 *
	 * **Spawn-tier, not frame-tier.** Only emission and range collection read an origin; the
	 * per-frame emitter loop must not, because resolving one costs a walk up the scene hierarchy
	 * and this runs for every resident emitter whether or not it is drawn. Liveness questions go
	 * to {@link ParticleSystemDependencies.targetLives} instead.
	 */
	readonly sceneOriginOf: (target: BehaviorTarget) => SceneVector3 | null;
	/**
	 * Whether a target still exists, asked without resolving its transform.
	 *
	 * Exactly the condition under which {@link ParticleSystemDependencies.sceneOriginOf} yields a
	 * value: every registered target publishes an origin, so a live target always has one. The
	 * emitter loop asks this per frame and pays for an origin only when a particle actually spawns.
	 */
	readonly targetLives: (target: BehaviorTarget) => boolean;
	/**
	 * Current rotation of a target's frame in paired AC and render representations, or `null` once
	 * it stops publishing one.
	 *
	 * Resolved at spawn, mirroring retail's `start_frame` snapshot: AC rotation bakes the trajectory
	 * constants, while render rotation is retained for detached particle records. It must be the
	 * *live* frame rather than the authored one: a script that rotates its owner changes where its
	 * emitters fire, and an authored decode-time rotation would miss that.
	 */
	readonly sceneRotationOf: (
		target: BehaviorTarget,
	) => ResolvedFrameRotation | null;
	/**
	 * Write only a target's live render rotation for a parent-following draw range.
	 *
	 * This is the frame-tier counterpart to the spawn-tier composite resolver above. It writes into
	 * emitter-owned storage so following particles do not allocate or derive the unused AC
	 * trajectory representation every rendered frame.
	 */
	readonly writeSceneRenderRotationOf: (
		target: BehaviorTarget,
		output: MutableRenderQuaternion,
	) => boolean;
	/**
	 * Resolve the node whose frame positions a part-attached emitter, or `null` when the part is
	 * unknown.
	 *
	 * `CreateParticle` names a part index, and retail snapshots *that part's* frame rather than the
	 * object's (`Particle::Init`, acclient.c:317791). A whole-object emitter authors `-1`.
	 */
	readonly partFrameOf: (
		target: BehaviorTarget,
		partIndex: number,
	) => BehaviorTarget | null;
	/** Current runtime clock, needed because commands arrive mid-dispatch. */
	readonly clock: () => number;
}

/**
 * Shortest vector retail's `normalize_check_small` will normalize (acclient.c:137456); anything
 * shorter is zeroed instead of divided by.
 */
const MINIMUM_NORMALIZABLE_LENGTH = 0.00019999999;

/** `CreateParticle`'s sentinel for an emitter riding the object's own frame rather than a part. */
const WHOLE_OBJECT_PART_INDEX = -1;

/** A pooled range the system fills in place; consumers still see the readonly contract. */
type MutableParticleSourceRange = {
	-readonly [K in keyof ParticleSourceRange]: ParticleSourceRange[K];
};

const RECORD_PARTICLE_FRAME = { kind: "record" } as const;

/** Lifetime-owned mutable storage exposed downstream as one coherent live parent frame. */
class FollowingRangeFrame {
	readonly kind = "range";
	readonly #mutableLandblockOrigin: [number, number, number] = [0, 0, 0];
	readonly #mutableLocalOrigin: [number, number, number] = [0, 0, 0];
	readonly rotationOutput: MutableRenderQuaternion = {
		w: 1,
		x: 0,
		y: 0,
		z: 0,
	};
	readonly landblockOrigin = sceneVector3(this.#mutableLandblockOrigin);
	readonly localOrigin = landblockVector3(this.#mutableLocalOrigin);
	readonly rotation = this.rotationOutput as RenderQuaternion;

	updateOrigin(origin: SceneVector3): void {
		const landblockX = quantizeToLandblock(origin[0]);
		const landblockZ = quantizeToLandblock(origin[2]);
		this.#mutableLandblockOrigin[0] = landblockX;
		this.#mutableLandblockOrigin[1] = 0;
		this.#mutableLandblockOrigin[2] = landblockZ;
		this.#mutableLocalOrigin[0] = origin[0] - landblockX;
		this.#mutableLocalOrigin[1] = origin[1];
		this.#mutableLocalOrigin[2] = origin[2] - landblockZ;
	}
}

function blankRange(): MutableParticleSourceRange {
	return {
		baseSlot: 0,
		count: 0,
		hwGfxObjId: "" as DatAssetId,
		motionType: 0,
		frame: RECORD_PARTICLE_FRAME,
		renderOwner: EXTERIOR_PARTICLE_RENDER_OWNER,
	};
}

/** A pooled record the system fills in place; consumers still see the readonly contract. */
type MutableParticleInstanceRecord = {
	-readonly [K in keyof ParticleInstanceRecord]: ParticleInstanceRecord[K];
} & {
	landblockOrigin: [number, number, number] & SceneVector3;
	localOrigin: [number, number, number] & LandblockVector3;
};

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
		landblockOrigin: sceneVector3([0, 0, 0]) as [number, number, number] &
			SceneVector3,
		localOrigin: landblockVector3([0, 0, 0]) as [number, number, number] &
			LandblockVector3,
		rotation: { w: 1, x: 0, y: 0, z: 0 },
		startScale: 0,
		startTranslucency: 0,
	};
}

/**
 * Snap a scene coordinate down to its landblock's corner.
 *
 * Landblock origins are exact multiples of the landblock size and so is the render anchor, which is
 * what lets the vertex stage subtract one from the other without losing precision.
 */
function quantizeToLandblock(sceneCoordinate: number): number {
	return (
		Math.floor(sceneCoordinate / OUTDOOR_LANDBLOCK_WORLD_SIZE) *
		OUTDOOR_LANDBLOCK_WORLD_SIZE
	);
}

/** Sum two AC-axis displacements, which retail does before rotating the result. */
function addAcVectors(left: AcVector3, right: AcVector3): AcVector3 {
	return acVector3([
		left[0] + right[0],
		left[1] + right[1],
		left[2] + right[2],
	]);
}

/**
 * Resolve where one particle's motion formula originates, in the fixed scene frame.
 *
 * Total by construction, and the only place the follow/leave distinction is read.
 */
function resolveSceneOrigin(
	particle: LiveParticle,
	liveOrigin: SceneVector3,
): SceneVector3 {
	return particle.frozenOrigin ?? liveOrigin;
}

/** Sample retail's inclusive mathematical interval using the injected uniform roll. */
function sampleUniformRange(
	roll: UniformRoll,
	minimum: number,
	maximum: number,
): number {
	return minimum + roll() * (maximum - minimum);
}

/** Sample retail's additive `RollDice(-1, 1) * variance + base` distribution. */
function sampleSymmetricVariance(
	roll: UniformRoll,
	base: number,
	variance: number,
): number {
	return base + (roll() * 2 - 1) * variance;
}

/** Retail clamps both independently randomized scale endpoints to `[0.1, 10]`. */
function sampleScale(
	roll: UniformRoll,
	base: number,
	variance: number,
): number {
	return Math.min(
		10,
		Math.max(0.1, sampleSymmetricVariance(roll, base, variance)),
	);
}

/** Retail clamps both independently randomized translucency endpoints to `[0, 1]`. */
function sampleTranslucency(
	roll: UniformRoll,
	base: number,
	variance: number,
): number {
	return Math.min(
		1,
		Math.max(0, sampleSymmetricVariance(roll, base, variance)),
	);
}

/**
 * Owner-relative geometric extent of one emitter activation.
 *
 * RETAIL DIVERGENCE: retail uses only `max(max_offset, max_a * lifespan)` for its sorting sphere
 * (acclient.c:312431-312445). That omits acceleration, hook displacement, scale, and mesh geometry;
 * restoring it would cull whole emitters while their particles remain visible. The 2026-08-15 census
 * covered all 2,051 emitters and found 834 drawable definitions underbounded by the former
 * unit-mesh size term alone.
 */
function drawableEnvelopeRadius(
	emitter: DrawableParticleEmitter,
	hookOffset: AcVector3,
): number {
	return (
		Math.hypot(...hookOffset) +
		emitter.centerReach +
		emitter.mesh.radius * emitter.maximumScale
	);
}

/** One live particle: spawn constants plus the two stamps that bound its life, and nothing else. */
interface LiveParticle {
	/**
	 * Mutable because an off-screen suspension shifts it: freezing a hidden particle's age is
	 * exactly moving its birth forward by the hidden duration (see `#reconcileVisible`).
	 */
	birthTime: number;
	/**
	 * When this particle expires, fixed at spawn as `birthTime + lifespan` and shifted with
	 * `birthTime` by a suspension.
	 *
	 * Reaping is a comparison against this rather than a life-progress evaluation per particle per
	 * frame: `particleLifeProgress(spawn, t) < 1` is exactly `t < lifespan` for every lifespan the
	 * spawn path can produce, including the degenerate zero, so the closed form is equivalent and
	 * carries no division.
	 */
	deathTime: number;
	readonly spawn: ParticleSpawnConstants;
	/** Spawn-time mesh frame consumed by detached records; following ranges override it live. */
	readonly rotation: RenderQuaternion;
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
	readonly emitter: DrawableParticleEmitter;
	/** Frame source carried by this emitter's draw range and selected in the vertex stage. */
	readonly drawFrame: ParticleRangeFrame;
	/** Owner-relative conservative extent, computed once because no emitter property changes live. */
	readonly envelopeRadius: number;
	/**
	 * Owning entity: what this emitter's identity, visibility, and culling envelope belong to.
	 *
	 * Deliberately distinct from {@link frameTarget}. An emitter attached to a swinging lantern is
	 * *owned* by the lantern object — that is what culls it and what its envelope grows — while its
	 * particles are *positioned* by the moving part.
	 */
	readonly target: BehaviorTarget;
	/** Node whose frame positions and aims the particles; the owner itself for a whole-object emitter. */
	readonly frameTarget: BehaviorTarget;
	/** Authored id: nonzero replaces any same-id emitter on the same target. */
	readonly emitterId: number;
	/**
	 * Spawn offset authored by the `CreateParticle` hook, in AC's authored axes.
	 *
	 * Kept unconverted because retail adds it to the random spawn offset and rotates the *sum* by the
	 * owner's frame (acclient.c:317796). It is folded into each particle's own offset at spawn rather
	 * than applied to the emitter origin, so nothing downstream applies it a second time.
	 */
	readonly hookOffset: AcVector3;
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
	 * reconciliation at the visibility transition, so a hidden emitter pays only owner-liveness and
	 * visibility checks per frame, with no particle-level work.
	 */
	hiddenSince: number | null;
	/**
	 * Record slots reserved for this emitter's whole life.
	 *
	 * Sized at the authored `maxParticles`, which the emission path already enforces, so the region
	 * cannot overflow by construction. The corpus makes that cheap: the census puts `max_particles`
	 * at p50 15 and max 240 across all 2,051 authored emitters.
	 */
	readonly region: ParticleSlotRegion;
	particles: LiveParticle[];
	/**
	 * Earliest `deathTime` among this emitter's live particles, or `Infinity` when it has none.
	 *
	 * The reap scan is skipped entirely until the clock reaches this, which is the common frame:
	 * particles outlive many frames, so most frames have nothing to expire and should cost one
	 * comparison rather than a pass over the population.
	 */
	nextDeathTime: number;
}

/** Derived owner facts read by presentation culling without scanning the global emitter sequence. */
interface ParticleOwnerAggregate {
	/** Current emitters owned by this target, used to remove the aggregate exactly at zero. */
	emitterCount: number;
	/** Maximum conservative extent of those emitters, or absent with the aggregate itself. */
	envelopeRadius: number;
}

/** Every path that removes an emitter, kept explicit so lifetime diagnostics remain exhaustive. */
type EmitterRemovalReason = "destroyed" | "reaped" | "replaced" | "target-lost";

/** Exterior-owned effects are routed through the selected outdoor scope envelope. */
export const EXTERIOR_PARTICLE_RENDER_OWNER = "particle-render-owner:exterior";
export const SKY_PARTICLE_RENDER_OWNER = "particle-render-owner:sky";

/** Stable routing owner retained until the renderer assigns particles to this frame's domains. */
export type ParticleRenderOwner =
	| SceneNodeId
	| typeof EXTERIOR_PARTICLE_RENDER_OWNER
	| typeof SKY_PARTICLE_RENDER_OWNER;

/** Where a draw range obtains the position and rotation used by its particles. */
type ParticleRangeFrame =
	| {
			/** Detached particles retain their complete frame in each spawn record. */
			readonly kind: "record";
	  }
	| {
			/** Parent-following particles share this one live split-precision emitter origin. */
			readonly kind: "range";
			readonly landblockOrigin: SceneVector3;
			readonly localOrigin: LandblockVector3;
			readonly rotation: RenderQuaternion;
	  };

/** One emitter's slot range awaiting renderer-owned portal-domain routing. */
export interface ParticleSourceRange {
	/** Particle mesh shared by every instance in this range. */
	readonly hwGfxObjId: DatAssetId;
	/** Vertex-stage motion law shared by every instance in this range. */
	readonly motionType: number;
	/** Frozen record-local or one coherent live parent frame, selected once for the range. */
	readonly frame: ParticleRangeFrame;
	/** First record slot this range draws. */
	readonly baseSlot: number;
	/** Live particles in the range, drawn as instances from `baseSlot`. */
	readonly count: number;
	/** Owner whose visibility selected this range, for portal scope routing. */
	readonly renderOwner: ParticleRenderOwner;
}

/** One particle ready to draw, in world space. */
export interface ParticleSample {
	readonly position: Vector3;
	readonly scale: number;
	readonly translucency: number;
}

export interface ParticleSystemDiagnostics {
	/** Emitters created over this system's lifetime, including later replacements. */
	readonly createdEmitterTotal: number;
	/** Emitters removed immediately by an authored destroy command. */
	readonly destroyedEmitterTotal: number;
	readonly emitterCount: number;
	/** Emitters rejected by the latest advancement visibility decision. */
	readonly hiddenEmitterCount: number;
	/** Targets currently owning at least one emitter. */
	readonly emitterOwnerCount: number;
	readonly particleCount: number;
	readonly emittedTotal: number;
	/** Finite emitters reconciled analytically after a hidden interval. */
	readonly finiteHiddenReconciliationTotal: number;
	/** Following emitters retained by the latest draw-range collection. */
	readonly lastVisibleFollowingEmitterCount: number;
	/** Particles covered by those retained following-emitter ranges. */
	readonly lastVisibleFollowingParticleCount: number;
	/** Emitters admitted by the latest advancement visibility decision. */
	readonly visibleEmitterCount: number;
	/** Persistent emitters reconciled by shifting their clocks after a hidden interval. */
	readonly persistentHiddenReconciliationTotal: number;
	/** Emitters halted by an explicit stop command and left to drain. */
	readonly explicitlyStoppedEmitterTotal: number;
	/** Emitters removed because their target stopped publishing a transform. */
	readonly lostTargetEmitterTotal: number;
	/** Largest current emitter population owned by one target. */
	readonly maximumEmitterCountPerOwner: number;
	/** Emitters inspected while rebuilding a removed owner's cold-path maximum. */
	readonly ownerAggregateRepairEmitterInspectionTotal: number;
	/** Removals of a widest emitter that required rebuilding its surviving owner's maximum. */
	readonly ownerAggregateRepairTotal: number;
	readonly reapedEmitterCount: number;
	/** Record slots reserved by live emitter regions. */
	readonly reservedRecordSlotCount: number;
	/** Record slots the store holds, reserved or not. */
	readonly recordSlotCapacity: number;
	/** Emitters removed when a nonzero authored identity was recreated. */
	readonly replacedEmitterTotal: number;
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
	/** Authoritative global lifetime and render-order sequence. */
	readonly #instances: EmitterInstance[] = [];
	/** Derived culling aggregate maintained only at emitter lifetime mutation boundaries. */
	readonly #ownerAggregates = new Map<
		BehaviorTargetId,
		ParticleOwnerAggregate
	>();
	/** Reused across frames so range collection does not allocate in the renderer's hot path. */
	/** Persistent record storage; written at spawn and read by the GPU every frame after. */
	readonly #slots = new ParticleRecordSlots();
	/**
	 * Reused output for the visible draw ranges, rebuilt each frame from emitters alone.
	 *
	 * Pooled rather than rebuilt: one object per visible emitter per frame is exactly the churn the
	 * record pooling this replaced existed to avoid, and it would be invisible until it showed up
	 * as collection pauses.
	 */
	readonly #rangePool: MutableParticleSourceRange[] = [];
	readonly #rangeOutput: ParticleSourceRange[] = [];
	/** Reused record builder; a record is copied into slot storage, never retained by shape. */
	readonly #recordScratch: MutableParticleInstanceRecord = blankRecord();
	/** Lifetime creates, including an authored identity that replaces a predecessor. */
	#createdEmitterTotal = 0;
	/** Immediate authored destroy removals. */
	#destroyedEmitterTotal = 0;
	#emittedTotal = 0;
	#finiteHiddenReconciliationTotal = 0;
	#hiddenEmitterCount = 0;
	#lastVisibleFollowingEmitterCount = 0;
	#lastVisibleFollowingParticleCount = 0;
	#persistentHiddenReconciliationTotal = 0;
	#visibleEmitterCount = 0;
	/** First explicit stop transition per live emitter. */
	#explicitlyStoppedEmitterTotal = 0;
	/** Removals caused by loss of the target transform. */
	#lostTargetEmitterTotal = 0;
	/** Authoritative emitters inspected while repairing cold-path owner maxima. */
	#ownerAggregateRepairEmitterInspectionTotal = 0;
	/** Widest-emitter removals that required a surviving owner maximum repair. */
	#ownerAggregateRepairTotal = 0;
	#reapedEmitterCount = 0;
	/** Nonzero authored identity replacements. */
	#replacedEmitterTotal = 0;

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
			readonly offsetOrigin: AcVector3;
			readonly emitterId: number;
			/** Authored part this emitter rides, or `-1` for the whole object's own frame. */
			readonly partIndex: number;
		},
	): "created" | "intentionally-inert" | "unprepared" {
		const emitter = this.#dependencies.resolveEmitter(command.emitterInfoId);
		if (emitter === null) return "unprepared";
		if (emitter.kind === "retail-inert") return "intentionally-inert";
		// An emitter riding a part is positioned and aimed by that part, while remaining owned by the
		// object for identity, visibility, and culling.
		const frameTarget =
			command.partIndex === WHOLE_OBJECT_PART_INDEX
				? target
				: this.#dependencies.partFrameOf(target, command.partIndex);
		if (frameTarget === null) return "unprepared";
		const parentOrigin = this.#dependencies.sceneOriginOf(frameTarget);
		if (parentOrigin === null) return "unprepared";
		this.create(
			target,
			emitter,
			command.offsetOrigin,
			command.emitterId,
			this.#dependencies.clock(),
			parentOrigin,
			frameTarget,
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
		emitter: DrawableParticleEmitter,
		hookOffset: AcVector3,
		emitterId: number,
		timeSeconds: number,
		parentOrigin: SceneVector3,
		/** Node positioning the particles; defaults to the owner, which is the whole-object case. */
		frameTarget: BehaviorTarget = target,
	): void {
		if (emitterId !== 0) {
			const existing = this.#instances.findIndex(
				(instance) =>
					instance.emitterId === emitterId &&
					instance.target.targetId === target.targetId,
			);
			if (existing >= 0) this.#removeEmitter(existing, "replaced");
		}
		const envelopeRadius = drawableEnvelopeRadius(emitter, hookOffset);
		const instance: EmitterInstance = {
			drawFrame: emitter.info.followsParent
				? new FollowingRangeFrame()
				: RECORD_PARTICLE_FRAME,
			region: this.#slots.allocate(Math.max(1, emitter.info.maxParticles)),
			emittedCount: 0,
			emitter,
			emitterId,
			envelopeRadius,
			frameTarget,
			hookOffset,
			hiddenSince: null,
			lastEmissionTime: null,
			nextDeathTime: Number.POSITIVE_INFINITY,
			particles: [],
			startTime: timeSeconds,
			stopped: false,
			target,
		};
		this.#instances.push(instance);
		this.#createdEmitterTotal += 1;
		const owner = this.#ownerAggregates.get(target.targetId);
		if (owner) {
			owner.emitterCount += 1;
			owner.envelopeRadius = Math.max(owner.envelopeRadius, envelopeRadius);
		} else {
			this.#ownerAggregates.set(target.targetId, {
				emitterCount: 1,
				envelopeRadius,
			});
		}
		// Retail releases `initial_particles` immediately at Init, before any interval applies.
		for (let index = 0; index < emitter.info.initialParticles; index += 1) {
			this.#emit(instance, timeSeconds, parentOrigin);
		}
	}

	/** Halt emission while live particles finish, then let the emitter reap itself. */
	stop(target: BehaviorTarget, emitterId: number): void {
		for (const instance of this.#instances) {
			if (
				instance.target.targetId === target.targetId &&
				(emitterId === 0 || instance.emitterId === emitterId)
			) {
				if (!instance.stopped) this.#explicitlyStoppedEmitterTotal += 1;
				instance.stopped = true;
			}
		}
	}

	/** Remove emitters and their live particles at once, as retail's `Destroy` does. */
	destroy(target: BehaviorTarget, emitterId: number): void {
		for (let index = this.#instances.length - 1; index >= 0; index -= 1) {
			const instance = this.#instances[index]!;
			if (
				instance.target.targetId === target.targetId &&
				(emitterId === 0 || instance.emitterId === emitterId)
			) {
				this.#removeEmitter(index, "destroyed");
			}
		}
	}

	/**
	 * Advance every emitter to `timeSeconds`.
	 *
	 * Deliberately resolves no origins: emitters follow published transforms, but only a spawn
	 * needs to know where its owner *is*, and spawns are interval-gated while this loop runs for
	 * every resident emitter every frame. The loop asks only whether each target still exists;
	 * {@link ParticleSystem.#emitDue} resolves the origin once it knows a particle is due.
	 */
	advance(
		timeSeconds: number,
		isVisible: (target: BehaviorTarget) => boolean = () => true,
	): void {
		this.#hiddenEmitterCount = 0;
		this.#visibleEmitterCount = 0;
		for (let index = this.#instances.length - 1; index >= 0; index -= 1) {
			const instance = this.#instances[index]!;
			// A target that no longer exists has gone away underneath us.
			if (!this.#dependencies.targetLives(instance.frameTarget)) {
				this.#removeEmitter(index, "target-lost");
				continue;
			}
			if (!isVisible(instance.target)) {
				this.#hiddenEmitterCount += 1;
				// Record the suspension start once, then do no work at all until it ends.
				instance.hiddenSince ??= timeSeconds;
				continue;
			}
			this.#visibleEmitterCount += 1;
			if (instance.hiddenSince !== null) {
				this.#reconcileVisible(instance, timeSeconds);
				instance.hiddenSince = null;
			}
			this.#reapExpired(instance, timeSeconds);
			this.#applyAutoStop(instance, timeSeconds);
			if (!instance.stopped) this.#emitDue(instance, timeSeconds);
			// A stopped emitter with nothing left alive has finished its whole job.
			if (instance.stopped && instance.particles.length === 0) {
				this.#removeEmitter(index, "reaped");
			}
		}
	}

	/**
	 * Select the draw ranges visible this frame, walking emitters and never particles.
	 *
	 * This is what the persistent-record design buys: a record is written when its particle is born
	 * and read by the GPU every frame after, so the per-frame cost is one entry per *visible
	 * emitter* rather than per live particle. Ranges carry a slot base and count instead of record
	 * arrays; the records themselves already sit in {@link ParticleSystem.recordData}.
	 *
	 * `resolveRenderOwner` both culls and preserves the fact needed to route the emitter into the
	 * current portal scope selection.
	 *
	 * The returned array is reused storage owned by this system, valid until the next call.
	 */
	collectDrawRanges(
		resolveRenderOwner: (
			target: BehaviorTarget,
		) => ParticleRenderOwner | null = () => EXTERIOR_PARTICLE_RENDER_OWNER,
	): ParticleSourceRange[] {
		this.#rangeOutput.length = 0;
		this.#lastVisibleFollowingEmitterCount = 0;
		this.#lastVisibleFollowingParticleCount = 0;
		let rangesUsed = 0;
		for (const instance of this.#instances) {
			if (instance.particles.length === 0) continue;
			const info = instance.emitter.info;
			// An unshipped motion type has no formula in either evaluator; drawing it motionless
			// would misrepresent it as working.
			if (info.motionType === null) continue;
			const renderOwner = resolveRenderOwner(instance.target);
			if (renderOwner === null) continue;
			// A following emitter's particles all share one current parent frame. Resolve it once for
			// the range; the vertex stage selects it instead of each particle's spawn record.
			if (info.followsParent) {
				this.#lastVisibleFollowingEmitterCount += 1;
				this.#lastVisibleFollowingParticleCount += instance.particles.length;
				this.#updateFollowingRangeFrame(instance);
			}
			const range = (this.#rangePool[rangesUsed] ??= blankRange());
			rangesUsed += 1;
			range.baseSlot = instance.region.base;
			range.count = instance.particles.length;
			range.hwGfxObjId = instance.emitter.mesh.id;
			range.motionType = info.motionType;
			range.frame = instance.drawFrame;
			range.renderOwner = renderOwner;
			this.#rangeOutput.push(range);
		}
		return this.#rangeOutput;
	}

	/** Record storage the renderer uploads; one entry per live particle, written at spawn. */
	get recordData(): Float32Array {
		return this.#slots.data;
	}

	/** Slots written since the last call, or `null` when no record changed. */
	takeDirtyRecordSlots(): {
		readonly first: number;
		readonly last: number;
	} | null {
		return this.#slots.takeDirtySlotRange();
	}

	/**
	 * Evaluate every live particle on the CPU, in world space.
	 *
	 * Retained deliberately as the **reference** for the GPU vertex stage rather than as a draw
	 * path: the shader implements the same formulas, and this is what its output is checked
	 * against. Production drawing goes through {@link collectDrawRanges}.
	 */
	sample(timeSeconds: number, anchor: SceneVector3): ParticleSample[] {
		const samples: ParticleSample[] = [];
		for (const instance of this.#instances) {
			const liveOrigin = this.#dependencies.sceneOriginOf(instance.frameTarget);
			if (liveOrigin === null) continue;
			const motionType = instance.emitter.info.motionType;
			if (motionType === null) continue;
			for (const particle of instance.particles) {
				const sceneOrigin = resolveSceneOrigin(particle, liveOrigin);
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
	 * Computed at emitter lifetime boundaries, never from particles or during presentation. GPU
	 * evaluation means the CPU does not know individual particle positions, and re-deriving them to
	 * cull would reintroduce exactly the per-particle CPU ceiling this design exists to avoid.
	 */
	envelopeRadiusFor(targetId: BehaviorTargetId): number {
		return this.#ownerAggregates.get(targetId)?.envelopeRadius ?? 0;
	}

	getDiagnostics(): ParticleSystemDiagnostics {
		let maximumEmitterCountPerOwner = 0;
		for (const owner of this.#ownerAggregates.values()) {
			maximumEmitterCountPerOwner = Math.max(
				maximumEmitterCountPerOwner,
				owner.emitterCount,
			);
		}
		return {
			createdEmitterTotal: this.#createdEmitterTotal,
			destroyedEmitterTotal: this.#destroyedEmitterTotal,
			emittedTotal: this.#emittedTotal,
			emitterCount: this.#instances.length,
			emitterOwnerCount: this.#ownerAggregates.size,
			finiteHiddenReconciliationTotal: this.#finiteHiddenReconciliationTotal,
			hiddenEmitterCount: this.#hiddenEmitterCount,
			lastVisibleFollowingEmitterCount: this.#lastVisibleFollowingEmitterCount,
			lastVisibleFollowingParticleCount:
				this.#lastVisibleFollowingParticleCount,
			explicitlyStoppedEmitterTotal: this.#explicitlyStoppedEmitterTotal,
			lostTargetEmitterTotal: this.#lostTargetEmitterTotal,
			maximumEmitterCountPerOwner,
			ownerAggregateRepairEmitterInspectionTotal:
				this.#ownerAggregateRepairEmitterInspectionTotal,
			ownerAggregateRepairTotal: this.#ownerAggregateRepairTotal,
			particleCount: this.#instances.reduce(
				(total, instance) => total + instance.particles.length,
				0,
			),
			reapedEmitterCount: this.#reapedEmitterCount,
			persistentHiddenReconciliationTotal:
				this.#persistentHiddenReconciliationTotal,
			recordSlotCapacity: this.#slots.capacity,
			reservedRecordSlotCount: this.#slots.reservedSlotCount,
			replacedEmitterTotal: this.#replacedEmitterTotal,
			visibleEmitterCount: this.#visibleEmitterCount,
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
			this.#persistentHiddenReconciliationTotal += 1;
			// Shifting every birth time forward by the suspension is exactly an age freeze, and it
			// keeps the emission clock in step so the next particle is not immediately overdue.
			for (let index = 0; index < instance.particles.length; index += 1) {
				const particle = instance.particles[index]!;
				particle.birthTime += hiddenSeconds;
				// Death rides birth exactly, or the freeze would silently extend every lifespan.
				particle.deathTime += hiddenSeconds;
				// The vertex stage derives elapsed time from the stored birth, so the shift has to
				// reach the record too.
				this.#slots.patchRecordFloat(
					instance.region.base + index,
					PARTICLE_RECORD_BIRTH_TIME_FLOAT,
					particle.birthTime,
				);
			}
			instance.nextDeathTime += hiddenSeconds;
			if (instance.lastEmissionTime !== null)
				instance.lastEmissionTime += hiddenSeconds;
			return;
		}
		this.#finiteHiddenReconciliationTotal += 1;
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

	/**
	 * Particles die only by lifespan; retail never kills them any other way.
	 *
	 * Compacts survivors in place rather than rebuilding the array, and rebuilds the watermark from
	 * the same pass, so a frame that expires nothing costs one comparison and a frame that expires
	 * something costs one pass with no allocation.
	 */
	#reapExpired(instance: EmitterInstance, timeSeconds: number): void {
		if (timeSeconds < instance.nextDeathTime) return;
		const particles = instance.particles;
		let surviving = 0;
		let nextDeathTime = Number.POSITIVE_INFINITY;
		for (let index = 0; index < particles.length; index += 1) {
			const particle = particles[index]!;
			if (timeSeconds >= particle.deathTime) continue;
			if (surviving !== index) {
				particles[surviving] = particle;
				this.#slots.moveRecord(
					instance.region.base + index,
					instance.region.base + surviving,
				);
			}
			surviving += 1;
			if (particle.deathTime < nextDeathTime)
				nextDeathTime = particle.deathTime;
		}
		particles.length = surviving;
		instance.nextDeathTime = nextDeathTime;
	}

	/** A finite emitter stops once it exhausts its particle budget or its authored duration. */
	#applyAutoStop(instance: EmitterInstance, timeSeconds: number): void {
		if (instance.stopped) return;
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

	/** Remove one authoritative instance and repair only its owner's derived culling aggregate. */
	#removeEmitter(index: number, reason: EmitterRemovalReason): void {
		const instance = this.#instances[index];
		if (!instance) throw new Error(`Particle emitter ${index} does not exist.`);
		this.#instances.splice(index, 1);
		this.#slots.release(instance.region);
		switch (reason) {
			case "destroyed":
				this.#destroyedEmitterTotal += 1;
				break;
			case "reaped":
				this.#reapedEmitterCount += 1;
				break;
			case "replaced":
				this.#replacedEmitterTotal += 1;
				break;
			case "target-lost":
				this.#lostTargetEmitterTotal += 1;
				break;
		}
		this.#repairOwnerAggregateAfterRemoval(instance);
	}

	/**
	 * Repair a cold-path maximum after one removal.
	 *
	 * The normal presentation path is one map lookup. Re-scanning the authoritative sequence is
	 * deliberately paid only when the removed emitter owned the maximum; retaining owner membership
	 * as a second mutable collection would make every lifetime operation harder to keep correct.
	 */
	#repairOwnerAggregateAfterRemoval(removed: EmitterInstance): void {
		const targetId = removed.target.targetId;
		const owner = this.#ownerAggregates.get(targetId);
		if (!owner) {
			throw new Error(`Particle owner ${targetId} has no aggregate to remove.`);
		}
		owner.emitterCount -= 1;
		if (owner.emitterCount === 0) {
			this.#ownerAggregates.delete(targetId);
			return;
		}
		if (removed.envelopeRadius < owner.envelopeRadius) return;
		this.#ownerAggregateRepairTotal += 1;
		let envelopeRadius = 0;
		let emitterCount = 0;
		for (const instance of this.#instances) {
			this.#ownerAggregateRepairEmitterInspectionTotal += 1;
			if (instance.target.targetId !== targetId) continue;
			emitterCount += 1;
			envelopeRadius = Math.max(envelopeRadius, instance.envelopeRadius);
		}
		if (emitterCount !== owner.emitterCount) {
			throw new Error(
				`Particle owner ${targetId} aggregate expected ${owner.emitterCount} emitters, found ${emitterCount}.`,
			);
		}
		owner.envelopeRadius = envelopeRadius;
	}

	/**
	 * Release at most one particle, and only once the minimum interval has elapsed.
	 *
	 * RETAIL QUIRK: `birthrate` is a **minimum interval**, not a rate, and retail emits at most one particle per
	 * update with no catch-up (acclient.c:312447-312476, 318289). Reproduced deliberately: emitting
	 * a burst to "catch up" a slow frame would change authored density.
	 */
	#emitDue(instance: EmitterInstance, timeSeconds: number): void {
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
		// Every gate has passed, so this emitter is spawning and now needs to know where it is.
		const parentOrigin = this.#dependencies.sceneOriginOf(instance.frameTarget);
		// `advance` proved this target live earlier in the same iteration, and a live target always
		// publishes an origin, so a missing one is a broken contract rather than a departed target.
		if (parentOrigin === null) {
			throw new Error(
				`Emitter frame ${instance.frameTarget.targetId} is live but published no origin.`,
			);
		}
		this.#emit(instance, timeSeconds, parentOrigin);
	}

	#emit(
		instance: EmitterInstance,
		timeSeconds: number,
		parentOrigin: SceneVector3,
	): void {
		const info = instance.emitter.info;
		if (instance.particles.length >= info.maxParticles) return;
		const roll = this.#roll;
		// Retail resolves every random field before `Particle::Init`, in this exact order
		// (acclient.c:318125-318158). Preserve it so a deterministic source produces the same
		// per-field sequence instead of merely the same marginal distributions.
		const lifespan = Math.max(
			0,
			sampleSymmetricVariance(roll, info.lifespan, info.lifespanRand),
		);
		const finalTranslucency = sampleTranslucency(
			roll,
			info.finalTrans,
			info.transRand,
		);
		const startTranslucency = sampleTranslucency(
			roll,
			info.startTrans,
			info.transRand,
		);
		const finalScale = sampleScale(roll, info.finalScale, info.scaleRand);
		const startScale = sampleScale(roll, info.startScale, info.scaleRand);
		const authoredC = scaledVector(
			info.c,
			sampleUniformRange(roll, info.minC, info.maxC),
		);
		const authoredB = scaledVector(
			info.b,
			sampleUniformRange(roll, info.minB, info.maxB),
		);
		const authoredA = scaledVector(
			info.a,
			sampleUniformRange(roll, info.minA, info.maxA),
		);
		const authoredOffset = this.#spawnOffset(
			info.offsetDir,
			info.minOffset,
			info.maxOffset,
		);
		// Retail snapshots the owner's frame at spawn (`start_frame`, acclient.c:317743) and rotates
		// the constants into it once, so `Update` never sees a frame again. Doing the same here keeps
		// the motion evaluators — CPU and GLSL alike — free of any notion of an owner.
		const rotation = this.#dependencies.sceneRotationOf(instance.frameTarget);
		// The caller already resolved this target's origin from the same placement, so a missing
		// rotation is a broken contract rather than a target that has gone away.
		if (rotation === null) {
			throw new Error(
				`Emitter frame ${instance.frameTarget.targetId} published an origin but no rotation.`,
			);
		}
		const rotated = rotatedSpawnConstants(info.motionType);
		const inFrame = (vector: AcVector3, applies: boolean): AcVector3 =>
			applies ? rotateAcVector(rotation.ac, vector) : vector;
		// Retail rotates `offset` for every type, `Still` included, so this is unconditional. It is
		// resolved before `c` because two motion types derive `c` from the rotated offset.
		const derived = this.#deriveOffsetAndC(
			info.motionType,
			inFrame(
				// Retail sums the hook offset and the random offset and rotates the result once, so
				// the hook offset turns with the owner exactly as the random one does.
				addAcVectors(instance.hookOffset, authoredOffset),
				true,
			),
			inFrame(authoredC, rotated.c),
		);
		const deathTime = timeSeconds + lifespan;
		if (deathTime < instance.nextDeathTime) instance.nextDeathTime = deathTime;
		const slot = instance.region.base + instance.particles.length;
		instance.particles.push({
			birthTime: timeSeconds,
			deathTime,
			rotation: rotation.render,
			// A following emitter resolves its origin live every frame, so freezing one here would
			// be a value nothing reads. The hook offset is applied by the shared resolution instead
			// of here, so both kinds of emitter get it.
			frozenOrigin: info.followsParent ? null : parentOrigin,
			spawn: {
				a: inFrame(authoredA, rotated.a),
				b: inFrame(authoredB, rotated.b),
				c: derived.c,
				finalScale,
				finalTranslucency,
				lifespan,
				offset: derived.offset,
				startScale,
				startTranslucency,
			},
		});
		this.#writeParticleRecord(instance, instance.particles.length - 1, slot);
		instance.emittedCount += 1;
		this.#emittedTotal += 1;
		instance.lastEmissionTime = timeSeconds;
	}

	/**
	 * Write one live particle's record into its slot.
	 *
	 * Every record field is fixed at spawn except birth/death compaction. Following emitters select
	 * their current range frame in the vertex stage, so parent motion never dirties particle rows.
	 */
	#writeParticleRecord(
		instance: EmitterInstance,
		particleIndex: number,
		slot: number,
	): void {
		const particle = instance.particles[particleIndex];
		if (!particle) {
			throw new Error(
				`Emitter ${instance.emitterId} has no particle at ${particleIndex}.`,
			);
		}
		const origin = particle.frozenOrigin ?? this.#liveOriginOf(instance);
		const landblockX = quantizeToLandblock(origin[0]);
		const landblockZ = quantizeToLandblock(origin[2]);
		this.#recordScratch.a = particle.spawn.a;
		this.#recordScratch.b = particle.spawn.b;
		this.#recordScratch.birthTime = particle.birthTime;
		this.#recordScratch.c = particle.spawn.c;
		this.#recordScratch.finalScale = particle.spawn.finalScale;
		this.#recordScratch.finalTranslucency = particle.spawn.finalTranslucency;
		this.#recordScratch.lifespan = particle.spawn.lifespan;
		this.#recordScratch.offset = particle.spawn.offset;
		this.#recordScratch.rotation = particle.rotation;
		this.#recordScratch.landblockOrigin[0] = landblockX;
		this.#recordScratch.landblockOrigin[1] = 0;
		this.#recordScratch.landblockOrigin[2] = landblockZ;
		this.#recordScratch.localOrigin[0] = origin[0] - landblockX;
		this.#recordScratch.localOrigin[1] = origin[1];
		this.#recordScratch.localOrigin[2] = origin[2] - landblockZ;
		this.#recordScratch.startScale = particle.spawn.startScale;
		this.#recordScratch.startTranslucency = particle.spawn.startTranslucency;
		this.#slots.writeRecord(slot, this.#recordScratch);
	}

	/** Resolve one following emitter frame into its lifetime-owned range storage. */
	#updateFollowingRangeFrame(instance: EmitterInstance): void {
		const frame = instance.drawFrame;
		if (!(frame instanceof FollowingRangeFrame)) {
			throw new Error("A parent-following emitter has no range frame.");
		}
		frame.updateOrigin(this.#liveOriginOf(instance));
		if (
			!this.#dependencies.writeSceneRenderRotationOf(
				instance.frameTarget,
				frame.rotationOutput,
			)
		) {
			throw new Error(
				`Emitter frame ${instance.frameTarget.targetId} published an origin but no rotation.`,
			);
		}
	}

	/**
	 * Live origin of a following emitter's frame.
	 *
	 * A following emitter reads its parent every frame by definition, so a target that has stopped
	 * publishing one while still registered is a broken contract rather than a departed target.
	 */
	#liveOriginOf(instance: EmitterInstance): SceneVector3 {
		const origin = this.#dependencies.sceneOriginOf(instance.frameTarget);
		if (origin === null) {
			throw new Error(
				`Emitter frame ${instance.frameTarget.targetId} published no origin.`,
			);
		}
		return origin;
	}

	/**
	 * `offset` and `c` at spawn, which two motion types derive rather than carry
	 * (`Particle::Init`, acclient.c:317826-317864).
	 *
	 * Returned together because for `Implode` they are the same vector, and because both derivations
	 * read the already-rotated offset. Every other type passes both through untouched.
	 */
	#deriveOffsetAndC(
		motionType: number | null,
		offset: AcVector3,
		c: AcVector3,
	): { readonly c: AcVector3; readonly offset: AcVector3 } {
		switch (motionType) {
			case PARTICLE_TYPE.explode:
				return { c: this.#explodeDirection(c), offset };

			case PARTICLE_TYPE.implode: {
				// Retail scales the offset by `c` in place and then copies it into `c`, so the two end
				// up identical. Reading the rotated offset is how implode inherits the owner's frame
				// without appearing in the rotation table.
				const scaled = acVector3([
					offset[0] * c[0],
					offset[1] * c[1],
					offset[2] * c[2],
				]);
				return { c: scaled, offset: scaled };
			}

			default:
				return { c, offset };
		}
	}

	/**
	 * A random direction for `Explode`, weighted by the authored `c` and then normalized
	 * (acclient.c:317826-317847).
	 *
	 * The authored magnitude is **discarded**: `c` leaves here as a unit vector or as zero, so the
	 * authored components only bias which directions are likely. Feeding authored `c` straight
	 * through instead fires every particle of a burst along one direction rather than spraying.
	 *
	 * Both angles are rolled across the full circle, which is not a uniform distribution over the
	 * sphere — it concentrates toward the poles. That is retail's sampling and content was authored
	 * against it, so it is transcribed rather than corrected.
	 */
	#explodeDirection(weights: AcVector3): AcVector3 {
		const roll = this.#roll;
		const azimuth = roll() * 2 * Math.PI - Math.PI;
		const elevation = roll() * 2 * Math.PI - Math.PI;
		const equator = Math.cos(elevation);
		const x = Math.cos(azimuth) * weights[0] * equator;
		const y = Math.sin(azimuth) * weights[1] * equator;
		const z = Math.sin(elevation) * weights[2];
		const magnitude = Math.hypot(x, y, z);
		// Retail's `normalize_check_small` refuses anything shorter than this and zeroes the vector
		// rather than dividing by it (acclient.c:137456).
		if (magnitude < MINIMUM_NORMALIZABLE_LENGTH) return acVector3([0, 0, 0]);
		return acVector3([x / magnitude, y / magnitude, z / magnitude]);
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
