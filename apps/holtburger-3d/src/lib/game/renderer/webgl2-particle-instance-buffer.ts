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

/** One physical particle batch contributing records to the shared frame stream. */
export interface ParticleInstancePopulation {
	readonly particles: readonly ParticleInstanceRecord[];
}

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
	#populatedInstanceCount = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		const buffer = gl.createBuffer();
		if (!buffer)
			throw new Error("Failed to allocate a particle instance buffer.");
		this.#gl = gl;
		this.#buffer = buffer;
	}

	/**
	 * Pack and upload every physical batch once, returning the complete frame population.
	 *
	 * Capacity grows by doubling and never shrinks: particle counts oscillate every frame, so
	 * releasing storage would reallocate almost immediately.
	 */
	prepareFrame(populations: readonly ParticleInstancePopulation[]): number {
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
		if (recordCount > this.#capacity) {
			while (this.#capacity < recordCount)
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
		this.#populatedInstanceCount = recordCount;
		if (recordCount === 0) return 0;
		let offset = 0;
		for (const population of populations) {
			for (const record of population.particles) {
				offset = writeParticleInstance(this.#staging, offset, record);
			}
		}
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
		this.#gl.bufferSubData(this.#gl.ARRAY_BUFFER, 0, this.#staging, 0, offset);
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
		return recordCount;
	}

	/** Point the bound vertex array at one contiguous range in the prepared frame stream. */
	bindAttributes(firstInstance: number): void {
		this.#requireAlive();
		if (
			!Number.isSafeInteger(firstInstance) ||
			firstInstance < 0 ||
			firstInstance > this.#populatedInstanceCount
		) {
			throw new Error(
				`Particle frame range starts at invalid instance ${firstInstance}.`,
			);
		}
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
		for (const attribute of PARTICLE_INSTANCE_ATTRIBUTES) {
			this.#gl.enableVertexAttribArray(attribute.location);
			this.#gl.vertexAttribPointer(
				attribute.location,
				attribute.componentCount,
				this.#gl.FLOAT,
				false,
				PARTICLE_INSTANCE_STRIDE_BYTES,
				firstInstance * PARTICLE_INSTANCE_STRIDE_BYTES +
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
