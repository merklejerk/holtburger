import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORD_TEXTURE_WIDTH,
	PARTICLE_RECORDS_PER_ROW,
	writeParticleInstance,
	type ParticleInstanceRecord,
} from "./particle-instance-stream";

/** RGBA32F carries four floats per texel. */
const FLOATS_PER_TEXEL = 4;

const FLOATS_PER_ROW = PARTICLE_RECORD_TEXTURE_WIDTH * FLOATS_PER_TEXEL;

/**
 * Reserved floats between a record's last written field and the end of its final texel.
 *
 * Records are texel-padded so the shader reads a fixed texel count per particle. The spare lane is
 * deliberately left unpacked; it is where a per-particle flag lands if one is ever needed.
 */
const PARTICLE_RECORD_PAD_FLOATS =
	PARTICLE_RECORD_TEXELS * FLOATS_PER_TEXEL - PARTICLE_INSTANCE_FLOAT_COUNT;

/** One physical particle batch contributing records to the shared frame store. */
export interface ParticleRecordPopulation {
	readonly particles: readonly ParticleInstanceRecord[];
}

/**
 * Storage for particle spawn constants, held in a data texture the vertex stage reads directly.
 *
 * A data texture rather than instance attributes because the draw path addresses *ranges* of
 * records: pointing six attribute pointers at a range costs about twenty GL calls, while a texture
 * range costs one `uInstanceBase` uniform and the draw. That difference is what lets the number of
 * drawn ranges rise without device-state churn overtaking the CPU work the change saves.
 */
export class WebGL2ParticleRecordStore {
	readonly #gl: WebGL2RenderingContext;
	readonly #texture: WebGLTexture;
	/** CPU mirror of the texture, in the exact layout the texture holds. */
	#mirror = new Float32Array(0);
	/** Capacity in records; grown by doubling and never released. */
	#capacity = 0;
	/** Rows currently allocated in the texture. */
	#rows = 0;
	#destroyed = false;
	#uploadedFloatCount = 0;

	constructor(gl: WebGL2RenderingContext) {
		const texture = gl.createTexture();
		if (!texture) {
			throw new Error("Failed to allocate a particle record texture.");
		}
		this.#gl = gl;
		this.#texture = texture;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		// `texelFetch` never filters, so nearest sampling is the honest declaration and keeps the
		// format clear of the float-filtering extension.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	get texture(): WebGLTexture {
		return this.#texture;
	}

	/** Floats uploaded by the most recent `prepareFrame`, for churn diagnostics. */
	get uploadedFloatCount(): number {
		return this.#uploadedFloatCount;
	}

	/**
	 * Pack and upload every physical batch once, returning the complete frame population.
	 *
	 * Capacity grows by doubling and never shrinks: particle counts oscillate every frame, so
	 * releasing storage would reallocate almost immediately.
	 */
	prepareFrame(populations: readonly ParticleRecordPopulation[]): number {
		this.#requireAlive();
		let recordCount = 0;
		for (const population of populations) {
			recordCount += population.particles.length;
		}
		if (!Number.isSafeInteger(recordCount)) {
			throw new Error(
				"Particle frame population exceeds safe integer capacity.",
			);
		}
		if (recordCount > this.#capacity) this.#grow(recordCount);
		this.#uploadedFloatCount = 0;
		if (recordCount === 0) return 0;
		let offset = 0;
		for (const population of populations) {
			for (const record of population.particles) {
				offset = writeParticleInstance(this.#mirror, offset, record);
				offset += PARTICLE_RECORD_PAD_FLOATS;
			}
		}
		const rowsUsed = Math.ceil(recordCount / PARTICLE_RECORDS_PER_ROW);
		const gl = this.#gl;
		gl.bindTexture(gl.TEXTURE_2D, this.#texture);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			0,
			PARTICLE_RECORD_TEXTURE_WIDTH,
			rowsUsed,
			gl.RGBA,
			gl.FLOAT,
			this.#mirror,
			0,
		);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.#uploadedFloatCount = rowsUsed * FLOATS_PER_ROW;
		return recordCount;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteTexture(this.#texture);
	}

	#grow(requiredRecords: number): void {
		while (this.#capacity < requiredRecords) {
			this.#capacity = Math.max(PARTICLE_RECORDS_PER_ROW, this.#capacity * 2);
		}
		this.#rows = Math.ceil(this.#capacity / PARTICLE_RECORDS_PER_ROW);
		this.#capacity = this.#rows * PARTICLE_RECORDS_PER_ROW;
		this.#mirror = new Float32Array(this.#rows * FLOATS_PER_ROW);
		const gl = this.#gl;
		gl.bindTexture(gl.TEXTURE_2D, this.#texture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA32F,
			PARTICLE_RECORD_TEXTURE_WIDTH,
			this.#rows,
			0,
			gl.RGBA,
			gl.FLOAT,
			null,
		);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	#requireAlive(): void {
		if (this.#destroyed) {
			throw new Error("Particle record store has been destroyed.");
		}
	}
}
