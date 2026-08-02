import { writeMat4ToFloat32Array } from "../math/matrices";
import {
	OBJECT_INSTANCE_RECORD_BYTES,
	OBJECT_INSTANCE_RECORD_FLOAT_COUNT,
	type ObjectInstanceData,
} from "../systems/static-resources";

/** Fixed matrix-column locations consumed by the instanced object vertex program. */
const OBJECT_INSTANCE_MATRIX_ATTRIBUTE_LOCATIONS = [3, 4, 5, 6] as const;
/** Fixed color-modulation location consumed by the instanced object vertex program. */
const OBJECT_INSTANCE_COLOR_ATTRIBUTE_LOCATION = 7;
/** Byte stride shared by every frame-streamed object instance range. */
export const OBJECT_INSTANCE_STRIDE_BYTES = OBJECT_INSTANCE_RECORD_BYTES;

/** Complete read-only binding needed to submit an instance-buffer range. */
export interface WebGL2InstanceBufferBinding {
	readonly buffer: WebGLBuffer;
	/** Number of instance records currently backed by allocated storage. */
	readonly capacity: number;
	/** Number of initialized records available to draw. */
	readonly populatedInstanceCount: number;
	readonly strideBytes: number;
}

/** Low-level WebGL2 owner for one object-instance buffer and its explicit storage contract. */
export class WebGL2InstanceBuffer {
	readonly #gl: WebGL2RenderingContext;
	readonly #buffer: WebGLBuffer;
	/** Reusable CPU staging storage whose record capacity tracks the GPU buffer. */
	#encodedInstances = new Float32Array(0);
	#capacity = 0;
	#populatedInstanceCount = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		const buffer = gl.createBuffer();
		if (!buffer) throw new Error("Failed to allocate frame instance buffer.");
		this.#gl = gl;
		this.#buffer = buffer;
	}

	/**
	 * Reset one frame/view allocation, growing geometrically and orphaning its complete storage.
	 */
	resetFrame(requiredInstanceCount: number): boolean {
		this.#requireAlive();
		requireNonNegativeInteger(requiredInstanceCount, "Required instance count");
		const previousCapacity = this.#capacity;
		while (this.#capacity < requiredInstanceCount) {
			this.#capacity = Math.max(1, this.#capacity * 2);
		}
		if (this.#capacity !== previousCapacity) {
			this.#encodedInstances = new Float32Array(
				this.#capacity * OBJECT_INSTANCE_RECORD_FLOAT_COUNT,
			);
		}
		this.#withBoundBuffer(() => {
			this.#gl.bufferData(
				this.#gl.ARRAY_BUFFER,
				this.#capacity * OBJECT_INSTANCE_STRIDE_BYTES,
				this.#gl.STREAM_DRAW,
			);
		});
		this.#populatedInstanceCount = 0;
		return this.#capacity !== previousCapacity;
	}

	/** Upload a contiguous range without reallocating or changing instance-record layout. */
	updateRange(
		firstInstance: number,
		instances: readonly ObjectInstanceData[],
	): void {
		this.#requireAlive();
		requireNonNegativeInteger(firstInstance, "First instance");
		if (firstInstance + instances.length > this.#capacity) {
			throw new Error(
				`Instance update ${firstInstance}+${instances.length} exceeds capacity ${this.#capacity}.`,
			);
		}
		if (instances.length === 0) return;
		const firstFloat = firstInstance * OBJECT_INSTANCE_RECORD_FLOAT_COUNT;
		const floatCount = instances.length * OBJECT_INSTANCE_RECORD_FLOAT_COUNT;
		encodeObjectInstancesInto(instances, this.#encodedInstances, firstFloat);
		this.#withBoundBuffer(() => {
			this.#gl.bufferSubData(
				this.#gl.ARRAY_BUFFER,
				firstInstance * OBJECT_INSTANCE_STRIDE_BYTES,
				this.#encodedInstances,
				firstFloat,
				floatCount,
			);
		});
		this.#populatedInstanceCount = Math.max(
			this.#populatedInstanceCount,
			firstInstance + instances.length,
		);
	}

	getBinding(): WebGL2InstanceBufferBinding {
		this.#requireAlive();
		return {
			buffer: this.#buffer,
			capacity: this.#capacity,
			populatedInstanceCount: this.#populatedInstanceCount,
			strideBytes: OBJECT_INSTANCE_STRIDE_BYTES,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteBuffer(this.#buffer);
	}

	#requireAlive(): void {
		if (this.#destroyed) throw new Error("Instance buffer has been destroyed.");
	}

	#withBoundBuffer(action: () => void): void {
		this.#requireAlive();
		try {
			this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
			action();
		} finally {
			this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
		}
	}
}

/** Configure every matrix/color attribute for one explicit instance-buffer range. */
export function bindWebGL2ObjectInstanceRange(
	gl: WebGL2RenderingContext,
	binding: WebGL2InstanceBufferBinding,
	firstInstance: number,
	instanceCount: number,
): void {
	requireNonNegativeInteger(firstInstance, "First instance");
	requireNonNegativeInteger(instanceCount, "Instance count");
	if (firstInstance + instanceCount > binding.populatedInstanceCount) {
		throw new Error(
			`Instance draw ${firstInstance}+${instanceCount} exceeds populated count ${binding.populatedInstanceCount}.`,
		);
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, binding.buffer);
	const baseOffset = firstInstance * binding.strideBytes;
	for (const [
		column,
		location,
	] of OBJECT_INSTANCE_MATRIX_ATTRIBUTE_LOCATIONS.entries()) {
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(
			location,
			4,
			gl.FLOAT,
			false,
			binding.strideBytes,
			baseOffset + column * 4 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.vertexAttribDivisor(location, 1);
	}
	gl.enableVertexAttribArray(OBJECT_INSTANCE_COLOR_ATTRIBUTE_LOCATION);
	gl.vertexAttribPointer(
		OBJECT_INSTANCE_COLOR_ATTRIBUTE_LOCATION,
		4,
		gl.FLOAT,
		false,
		binding.strideBytes,
		baseOffset + 16 * Float32Array.BYTES_PER_ELEMENT,
	);
	gl.vertexAttribDivisor(OBJECT_INSTANCE_COLOR_ATTRIBUTE_LOCATION, 1);
}

/** Encode typed instance facts into the single backend record layout. */
export function encodeObjectInstances(
	instances: readonly ObjectInstanceData[],
): Float32Array {
	const values = new Float32Array(
		instances.length * OBJECT_INSTANCE_RECORD_FLOAT_COUNT,
	);
	encodeObjectInstancesInto(instances, values, 0);
	return values;
}

/** Write instance records at a caller-owned offset without allocating transient views. */
function encodeObjectInstancesInto(
	instances: readonly ObjectInstanceData[],
	values: Float32Array,
	firstFloat: number,
): void {
	for (let index = 0; index < instances.length; index += 1) {
		const instance = instances[index];
		const offset = firstFloat + index * OBJECT_INSTANCE_RECORD_FLOAT_COUNT;
		writeMat4ToFloat32Array(instance.sourceToLandblock, values, offset);
		values[offset + 16] = instance.color.r;
		values[offset + 17] = instance.color.g;
		values[offset + 18] = instance.color.b;
		values[offset + 19] = instance.color.a;
	}
}

function requireNonNegativeInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer.`);
	}
}
