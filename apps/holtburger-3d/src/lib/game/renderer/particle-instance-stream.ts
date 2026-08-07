import type { RenderVector3 } from "../../assets/ac-frame";
/**
 * Packs live particles into the per-instance layout the particle vertex stage declares.
 *
 * One record per particle, carrying **spawn constants only** — no evaluated position. The vertex
 * stage derives position, scale, and translucency from these constants plus the shared clock, which
 * is what keeps per-particle CPU work at emission and expiry bookkeeping regardless of how many
 * particles are live.
 *
 * Attribute locations 3-8 of `webgl2-particle-program.ts`, in order:
 *
 * | Offset | Attribute       | Contents                                        |
 * | -----: | --------------- | ----------------------------------------------- |
 * |      0 | `aOriginBirth`  | spawn origin xyz, birth time                    |
 * |      4 | `aOffsetLife`   | spawn offset xyz, lifespan                      |
 * |      8 | `aMotionA`      | rolled `a`                                      |
 * |     11 | `aMotionB`      | rolled `b`                                      |
 * |     14 | `aMotionC`      | rolled `c`                                      |
 * |     17 | `aAppearance`   | start/final scale, start/final translucency     |
 */
export const PARTICLE_INSTANCE_FLOAT_COUNT = 21;

/** Everything one particle contributes to the instance stream. */
export interface ParticleInstanceRecord {
	/** Parent origin plus hook offset, resolved at spawn or read live for a following emitter. */
	readonly origin: RenderVector3;
	readonly birthTime: number;
	readonly offset: RenderVector3;
	readonly lifespan: number;
	readonly a: RenderVector3;
	readonly b: RenderVector3;
	readonly c: RenderVector3;
	readonly startScale: number;
	readonly finalScale: number;
	readonly startTranslucency: number;
	readonly finalTranslucency: number;
}

/**
 * Write one particle's instance record at `floatOffset`, returning the next free offset.
 *
 * Writes in place into a caller-owned buffer rather than allocating, because this runs per particle
 * per frame and allocation here would be pure GC churn in the renderer's hot path.
 */
export function writeParticleInstance(
	target: Float32Array,
	floatOffset: number,
	record: ParticleInstanceRecord,
): number {
	if (floatOffset + PARTICLE_INSTANCE_FLOAT_COUNT > target.length) {
		throw new Error(
			`Particle instance at ${floatOffset} exceeds a ${target.length}-float stream.`,
		);
	}
	target[floatOffset] = record.origin[0];
	target[floatOffset + 1] = record.origin[1];
	target[floatOffset + 2] = record.origin[2];
	target[floatOffset + 3] = record.birthTime;

	target[floatOffset + 4] = record.offset[0];
	target[floatOffset + 5] = record.offset[1];
	target[floatOffset + 6] = record.offset[2];
	target[floatOffset + 7] = record.lifespan;

	target[floatOffset + 8] = record.a[0];
	target[floatOffset + 9] = record.a[1];
	target[floatOffset + 10] = record.a[2];

	target[floatOffset + 11] = record.b[0];
	target[floatOffset + 12] = record.b[1];
	target[floatOffset + 13] = record.b[2];

	target[floatOffset + 14] = record.c[0];
	target[floatOffset + 15] = record.c[1];
	target[floatOffset + 16] = record.c[2];

	target[floatOffset + 17] = record.startScale;
	target[floatOffset + 18] = record.finalScale;
	target[floatOffset + 19] = record.startTranslucency;
	target[floatOffset + 20] = record.finalTranslucency;

	return floatOffset + PARTICLE_INSTANCE_FLOAT_COUNT;
}
