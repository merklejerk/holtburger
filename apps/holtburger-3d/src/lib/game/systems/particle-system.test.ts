import { acVector3, renderVector3, sceneVector3 } from "../../assets/ac-frame";
import type { SceneVector3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import type { BehaviorTarget } from "../behavior/behavior-event-router";
import type { DecodedParticleEmitterInfo } from "../../assets/decode-particle-emitter-record";
import type { PreparedParticleEmitter } from "../behavior/particle-emitter-repository";
import type { Vector3 } from "../behavior/particle-motion";
import type { DatAssetId } from "../game-types";
import type { SceneNodeId } from "../scene";
import { ParticleSystem } from "./particle-system";

const TARGET: BehaviorTarget = {
	generation: 1,
	nodeId: "node-1" as SceneNodeId,
};
const ORIGIN: SceneVector3 = sceneVector3([0, 0, 0]);
/** Hook offsets are displacements, not positions, so they stay in the plain render axes. */
const NO_OFFSET: Vector3 = renderVector3([0, 0, 0]);

function prepared(
	overrides: Partial<DecodedParticleEmitterInfo> = {},
): PreparedParticleEmitter {
	const info: DecodedParticleEmitterInfo = {
		a: acVector3([1, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthrateSeconds: 1,
		c: acVector3([0, 0, 0]),
		emitsPerMeter: false,
		emitsPerSecond: true,
		finalScale: 1,
		finalTrans: 1,
		followsParent: false,
		hwGfxObjId: "0x01000ff4" as DatAssetId,
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
	return { envelopeRadius: 10, id: info.id, info };
}

/**
 * Mid-range roll keeps every randomized term at its authored base.
 *
 * Emitter resolution and the clock are only exercised through `createEmitter`; the tests that drive
 * `create` directly pass their own time explicitly.
 */
const runtime = (
	overrides: Partial<ConstructorParameters<typeof ParticleSystem>[0]> = {},
) =>
	new ParticleSystem({
		clock: () => 0,
		sceneOriginOf: () => ORIGIN,
		renderAnchorOrigin: () => sceneVector3([0, 0, 0]),
		resolveEmitter: () => null,
		roll: () => 0.5,
		...overrides,
	});

describe("ParticleSystem", () => {
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
		drained.advance(1);
		// Stopped emitters keep their live particles until each finishes its own lifespan.
		expect(drained.getDiagnostics().particleCount).toBe(2);

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
		expect(destroyed.getDiagnostics().particleCount).toBe(0);
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

		expect(particles.getDiagnostics().emitterCount).toBe(1);
		expect(particles.getDiagnostics().particleCount).toBe(1);
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

		expect(left.sample(0)[0]!.position[0]).toBeCloseTo(0);
		expect(following.sample(0)[0]!.position[0]).toBeCloseTo(100);
	});

	it("drops emitters whose target stops publishing a transform", () => {
		let published = true;
		const particles = runtime({
			sceneOriginOf: () => (published ? ORIGIN : null),
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

		expect(particles.getDiagnostics().emitterCount).toBe(0);
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
		expect(particles.getDiagnostics().particleCount).toBe(1);
	});

	it("does no per-tick work while an emitter is hidden", () => {
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
		expect(particles.getDiagnostics().particleCount).toBe(0);
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

		expect(particles.getDiagnostics().emitterCount).toBe(0);
		expect(particles.getDiagnostics().reapedEmitterCount).toBe(1);
	});

	it("creates an emitter through the router port when its definition is staged", () => {
		const staged = prepared({ initialParticles: 2 });
		const particles = runtime({
			clock: () => 12,
			resolveEmitter: (id) => (id === staged.id ? staged : null),
		});

		const outcome = particles.createEmitter(TARGET, {
			emitterId: 0,
			emitterInfoId: staged.id,
			offsetOrigin: renderVector3([0, 0, 5]),
		});

		expect(outcome).toBe("created");
		expect(particles.getDiagnostics().particleCount).toBe(2);
		// The hook offset lands on top of the parent origin, not instead of it.
		expect(particles.sample(12)[0]!.position[2]).toBeCloseTo(5);
	});

	it("reports an unstaged emitter instead of guessing or throwing", () => {
		const particles = runtime({ resolveEmitter: () => null });

		expect(
			particles.createEmitter(TARGET, {
				emitterId: 0,
				emitterInfoId: "0x32009999" as DatAssetId,
				offsetOrigin: renderVector3([0, 0, 0]),
			}),
		).toBe("unprepared");
		expect(particles.getDiagnostics().emitterCount).toBe(0);
	});

	it("contributes a conservative bound covering its hook offset and envelope", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared(),
			renderVector3([0, 0, 4]),
			0,
			0,
			ORIGIN,
		);

		// envelopeRadius is 10 in the fixture, displaced 4 by the hook offset.
		expect(particles.envelopeRadiusFor(TARGET)).toBeCloseTo(14);
	});

	it("contributes nothing for a target with no live emitters", () => {
		// Zero rather than null, so a caller adds it to presentation bounds unconditionally.
		expect(runtime().envelopeRadiusFor(TARGET)).toBe(0);
	});

	it("takes the widest emitter when a target runs several", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared(),
			renderVector3([0, 0, 0]),
			0,
			0,
			ORIGIN,
		);
		particles.create(
			TARGET,
			prepared(),
			renderVector3([0, 0, 20]),
			0,
			0,
			ORIGIN,
		);

		expect(particles.envelopeRadiusFor(TARGET)).toBeCloseTo(30);
	});

	it("groups particles into cohorts by mesh and motion type", () => {
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

		const cohorts = particles.collectCohorts();

		// Same mesh, different motion law: the vertex stage binds it as a constant, so they split.
		expect(cohorts).toHaveLength(2);
		expect(cohorts.map((cohort) => cohort.particles.length).sort()).toEqual([
			1, 2,
		]);
	});

	it("merges emitters that share a mesh and motion type into one cohort", () => {
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

		expect(particles.collectCohorts()).toHaveLength(1);
	});

	it("keeps left-behind particles in place when the render anchor moves", () => {
		// Origins arrive anchor-relative, so crossing a landblock boundary shifts every origin by
		// the anchor delta without anything in the world actually moving.
		let anchorX = 0;
		const particles = runtime({
			renderAnchorOrigin: () => sceneVector3([anchorX, 0, 0]),
		});
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		// Copied because origins are pooled storage that the next collect overwrites in place.
		const before = [...particles.collectCohorts()[0]!.particles[0]!.origin];
		expect(before).toEqual([0, 0, 0]);

		// The camera crosses one landblock; the emitter has not moved.
		anchorX = 192;

		const after = particles.collectCohorts()[0]!.particles[0]!.origin;
		expect(after).toEqual([-192, 0, 0]);
	});

	it("applies the authored hook offset to a following emitter's particles", () => {
		const particles = runtime();

		particles.create(
			TARGET,
			prepared({ followsParent: true, initialParticles: 1 }),
			renderVector3([5, 0, 0]),
			0,
			0,
			ORIGIN,
		);

		const record = particles.collectCohorts()[0]!.particles[0]!;
		expect(record.origin).toEqual([5, 0, 0]);
	});

	it("reuses anchored origin storage instead of allocating per particle per frame", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 2 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const first = particles
			.collectCohorts()[0]!
			.particles.map(({ origin }) => origin);
		const second = particles
			.collectCohorts()[0]!
			.particles.map(({ origin }) => origin);

		// Identity, not equality: a fresh vector per particle per frame is the GC churn the pool
		// exists to avoid, and it would still compare equal.
		expect(second[0]).toBe(first[0]);
		expect(second[1]).toBe(first[1]);
		expect(first[0]).not.toBe(first[1]);
	});

	it("reuses instance records too, not only the vectors inside them", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 2 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		const first = [...particles.collectCohorts()[0]!.particles];
		const second = [...particles.collectCohorts()[0]!.particles];

		// The record is the other half of the per-particle-per-frame allocation. Churn is worse
		// than its cost suggests: it accumulates into pauses that are hard to attribute back.
		expect(second[0]).toBe(first[0]);
		expect(second[1]).toBe(first[1]);
		expect(first[0]).not.toBe(first[1]);
	});

	it("emits no instance records for a culled emitter", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 5 }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		// Culling is per emitter, so the whole cohort disappears rather than being filtered.
		expect(particles.collectCohorts(() => false)).toHaveLength(0);
	});

	it("skips an unshipped motion type rather than drawing it motionless", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 1, motionType: null }),
			NO_OFFSET,
			0,
			0,
			ORIGIN,
		);

		expect(particles.collectCohorts()).toHaveLength(0);
	});

	it("carries spawn constants into cohorts, never evaluated positions", () => {
		const particles = runtime();
		particles.create(
			TARGET,
			prepared({ initialParticles: 1 }),
			renderVector3([0, 0, 3]),
			0,
			0,
			ORIGIN,
		);

		const record = particles.collectCohorts()[0]!.particles[0]!;

		// The shader derives position from these; the CPU must not have done it already.
		expect(record.birthTime).toBe(0);
		expect(record.origin[2]).toBeCloseTo(3);
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
