import { acVectorToRender } from "../../assets/ac-frame";
import type { AcVector3, RenderVector3 } from "../../assets/ac-frame";
/**
 * Closed-form particle motion, transcribed from retail `Particle::Update`
 * (acclient.c:317446-317664).
 *
 * Every shipped motion type is `position = parent + offset + f(t)` with no integration state, so a
 * particle's entire mutable state is its spawn constants plus its birth time. This module is the
 * CPU reference for that evaluation: the runtime evaluates the same expressions in a vertex shader,
 * and these tests are what pin the formulas so the GPU port can be checked against something.
 *
 * The 13 `ParticleType` values collapse to seven distinct position formulas. The `Local`/`Global`
 * split does not appear here at all — it selects whether the authored vectors were rotated into
 * world space by the spawn frame, which `Particle::Init` does before `Update` ever runs, so a
 * `Local`/`Global` pair reaches this code with different constants and identical arithmetic.
 * `GR`/`LR` likewise select a spin axis space and change orientation, not trajectory.
 */

/** Positions and displacements this module hands back, in the app's render axes. */
export type Vector3 = RenderVector3;

/**
 * Per-particle constants fixed at spawn; nothing here changes over the particle's life.
 *
 * These stay in AC's authored axes on purpose. Swarm and Explode read meaning from the component
 * *index* — a sine on AC's y, an extra upward term on AC's z — so converting them componentwise on
 * the way in would apply each rule to the wrong axis. The formulas below evaluate in AC and convert
 * their displacement exactly once.
 */
export interface ParticleSpawnConstants {
	readonly offset: AcVector3;
	readonly a: AcVector3;
	readonly b: AcVector3;
	readonly c: AcVector3;
	readonly lifespan: number;
	readonly startScale: number;
	readonly finalScale: number;
	readonly startTranslucency: number;
	readonly finalTranslucency: number;
}

/** `ParticleType` values, named as retail names them (acclient.h:3918-3934). */
export const PARTICLE_TYPE = {
	explode: 6,
	globalVelocity: 12,
	implode: 7,
	localVelocity: 2,
	parabolicGvga: 10,
	parabolicGvgaGr: 11,
	parabolicLvga: 3,
	parabolicLvgaGr: 4,
	parabolicLvla: 8,
	parabolicLvlaLr: 9,
	still: 1,
	swarm: 5,
	unknown: 0,
} as const;

/**
 * Position of one particle at elapsed time `t`, in the same space as `parentOrigin`.
 *
 * Returns `null` for a motion type shipped content never authors, so a caller reports rather than
 * silently rendering a particle at the origin.
 */
export function particlePosition(
	motionType: number,
	spawn: ParticleSpawnConstants,
	parentOrigin: Vector3,
	t: number,
): Vector3 | null {
	const displacement = acDisplacement(motionType, spawn, t);
	if (displacement === null) return null;
	// The one conversion in the whole motion path. Everything above it is AC-axis arithmetic
	// transcribed from retail; everything below it is render space.
	const rendered = acVectorToRender(displacement);
	return [
		parentOrigin[0] + rendered[0],
		parentOrigin[1] + rendered[1],
		parentOrigin[2] + rendered[2],
	] as unknown as Vector3;
}

/**
 * Displacement from the parent origin at elapsed time `t`, in AC's authored axes.
 *
 * Component indices carry AC's meaning here: 0 is x, 1 is north, 2 is **up**. That is what lets the
 * asymmetric arms be transcribed from the decompile literally.
 */
function acDisplacement(
	motionType: number,
	spawn: ParticleSpawnConstants,
	t: number,
): AcVector3 | null {
	const { a, b, c, offset } = spawn;
	const ac = (x: number, y: number, z: number): AcVector3 =>
		[x, y, z] as unknown as AcVector3;

	switch (motionType) {
		case PARTICLE_TYPE.still:
			return offset;

		case PARTICLE_TYPE.localVelocity:
		case PARTICLE_TYPE.globalVelocity:
			return ac(
				offset[0] + a[0] * t,
				offset[1] + a[1] * t,
				offset[2] + a[2] * t,
			);

		// The `GR`/`LR` variants share this trajectory exactly; their spin is orientation-only,
		// applied to the draw frame rather than to the position.
		case PARTICLE_TYPE.parabolicLvga:
		case PARTICLE_TYPE.parabolicLvla:
		case PARTICLE_TYPE.parabolicGvga:
		case PARTICLE_TYPE.parabolicLvgaGr:
		case PARTICLE_TYPE.parabolicLvlaLr:
		case PARTICLE_TYPE.parabolicGvgaGr:
			return ac(
				offset[0] + a[0] * t + 0.5 * b[0] * t * t,
				offset[1] + a[1] * t + 0.5 * b[1] * t * t,
				offset[2] + a[2] * t + 0.5 * b[2] * t * t,
			);

		case PARTICLE_TYPE.swarm:
			// `sin` on AC's y, `cos` on AC's x and z. Deliberately not symmetric; do not "correct"
			// it, and do not evaluate it against converted vectors, which silently swaps which axis
			// gets the sine.
			return ac(
				offset[0] + Math.cos(b[0] * t) * c[0] + a[0] * t,
				offset[1] + Math.sin(b[1] * t) * c[1] + a[1] * t,
				offset[2] + Math.cos(b[2] * t) * c[2] + a[2] * t,
			);

		case PARTICLE_TYPE.explode:
			// Two authored quirks, both verified against the decompile and both reproduced on
			// purpose: every axis multiplies by `a[0]`, not its own component, and AC's z — up —
			// carries an extra `+ a[2]` inside the parenthesis. Content was tuned against these.
			return ac(
				offset[0] + (b[0] * t + c[0] * a[0]) * t,
				offset[1] + (b[1] * t + c[1] * a[0]) * t,
				offset[2] + (b[2] * t + c[2] * a[0] + a[2]) * t,
			);

		case PARTICLE_TYPE.implode: {
			// One scalar cosine, driven by `a[0]`, applied to all three axes.
			const wave = Math.cos(a[0] * t);
			return ac(
				offset[0] + wave * c[0] + b[0] * t * t,
				offset[1] + wave * c[1] + b[1] * t * t,
				offset[2] + wave * c[2] + b[2] * t * t,
			);
		}

		default:
			return null;
	}
}

/**
 * Fraction of its lifespan a particle has lived, clamped to 1.
 *
 * Retail clamps rather than wrapping (acclient.c:317650-317656), so a particle that outlives its
 * lifespan holds its final appearance instead of restarting it.
 */
export function particleLifeProgress(
	spawn: ParticleSpawnConstants,
	t: number,
): number {
	if (spawn.lifespan <= 0) return 1;
	return t < spawn.lifespan ? t / spawn.lifespan : 1;
}

/** Uniform scale at elapsed time `t`; retail writes one scalar to all three axes. */
export function particleScale(
	spawn: ParticleSpawnConstants,
	t: number,
): number {
	const progress = particleLifeProgress(spawn, t);
	return spawn.startScale + (spawn.finalScale - spawn.startScale) * progress;
}

/** Translucency at elapsed time `t`, on the same clamped progress as scale. */
export function particleTranslucency(
	spawn: ParticleSpawnConstants,
	t: number,
): number {
	const progress = particleLifeProgress(spawn, t);
	return (
		spawn.startTranslucency +
		(spawn.finalTranslucency - spawn.startTranslucency) * progress
	);
}
