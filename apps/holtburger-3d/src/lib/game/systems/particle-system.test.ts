import { behaviorTargetId } from "../behavior/behavior-event-router";
import {
	acVector3,
	renderVector3,
	resolvedFrameRotationFromRenderTransform,
	sceneVector3,
} from "../../assets/ac-frame";
import { Mat4, Quat } from "../math/types";
import { createRotationMat4 } from "../math/matrices";
import type { AcVector3, SceneVector3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import type { BehaviorTarget } from "../behavior/behavior-event-router";
import type { DrawableParticleEmitter } from "../behavior/particle-emitter-repository";
import type { DatAssetId } from "../game-types";
import type { SceneNodeId } from "../scene";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { ParticleSystem } from "./particle-system";
import { PARTICLE_RECORD_STRIDE_FLOATS } from "../behavior/particle-record-slots";

const TARGET: BehaviorTarget = {
	generation: 1,
	targetId: behaviorTargetId("node-1"),
};
const SECOND_TARGET: BehaviorTarget = {
	generation: 1,
	targetId: behaviorTargetId("node-2"),
};
const ORIGIN: SceneVector3 = sceneVector3([0, 0, 0]);
/** Hook offsets stay in AC axes so spawn can rotate them with the owner before converting. */
const NO_OFFSET: AcVector3 = acVector3([0, 0, 0]);

function prepared(
	overrides: Partial<DrawableParticleEmitter["info"]> = {},
	derived: {
		readonly centerReach?: number;
		readonly maximumScale?: number;
		readonly meshRadius?: number;
	} = {},
): DrawableParticleEmitter {
	const meshRadius = derived.meshRadius ?? 1;
	const mesh = {
		id: "0x01000ff4" as DatAssetId,
		radius: meshRadius,
	};
	const info: DrawableParticleEmitter["info"] = {
		a: acVector3([1, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthrateSeconds: 1,
		c: acVector3([0, 0, 0]),
		emitsPerMeter: false,
		emitsPerSecond: true,
		finalScale: 1,
		finalTrans: 1,
		followsParent: false,
		id: "0x3200020c" as DatAssetId,
		initialParticles: 0,
		isPersistent: true,
		lifespan: 10,
		lifespanRand: 0,
		maxA: 1,
		maxB: 1,
		maxC: 1,
		maxOffset: 0,
		maxParticles: 100,
		minA: 1,
		minB: 1,
		minC: 1,
		minOffset: 0,
		motionType: 2,
		offsetDir: acVector3([0, 0, 1]),
		scaleRand: 0,
		startScale: 1,
		startTrans: 0,
		totalParticles: 0,
		totalSeconds: 0,
		transRand: 0,
		...overrides,
	};
	return {
		centerReach: derived.centerReach ?? 10,
		id: info.id,
		info,
		kind: "drawable",
		maximumScale: derived.maximumScale ?? 1,
		mesh,
	};
}

/** A quarter turn about AC's up axis, the case the waterfall report turned on. */
const YAWED_QUARTER_TURN = resolvedFrameRotationFromRenderTransform(
	createRotationMat4(new Quat(Math.SQRT1_2, 0, Math.SQRT1_2, 0)),
);

/** An owner with no rotation, so these tests read authored constants unchanged. */
const UNROTATED = resolvedFrameRotationFromRenderTransform(Mat4.identity());

const runtime = (
	overrides: Partial<ConstructorParameters<typeof ParticleSystem>[0]> = {},
) =>
	new ParticleSystem({
		clock: () => 0,
		sceneOriginOf: () => ORIGIN,
		targetLives: () => true,
		sceneRotationOf: () => UNROTATED,
		writeSceneRenderRotationOf: (_target, output) => {
			Object.assign(output, UNROTATED.render);
			return true;
		},
		partFrameOf: (target, partIndex) => ({
			generation: target.generation,
			targetId: behaviorTargetId(`${target.targetId}/part/${partIndex}`),
		}),
		resolveEmitter: () => null,
		roll: () => 0.5,
		...overrides,
	});

/**
 * Decode one particle's stored record, which is exactly what the vertex stage reads.
 *
 * Records are written into slot storage at spawn rather than rebuilt per frame, so a spawn is
 * inspected by reading its slot rather than by collecting a frame's worth of them.
 */
function storedRecord(system: ParticleSystem, slot = 0) {
	const data = system.recordData;
	const at = slot * PARTICLE_RECORD_STRIDE_FLOATS;
	const read = (offset: number) => data[at + offset]!;
	return {
		a: [read(8), read(9), read(10)],
		b: [read(11), read(12), read(13)],
		birthTime: read(3),
		c: [read(14), read(15), read(16)],
		finalScale: read(18),
		finalTranslucency: read(20),
		landblockOrigin: [read(21), read(22), read(23)],
		lifespan: read(7),
		localOrigin: [read(0), read(1), read(2)],
		offset: [read(4), read(5), read(6)],
		rotation: [read(24), read(25), read(26), read(27)],
		startScale: read(17),
		startTranslucency: read(19),
	};
}

describe("ParticleSystem", () => {
	it.each([
		{ expectedFactor: 0.3, roll: 0 },
		{ expectedFactor: 0.5, roll: 0.5 },
		{ expectedFactor: 0.7, roll: 1 },
	])(
		"keeps waterfall mist 0x320004A3 in its [0.3, 0.7] motion interval at roll $roll",
		({ expectedFactor, roll }) => {
			const particles = runtime({ roll: () => roll });
			particles.create(
				TARGET,
				prepared({
					a: acVector3([1, 0, 0]),
					b: acVector3([0, 0, -40]),
					c: acVector3([0, 1, 0]),
					initialParticles: 1,
					maxA: 0.7,
					maxB: 0.7,
					maxC: 0.7,
					minA: 0.3,
					minB: 0.3,
					minC: 0.3,
					motionType: 10,
				}),
				NO_OFFSET,
				0,
				0,
				ORIGIN,
			);

			const spawn = storedRecord(particles);
			expect(spawn.a[0]).toBeCloseTo(expectedFactor);
			expect(spawn.b[2]).toBeCloseTo(-40 * expectedFactor);
			expect(spawn.c[1]).toBeCloseTo(expectedFactor);
			expect(spawn.b[2]).toBeLessThan(0);
		},
	);

	// Each endpoint is sampled and clamped by its own formula, which is the behavior content
	// depends on. Asserted with a constant roll rather than a positional sequence on purpose:
	// *which* draw feeds *which* field is an implementation detail of the CPU emitter, and one the
	// closed-form GPU path deliberately does not preserve.
	it.each([
		{
			// Every field at the top of its range: exercises the upper scale and translucency clamps.
			expectedA: 2.4,
			expectedB: 1.8,
			expectedC: 1.2,
			expectedEndpoints: {
				finalScale: 10,
				finalTranslucency: 1,
				lifespan: 12,
				startScale: 2.2,
				startTranslucency: 0.7,
			},
			roll: 1,
		},
		{
			// Every field at the bottom: exercises the lower clamps, which floor scale at 0.1.
			expectedA: 0.8,
			expectedB: 0.6,
			expectedC: 0.4,
			expectedEndpoints: {
				finalScale: 7.5,
				finalTranslucency: 0.3,
				lifespan: 8,
				startScale: 0.1,
				startTranslucency: 0,
			},
			roll: 0,
		},
	])(
		"samples and clamps every appearance endpoint at roll $roll",
		({ expectedA, expectedB, expectedC, expectedEndpoints, roll }) => {
			const particles = runtime({ roll: () => roll });
			particles.create(
				TARGET,
				prepared({
					a: acVector3([4, 0, 0]),
					b: acVector3([0, 3, 0]),
					c: acVector3([0, 0, 2]),
					finalScale: 9.5,
					finalTrans: 0.8,
					initialParticles: 1,
					lifespan: 10,
					lifespanRand: 2,
					maxA: 0.6,
					maxB: 0.6,
					maxC: 0.6,
					minA: 0.2,
					minB: 0.2,
					minC: 0.2,
					scaleRand: 2,
					startScale: 0.2,
					startTrans: 0.2,
					transRand: 0.5,
				}),
				NO_OFFSET,
				0,
				0,
				ORIGIN,
			);

			const spawn = storedRecord(particles);
			for (const [endpoint, expected] of Object.entries(expectedEndpoints)) {
				expect(spawn[endpoint as keyof typeof expectedEndpoints]).toBeCloseTo(
					expected,
				);
			}
			expect(spawn.a[0]).toBeCloseTo(expectedA);
			expect(spawn.b[1]).toBeCloseTo(expectedB);
			expect(spawn.c[2]).toBeCloseTo(expectedC);
		},
	);

	it("releases initial particles immediately, before any interval applies", () => {
		const particles = runtime();

		particles.create(
			TARGET,
			prepared({ initialParticles: 3 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		expect(particles.getDiagnostics().particleCount).toBe(3);
	});

	it("treats birthrate as a minimum interval and never bursts to catch up", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		particles.advance(0);
		expect(particles.getDiagnostics().particleCount).toBe(1);

		// Half an interval later: still one.
		particles.advance(0.5);
		expect(particles.getDiagnostics().particleCount).toBe(1);

		// Five intervals in one step releases exactly one more, not five.
		particles.advance(5);
		expect(particles.getDiagnostics().particleCount).toBe(2);
	});

	it("caps live particles at the authored maximum", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 0, maxParticles: 3 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		for (let step = 0; step < 20; step += 1) particles.advance(step);

		expect(particles.getDiagnostics().particleCount).toBe(3);
	});

	it("expires particles by lifespan and only by lifespan", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 100, initialParticles: 1, lifespan: 2 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		particles.advance(1);
		expect(particles.getDiagnostics().particleCount).toBe(1);
		particles.advance(2.5);
		expect(particles.getDiagnostics().particleCount).toBe(0);
	});

	it("reaps a finite emitter once its budget is spent and its particles finish", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({
				birthrateSeconds: 0,
				isPersistent: false,
				lifespan: 1,
				totalParticles: 2,
			}),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		particles.advance(0);
		particles.advance(0.1);
		expect(particles.getDiagnostics().emitterCount).toBe(1);

		// Budget spent, then the last particle ages out: the emitter reaps itself.
		particles.advance(5);
		expect(particles.getDiagnostics().emitterCount).toBe(0);
		expect(particles.getDiagnostics().reapedEmitterCount).toBe(1);
	});

	it("drains on stop but vanishes on destroy", () => {
		const drained = runtime();
		drained.create(
			TARGET,
			prepared({ initialParticles: 2, lifespan: 5 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		drained.stop(TARGET, 0);
		drained.stop(TARGET, 0);
		drained.advance(1);
		// Stopped emitters keep their live particles until each finishes its own lifespan.
		expect(drained.getDiagnostics().particleCount).toBe(2);
		// Repeating the same stop does not manufacture a second lifetime transition.
		expect(drained.getDiagnostics().explicitlyStoppedEmitterTotal).toBe(1);

		const destroyed = runtime();
		destroyed.create(
			TARGET,
			prepared({ initialParticles: 2 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		destroyed.destroy(TARGET, 0);
		expect(destroyed.getDiagnostics()).toMatchObject({
			destroyedEmitterTotal: 1,
			emitterOwnerCount: 0,
			particleCount: 0,
		});
	});

	it("replaces a live emitter that shares a nonzero authored id", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 2 }),
			NO_OFFSET,
			7,
			0,
			ORIGIN,
		);
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			7,
			0,
			ORIGIN,
		);

		expect(particles.getDiagnostics()).toMatchObject({
			createdEmitterTotal: 2,
			emitterCount: 1,
			particleCount: 1,
			replacedEmitterTotal: 1,
		});
	});

	it("keeps auto-id emitters independent of one another", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		expect(particles.getDiagnostics().emitterCount).toBe(2);
	});

	it("leaves particles behind unless the emitter follows its parent", () => {
		// The parent genuinely moves, which is the only case the two kinds must disagree on.
		let parentX = 0;
		const moving = () => sceneVector3([parentX, 0, 0]);

		const left = runtime({ sceneOriginOf: moving });
		left.create(
			TARGET,
			prepared({ a: acVector3([0, 0, 0]), initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		const following = runtime({ sceneOriginOf: moving });
		following.create(
			TARGET,
			prepared({
				a: acVector3([0, 0, 0]),
				followsParent: true,
				initialParticles: 1,
			}),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		parentX = 100;

		expect(left.sample(0, ORIGIN)[0]!.position[0]).toBeCloseTo(0);
		expect(following.sample(0, ORIGIN)[0]!.position[0]).toBeCloseTo(100);
	});

	it("drops emitters whose target stops existing", () => {
		let published = true;
		const particles = runtime({
			sceneOriginOf: () => (published ? ORIGIN : null),
			targetLives: () => published,
		});
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		published = false;
		particles.advance(1);

		expect(particles.getDiagnostics()).toMatchObject({
			emitterCount: 0,
			lostTargetEmitterTotal: 1,
		});
	});

	// Resolving an origin walks the scene hierarchy, and the emitter loop runs for every resident
	// emitter every frame while spawns are interval-gated. Pinning the call count is what keeps a
	// future edit from quietly reintroducing a per-frame resolve.
	it("resolves no origin on a frame where no emitter is due to spawn", () => {
		let originReads = 0;
		const particles = runtime({
			sceneOriginOf: () => {
				originReads += 1;
				return ORIGIN;
			},
		});
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 100, initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		originReads = 0;

		// Well inside the emitter's 100-second interval, so no spawn is due on any of these frames.
		particles.advance(1);
		particles.advance(2);
		particles.advance(3);

		expect(originReads).toBe(0);
	});

	it("resolves one origin on the frame an emitter spawns", () => {
		let originReads = 0;
		const particles = runtime({
			sceneOriginOf: () => {
				originReads += 1;
				return ORIGIN;
			},
		});
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 1, initialParticles: 0, maxParticles: 8 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		originReads = 0;

		particles.advance(5);

		expect(originReads).toBe(1);
		expect(particles.getDiagnostics().particleCount).toBe(1);
	});

	// Reaping moved from evaluating life progress per particle per frame to comparing a `deathTime`
	// stamped at spawn. The two must agree exactly, including at the boundary and for the
	// degenerate lifespans the spawn path can produce.
	describe("expiry", () => {
		it.each([
			{ alive: true, at: 1.9, lifespan: 2 },
			// Retail's predicate is `t < lifespan`, so a particle is gone the instant it reaches its
			// lifespan rather than one frame later.
			{ alive: false, at: 2, lifespan: 2 },
			{ alive: false, at: 2.1, lifespan: 2 },
			// A zero-lifespan particle is born already expired.
			{ alive: false, at: 0, lifespan: 0 },
		])(
			"keeps a lifespan-$lifespan particle alive=$alive at t=$at",
			({ alive, at, lifespan }) => {
				const particles = runtime();
				particles.create(
					TARGET,
					prepared({ birthrateSeconds: 100, initialParticles: 1, lifespan }),
					NO_OFFSET,
					0,
					0,
					ORIGIN,
				);

				particles.advance(at);

				expect(particles.getDiagnostics().particleCount).toBe(alive ? 1 : 0);
			},
		);

		it("shifts expiry with birth when a hidden persistent emitter is reconciled", () => {
			const particles = runtime();
			particles.create(
				TARGET,
				prepared({ birthrateSeconds: 100, initialParticles: 1, lifespan: 2 }),
				NO_OFFSET,
				0,
				0,
				ORIGIN,
			);

			// Hidden across its entire lifespan: a suspension that shifted birth but not death would
			// expire this particle the moment it became visible again.
			particles.advance(1, () => false);
			particles.advance(10, () => false);
			particles.advance(10.5);

			expect(particles.getDiagnostics().particleCount).toBe(1);
			// Its age is frozen at the 1-second mark it reached before hiding, so it dies a full
			// lifespan after reconciliation rather than on the original clock.
			particles.advance(11.5);
			expect(particles.getDiagnostics().particleCount).toBe(0);
		});
	});

	it("freezes a hidden persistent emitter's particle ages instead of expiring them unseen", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 100, initialParticles: 1, lifespan: 2 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		const hidden = () => false;
		const visible = () => true;

		// Hidden across ten seconds, far beyond the two-second lifespan.
		particles.advance(1, hidden);
		particles.advance(10, visible);

		// Retail freezes ages off-screen, so the particle is still alive on return.
		expect(particles.getDiagnostics()).toMatchObject({
			particleCount: 1,
			persistentHiddenReconciliationTotal: 1,
			visibleEmitterCount: 1,
		});
	});

	it("does no particle-level work while an emitter is hidden", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 0 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		const hidden = () => false;

		for (let step = 0; step < 50; step += 1) particles.advance(step, hidden);

		// Retail ticks hidden emitters every frame; closed-form state lets us emit nothing at all.
		expect(particles.getDiagnostics()).toMatchObject({
			hiddenEmitterCount: 1,
			particleCount: 0,
			visibleEmitterCount: 0,
		});
	});

	it("completes a hidden finite emitter's burst analytically", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({
				birthrateSeconds: 1,
				isPersistent: false,
				lifespan: 100,
				totalParticles: 4,
			}),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		const hidden = () => false;

		particles.advance(0, hidden);
		// Ten hidden seconds at a one-second interval exhausts the four-particle budget.
		particles.advance(10, () => true);

		expect(particles.getDiagnostics()).toMatchObject({
			emitterCount: 0,
			finiteHiddenReconciliationTotal: 1,
			reapedEmitterCount: 1,
		});
	});

	it("creates an emitter through the router port when its definition is staged", () => {
		const staged = prepared({ initialParticles: 2 });
		const particles = runtime({
			clock: () => 12,
			resolveEmitter: (id) => (id === staged.id ? staged : null),
		});

		const outcome = particles.createEmitter(TARGET, {
			emitterId: 0,
			partIndex: -1,
			emitterInfoId: staged.id,
			// AC's z is up, so this is five metres above the owner.
			offsetOrigin: acVector3([0, 0, 5]),
		});

		expect(outcome).toBe("created");
		expect(particles.getDiagnostics().particleCount).toBe(2);
		// The hook offset lands on top of the parent origin, not instead of it, and arrives in
		// render axes where up is y.
		expect(particles.sample(12, ORIGIN)[0]!.position[1]).toBeCloseTo(5);
	});

	/**
	 * 6,692 of 7,365 authored `CreateParticle` hooks name a part rather than the whole object, so this
	 * is the common case and not an edge one. Retail snapshots that part's frame
	 * (`Particle::Init`, acclient.c:317791); using the object's puts nine emitters in ten in the wrong
	 * place and aims them with the wrong rotation.
	 */
	it("positions a part-attached emitter by its part, not by its owner", () => {
		const staged = prepared({ initialParticles: 1 });
		const partNode = "node-1/part/4" as SceneNodeId;
		const particles = runtime({
			resolveEmitter: () => staged,
			sceneOriginOf: (target) =>
				target.targetId === partNode ? sceneVector3([9, 0, 0]) : ORIGIN,
		});

		particles.createEmitter(TARGET, {
			emitterId: 0,
			emitterInfoId: staged.id,
			offsetOrigin: acVector3([0, 0, 0]),
			partIndex: 4,
		});

		expect(storedRecord(particles).localOrigin[0]).toBeCloseTo(9);
	});

	it("keeps a part-attached emitter owned by its object for visibility and envelope", () => {
		const staged = prepared({ initialParticles: 1 });
		const particles = runtime({ resolveEmitter: () => staged });

		particles.createEmitter(TARGET, {
			emitterId: 0,
			emitterInfoId: staged.id,
			offsetOrigin: acVector3([0, 0, 0]),
			partIndex: 4,
		});

		// The envelope belongs to the owning object; culling the part alone would lose the swarm.
		expect(particles.envelopeRadiusFor(TARGET.targetId)).toBeGreaterThan(0);
		expect(particles.collectDrawRanges(() => null)).toHaveLength(0);
	});

	it("refuses a part the owner does not have rather than falling back to the object", () => {
		const staged = prepared();
		const particles = runtime({
			partFrameOf: () => null,
			resolveEmitter: () => staged,
		});

		expect(
			particles.createEmitter(TARGET, {
				emitterId: 0,
				emitterInfoId: staged.id,
				offsetOrigin: acVector3([0, 0, 0]),
				partIndex: 99,
			}),
		).toBe("unprepared");
	});

	it("reports an unstaged emitter instead of guessing or throwing", () => {
		const particles = runtime({ resolveEmitter: () => null });

		expect(
			particles.createEmitter(TARGET, {
				emitterId: 0,
				partIndex: -1,
				emitterInfoId: "0x32009999" as DatAssetId,
				offsetOrigin: acVector3([0, 0, 0]),
			}),
		).toBe("unprepared");
		expect(particles.getDiagnostics().emitterCount).toBe(0);
	});

	it("faithfully refuses a retail-inert emitter without simulating it", () => {
		const particles = runtime({
			resolveEmitter: () => ({
				id: "0x320003b7" as DatAssetId,
				kind: "retail-inert",
			}),
		});

		expect(
			particles.createEmitter(TARGET, {
				emitterId: 0,
				emitterInfoId: "0x320003b7" as DatAssetId,
				offsetOrigin: NO_OFFSET,
				partIndex: -1,
			}),
		).toBe("intentionally-inert");
		expect(particles.getDiagnostics()).toMatchObject({
			emitterCount: 0,
			particleCount: 0,
		});
	});

	it("contributes a conservative bound covering its hook offset and envelope", () => {
		const particles = runtime();
		particles.create(TARGET, prepared(), acVector3([0, 0, 4]), 0, 0, ORIGIN);

		// Center reach 10 plus unit mesh extent 1, displaced 4 by the hook offset.
		expect(particles.envelopeRadiusFor(TARGET.targetId)).toBeCloseTo(15);
	});

	it.each([
		{ expected: 3.5, meshRadius: 0.5 },
		{ expected: 5, meshRadius: 1 },
		{ expected: 8, meshRadius: 2 },
	])(
		"includes a radius-$meshRadius mesh in the drawable envelope",
		({ expected, meshRadius }) => {
			const particles = runtime();
			particles.create(
				TARGET,
				prepared({}, { centerReach: 2, maximumScale: 3, meshRadius }),
				NO_OFFSET,
				0,
				0,
				ORIGIN,
			);

			expect(particles.envelopeRadiusFor(TARGET.targetId)).toBeCloseTo(
				expected,
			);
		},
	);

	it("contributes nothing for a target with no live emitters", () => {
		// Zero rather than null, so a caller adds it to presentation bounds unconditionally.
		expect(runtime().envelopeRadiusFor(TARGET.targetId)).toBe(0);
	});

	it("takes the widest emitter when a target runs several", () => {
		const particles = runtime();
		particles.create(TARGET, prepared(), acVector3([0, 0, 0]), 0, 0, ORIGIN);
		particles.create(TARGET, prepared(), acVector3([0, 0, 20]), 0, 0, ORIGIN);

		expect(particles.envelopeRadiusFor(TARGET.targetId)).toBeCloseTo(31);
	});

	it("repairs only a removed widest emitter's owner aggregate", () => {
		const particles = runtime();
		particles.create(TARGET, prepared(), NO_OFFSET, 1, 0, ORIGIN);
		particles.create(SECOND_TARGET, prepared(), NO_OFFSET, 1, 0, ORIGIN);
		particles.create(TARGET, prepared(), acVector3([0, 0, 20]), 2, 0, ORIGIN);

		particles.destroy(TARGET, 2);

		expect(particles.envelopeRadiusFor(TARGET.targetId)).toBeCloseTo(11);
		expect(particles.envelopeRadiusFor(SECOND_TARGET.targetId)).toBeCloseTo(11);
		expect(particles.getDiagnostics()).toMatchObject({
			emitterOwnerCount: 2,
			maximumEmitterCountPerOwner: 1,
			// Both surviving global entries are inspected once on this cold removal path.
			ownerAggregateRepairEmitterInspectionTotal: 2,
			ownerAggregateRepairTotal: 1,
		});
	});

	it("emits one range per emitter, carrying its mesh and motion law", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 2 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		particles.create(
			TARGET,
			prepared({ initialParticles: 1, motionType: 5 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const ranges = particles.collectDrawRanges();

		expect(ranges).toHaveLength(2);
		expect(ranges.map((range) => range.count).sort()).toEqual([1, 2]);
		expect(ranges.map((range) => range.motionType).sort()).toEqual([2, 5]);
	});

	// Ranges deliberately do not merge, even for emitters that would draw identically. A range
	// names a contiguous run of record slots owned by one emitter, and two emitters' runs are not
	// adjacent, so a merged draw would have to cover the slots between them.
	it("keeps same-mesh emitters in separate, non-overlapping ranges", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const ranges = particles.collectDrawRanges();

		expect(ranges).toHaveLength(2);
		expect(ranges[0]!.baseSlot).not.toBe(ranges[1]!.baseSlot);
	});

	it("preserves global creation order when owner aggregates interleave", () => {
		const particles = runtime();
		const emitter = prepared({
			a: acVector3([0, 0, 0]),
			initialParticles: 1,
		});
		particles.create(TARGET, emitter, NO_OFFSET, 0, 0, sceneVector3([1, 0, 0]));
		particles.create(
			SECOND_TARGET,
			emitter,
			NO_OFFSET,
			0,
			0,
			sceneVector3([2, 0, 0]),
		);
		particles.create(TARGET, emitter, NO_OFFSET, 0, 0, sceneVector3([3, 0, 0]));

		const ranges = particles.collectDrawRanges();

		// One range per emitter, still in the global creation order the authoritative sequence holds.
		expect(ranges).toHaveLength(3);
		expect(
			ranges.map(
				(range) => storedRecord(particles, range.baseSlot).localOrigin[0],
			),
		).toEqual([1, 2, 3]);
		expect(particles.getDiagnostics()).toMatchObject({
			emitterOwnerCount: 2,
			maximumEmitterCountPerOwner: 2,
		});
	});

	it("retains render owners until renderer-owned domain batching", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		particles.create(
			SECOND_TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const ranges = particles.collectDrawRanges(
			(target) => `scene-node:${target.targetId}` as SceneNodeId,
		);
		expect(ranges).toHaveLength(2);
		expect(new Set(ranges.map((range) => range.renderOwner)).size).toBe(2);
	});

	// Records outlive the anchor they are drawn against, so a spawn origin is stored split on the
	// landblock grid rather than measured from the camera's landblock. The coarse part cancels
	// exactly against the anchor in the vertex stage; the local part stays small and precise.
	it("splits a spawn origin onto the landblock grid", () => {
		const particles = runtime({
			sceneOriginOf: () => sceneVector3([500, 12, -300]),
		});
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			sceneVector3([500, 12, -300]),
		);

		const record = storedRecord(particles);

		// The coarse part lands on the landblock grid, so subtracting the anchor -- also on that
		// grid -- is exact rather than merely close.
		expect(
			Math.abs(record.landblockOrigin[0] % OUTDOOR_LANDBLOCK_WORLD_SIZE),
		).toBe(0);
		expect(
			Math.abs(record.landblockOrigin[2] % OUTDOOR_LANDBLOCK_WORLD_SIZE),
		).toBe(0);
		// Elevation needs no coarse part: landblock origins are flat.
		expect(record.landblockOrigin[1]).toBe(0);
		// Together they reconstruct the scene origin exactly.
		expect(record.landblockOrigin[0] + record.localOrigin[0]).toBe(500);
		expect(record.landblockOrigin[1] + record.localOrigin[1]).toBe(12);
		expect(record.landblockOrigin[2] + record.localOrigin[2]).toBe(-300);
		// The local part stays inside one landblock, which is what keeps its precision.
		expect(record.localOrigin[0]).toBeGreaterThanOrEqual(0);
		expect(record.localOrigin[0]).toBeLessThan(OUTDOOR_LANDBLOCK_WORLD_SIZE);
		expect(record.localOrigin[2]).toBeGreaterThanOrEqual(0);
		expect(record.localOrigin[2]).toBeLessThan(OUTDOOR_LANDBLOCK_WORLD_SIZE);
	});

	/**
	 * Retail sums the hook offset with the random spawn offset and rotates the sum once
	 * (acclient.c:317796), so the hook offset belongs to the particle rather than to the emitter
	 * origin, and it turns with the owner.
	 */
	it("folds the hook offset into the particle's own offset, not into its origin", () => {
		const particles = runtime();

		particles.create(
			TARGET,
			prepared({ followsParent: true, initialParticles: 1 }),
			acVector3([5, 0, 0]),
			0,
			0,
			ORIGIN,
		);

		const record = storedRecord(particles);
		expect(record.localOrigin).toEqual([0, 0, 0]);
		expect(record.offset).toEqual(acVector3([5, 0, 0]));
	});

	it("rotates the hook offset by the owner's frame", () => {
		const particles = runtime({ sceneRotationOf: () => YAWED_QUARTER_TURN });

		particles.create(
			TARGET,
			// AC's +y is north; a quarter turn about up sends it to -x.
			prepared({ followsParent: true, initialParticles: 1 }),
			acVector3([0, 5, 0]),
			0,
			0,
			ORIGIN,
		);

		const record = storedRecord(particles);
		expect(record.offset[0]).toBeCloseTo(-5);
		expect(record.offset[1]).toBeCloseTo(0);
	});

	it("freezes the owner's render rotation in each spawn record", () => {
		const particles = runtime({ sceneRotationOf: () => YAWED_QUARTER_TURN });
		particles.create(
			TARGET,
			prepared({ followsParent: false, initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const rotation = storedRecord(particles).rotation;
		expect(rotation[0]).toBeCloseTo(Math.SQRT1_2);
		expect(rotation[1]).toBeCloseTo(0);
		expect(rotation[2]).toBeCloseTo(Math.SQRT1_2);
		expect(rotation[3]).toBeCloseTo(0);
	});

	// The point of persistent records is that a frame touches emitters, never particles. Origin
	// resolution is the observable proxy: a frozen-origin emitter resolves nothing per frame,
	// because its records were complete at spawn.
	it("resolves no origins per frame for emitters that leave particles behind", () => {
		let originReads = 0;
		const particles = runtime({
			sceneOriginOf: () => {
				originReads += 1;
				return ORIGIN;
			},
		});
		particles.create(
			TARGET,
			prepared({ birthrateSeconds: 100, initialParticles: 4 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);
		originReads = 0;

		particles.collectDrawRanges();
		particles.collectDrawRanges();

		expect(originReads).toBe(0);
	});

	// A following emitter resolves one shared live frame per range. Its spawn records remain fixed,
	// even when several particles follow the same moving parent.
	it("carries one live range frame without rewriting following records", () => {
		let parentX = 0;
		let parentRotation = UNROTATED;
		let originReads = 0;
		let renderRotationWrites = 0;
		const particles = runtime({
			sceneOriginOf: () => {
				originReads += 1;
				return sceneVector3([parentX, 0, 0]);
			},
			sceneRotationOf: () => parentRotation,
			writeSceneRenderRotationOf: (_target, output) => {
				renderRotationWrites += 1;
				Object.assign(output, parentRotation.render);
				return true;
			},
		});
		particles.create(
			TARGET,
			prepared({ followsParent: true, initialParticles: 4 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		// Cross a landblock boundary so this also proves the live range retains the same split-origin
		// precision contract as record-owned spawns.
		parentX = 200;
		parentRotation = YAWED_QUARTER_TURN;
		originReads = 0;
		renderRotationWrites = 0;
		const [range] = particles.collectDrawRanges();

		expect(range?.frame).toMatchObject({
			kind: "range",
			landblockOrigin: [192, 0, 0],
			localOrigin: [8, 0, 0],
		});
		if (range?.frame.kind !== "range")
			throw new Error("Expected a live range frame.");
		expect(range.frame.rotation.w).toBeCloseTo(Math.SQRT1_2);
		expect(range.frame.rotation.x).toBeCloseTo(0);
		expect(range.frame.rotation.y).toBeCloseTo(Math.SQRT1_2);
		expect(range.frame.rotation.z).toBeCloseTo(0);
		expect(originReads).toBe(1);
		expect(renderRotationWrites).toBe(1);
		expect(storedRecord(particles).localOrigin[0]).toBe(0);
		expect(particles.getDiagnostics()).toMatchObject({
			lastVisibleFollowingEmitterCount: 1,
			lastVisibleFollowingParticleCount: 4,
		});
	});

	it("gives each exploding particle its own unit direction", () => {
		let index = 0;
		const particles = runtime({
			// An irrational step avoids accidentally repeating when the retail spawn sequence gains or
			// loses an independently sampled field.
			roll: () => {
				index += 1;
				return (index * 0.618_033_988_749_894_9) % 1;
			},
		});
		particles.create(
			TARGET,
			prepared({
				c: acVector3([1000, 1000, 1000]),
				initialParticles: 4,
				motionType: 6,
			}),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const range = particles.collectDrawRanges()[0]!;
		const spawned = Array.from({ length: range.count }, (_unused, slot) =>
			storedRecord(particles, range.baseSlot + slot),
		);
		for (const record of spawned) {
			const magnitude = Math.hypot(...record.c);
			// Unit or zero; the authored 1000 is gone either way. The tolerance is float32-sized
			// because records live in the storage the GPU reads, not in doubles.
			expect(magnitude === 0 || Math.abs(magnitude - 1) < 1e-6).toBe(true);
		}
		const distinct = new Set(spawned.map((record) => record.c.join(",")));
		expect(distinct.size).toBeGreaterThan(1);
	});

	/**
	 * Implode scales its offset by authored `c` and then copies the result into `c`, so the two
	 * leave spawn identical and both carry the owner's frame through the offset.
	 */
	it("derives an imploding particle's c from its own spawn offset", () => {
		const particles = runtime({
			roll: () => 0.75,
			sceneRotationOf: () => YAWED_QUARTER_TURN,
		});
		particles.create(
			TARGET,
			prepared({
				c: acVector3([2, 2, 2]),
				initialParticles: 1,
				maxC: 1,
				maxOffset: 5,
				minC: 1,
				minOffset: 5,
				motionType: 7,
				offsetDir: acVector3([0, 0, 1]),
			}),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const record = storedRecord(particles);
		expect(record.c).toEqual(record.offset);
		// Authored c of 2 doubles the offset it was derived from, so neither is the raw offset.
		expect(Math.hypot(...record.c)).toBeCloseTo(2 * 5);
	});

	it("carries spawn constants into cohorts, never evaluated positions", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			acVector3([0, 0, 3]),
			0,
			0,
			ORIGIN,
		);

		const record = storedRecord(particles);

		// The shader derives position from these; the CPU must not have done it already.
		expect(record.birthTime).toBe(0);
		expect(record.offset).toEqual(acVector3([0, 0, 3]));
		expect(record.a).toEqual(renderVector3([1, 0, 0]));
	});

	it("refuses to invent a cadence for a purely per-meter emitter", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ emitsPerMeter: true, emitsPerSecond: false }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		particles.advance(100);

		// The retail per-meter predicate is unrecovered, so emitting anything would be a guess.
		expect(particles.getDiagnostics().particleCount).toBe(0);
	});
});
