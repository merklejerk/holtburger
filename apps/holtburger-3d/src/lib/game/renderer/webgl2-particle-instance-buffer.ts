import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	writeParticleInstance,
	type ParticleInstanceRecord,
} from "./particle-instance-stream";

const PARTICLE_INSTANCE_STRIDE_BYTES =
	PARTICLE_INSTANCE_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;

/** Attribute locations 3-8, matching the particle vertex stage's declarations. */
const PARTICLE_INSTANCE_ATTRIBUTES = [
	{ componentCount: 4, floatOffset: 0, location: 3 },
	{ componentCount: 4, floatOffset: 4, location: 4 },
	{ componentCount: 3, floatOffset: 8, location: 5 },
	{ componentCount: 3, floatOffset: 11, location: 6 },
	{ componentCount: 3, floatOffset: 14, location: 7 },
	{ componentCount: 4, floatOffset: 17, location: 8 },
] as const;

/**
 * Per-frame instance storage for particle spawn constants.
 *
 * Separate from `WebGL2InstanceBuffer` because the two record layouts differ in more than length:
 * that one encodes a matrix plus a color, this one encodes spawn constants the vertex stage
 * integrates. Collapsing them behind a generic encoder is recorded as cleanup debt rather than
 * done here, because the shared part is only capacity growth and upload.
 */
export class WebGL2ParticleInstanceBuffer {
	readonly #gl: WebGL2RenderingContext;
	readonly #buffer: WebGLBuffer;
	#staging = new Float32Array(0);
	#capacity = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		const buffer = gl.createBuffer();
		if (!buffer)
			throw new Error("Failed to allocate a particle instance buffer.");
		this.#gl = gl;
		this.#buffer = buffer;
	}

	/**
	 * Upload one cohort's particles, returning how many instances to draw.
	 *
	 * Capacity grows by doubling and never shrinks: particle counts oscillate every frame, so
	 * releasing storage would reallocate almost immediately.
	 */
	upload(records: readonly ParticleInstanceRecord[]): number {
		this.#requireAlive();
		if (records.length > this.#capacity) {
			while (this.#capacity < records.length)
				this.#capacity = Math.max(16, this.#capacity * 2);
			this.#staging = new Float32Array(
				this.#capacity * PARTICLE_INSTANCE_FLOAT_COUNT,
			);
			this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
			this.#gl.bufferData(
				this.#gl.ARRAY_BUFFER,
				this.#capacity * PARTICLE_INSTANCE_STRIDE_BYTES,
				this.#gl.DYNAMIC_DRAW,
			);
			this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
		}
		if (records.length === 0) return 0;
		let offset = 0;
		for (const record of records) {
			offset = writeParticleInstance(this.#staging, offset, record);
		}
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
		this.#gl.bufferSubData(this.#gl.ARRAY_BUFFER, 0, this.#staging, 0, offset);
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
		return records.length;
	}

	/** Point the bound vertex array at this buffer's per-instance attributes. */
	bindAttributes(): void {
		this.#requireAlive();
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
		for (const attribute of PARTICLE_INSTANCE_ATTRIBUTES) {
			this.#gl.enableVertexAttribArray(attribute.location);
			this.#gl.vertexAttribPointer(
				attribute.location,
				attribute.componentCount,
				this.#gl.FLOAT,
				false,
				PARTICLE_INSTANCE_STRIDE_BYTES,
				attribute.floatOffset * Float32Array.BYTES_PER_ELEMENT,
			);
			this.#gl.vertexAttribDivisor(attribute.location, 1);
		}
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteBuffer(this.#buffer);
	}

	#requireAlive(): void {
		if (this.#destroyed)
			throw new Error("Particle instance buffer is destroyed.");
	}
}
