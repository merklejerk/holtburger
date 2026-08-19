import type { AcVector3, RenderVector3 } from "../../assets/ac-frame";
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
 * |      8 | `aMotionA`      | sampled `a`                                     |
 * |     11 | `aMotionB`      | sampled `b`                                     |
 * |     14 | `aMotionC`      | sampled `c`                                     |
 * |     17 | `aAppearance`   | start/final scale, start/final translucency     |
 */
export const PARTICLE_INSTANCE_FLOAT_COUNT = 21;

/**
 * Texels one record occupies in the record data texture.
 *
 * The record is padded up to whole RGBA texels so the vertex stage reads a fixed count per
 * particle; the spare lane in the final texel is reserved, not packed against.
 */
export const PARTICLE_RECORD_TEXELS = 6;

/**
 * Records per row of the record data texture.
 *
 * A whole number of records per row, so a record never straddles rows: that keeps the vertex
 * stage's index maths to two integer ops and keeps any partial upload to whole rows.
 */
export const PARTICLE_RECORDS_PER_ROW = 256;

/** Record-texture width in texels. Shared by the writer and the vertex stage that reads it. */
export const PARTICLE_RECORD_TEXTURE_WIDTH =
	PARTICLE_RECORDS_PER_ROW * PARTICLE_RECORD_TEXELS;

/** Everything one particle contributes to the instance stream. */
export interface ParticleInstanceRecord {
	/**
	 * Parent origin plus hook offset, resolved at spawn or read live for a following emitter.
	 *
	 * Anchor-relative, unlike the motion constants below: this is a scene position, and the vertex
	 * stage adds the evaluated displacement to it after converting that displacement out of AC axes.
	 */
	readonly origin: RenderVector3;
	readonly birthTime: number;
	/**
	 * Spawn constants in **AC's authored axes**, matching {@link ParticleSpawnConstants}.
	 *
	 * The vertex stage evaluates the motion laws in this space and converts once, because Swarm and
	 * Explode read axis meaning from the component index and cannot be converted componentwise.
	 */
	readonly offset: AcVector3;
	readonly lifespan: number;
	readonly a: AcVector3;
	readonly b: AcVector3;
	readonly c: AcVector3;
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
