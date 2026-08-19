import type {
	AcVector3,
	LandblockVector3,
	SceneVector3,
} from "../../assets/ac-frame";
/**
 * The record layout the particle vertex stage reads, and the writer that fills it.
 *
 * One record per particle, carrying **spawn constants only** — no evaluated position. The vertex
 * stage derives position, scale, and translucency from these constants plus the shared clock, so a
 * record is written once when its particle is born and read every frame after, and no per-frame
 * work scales with the live particle count.
 *
 * Attribute locations 3-8 of `webgl2-particle-program.ts`, in order:
 *
 * | Offset | Texel | Contents                                                      |
 * | -----: | ----: | ------------------------------------------------------------- |
 * |      0 |     0 | landblock-local spawn origin xyz, birth time                   |
 * |      4 |     1 | spawn offset xyz, lifespan                                     |
 * |      8 |     2 | sampled `a`, then `b.x`                                        |
 * |     12 |     3 | `b.yz`, `c.xy`                                                 |
 * |     16 |     4 | `c.z`, start/final scale, start translucency                   |
 * |     20 |     5 | final translucency, landblock scene origin xyz                 |
 */
export const PARTICLE_INSTANCE_FLOAT_COUNT = 24;

/**
 * Texels one record occupies in the record data texture.
 *
 * The record is padded up to whole RGBA texels so the vertex stage reads a fixed count per
 * particle; the spare lane in the final texel is reserved, not packed against.
 */
export const PARTICLE_RECORD_TEXELS = 6;

/**
 * Float offset of `birthTime` within a record.
 *
 * Named because a suspension shifts it in place on an already-written record, which is the one
 * field anything patches after spawn.
 */
export const PARTICLE_RECORD_BIRTH_TIME_FLOAT = 3;

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
	 * Spawn origin within its landblock, plus the hook offset.
	 *
	 * Split from {@link landblockOrigin} rather than carried as one scene or anchor-relative
	 * position, and the split is what makes a record survivable. Anchor-relative would decay the
	 * moment the camera crossed a landblock; a single scene-space position would be a number near
	 * 40,000 whose float32 difference against the anchor loses roughly 5 mm to cancellation. This
	 * part stays small and therefore precise, while the coarse part cancels exactly.
	 */
	readonly localOrigin: LandblockVector3;
	/**
	 * Scene-space origin of the landblock {@link localOrigin} is measured within.
	 *
	 * Always an exact multiple of the landblock size, as is the render anchor, so the vertex stage's
	 * `landblockOrigin - anchor` is exact in float32 rather than merely close.
	 */
	readonly landblockOrigin: SceneVector3;
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
 * Write one particle's record at `floatOffset`, returning the next free offset.
 *
 * Writes in place into a caller-owned buffer rather than allocating: the buffer is the persistent
 * slot store the GPU reads directly, so a record is written into its final home rather than copied
 * through an intermediate.
 */
export function writeParticleRecord(
	target: Float32Array,
	floatOffset: number,
	record: ParticleInstanceRecord,
): number {
	if (floatOffset + PARTICLE_INSTANCE_FLOAT_COUNT > target.length) {
		throw new Error(
			`Particle instance at ${floatOffset} exceeds a ${target.length}-float stream.`,
		);
	}
	target[floatOffset] = record.localOrigin[0];
	target[floatOffset + 1] = record.localOrigin[1];
	target[floatOffset + 2] = record.localOrigin[2];
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
	target[floatOffset + 21] = record.landblockOrigin[0];
	target[floatOffset + 22] = record.landblockOrigin[1];
	target[floatOffset + 23] = record.landblockOrigin[2];

	return floatOffset + PARTICLE_INSTANCE_FLOAT_COUNT;
}
