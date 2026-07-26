import { mat4ToFloat32Array } from "../math/matrices";
import {
	STATIC_INSTANCE_RECORD_FLOAT_COUNT,
	type StaticInstanceData,
} from "../systems/static-resources";

/** Fixed matrix-column locations consumed by the instanced object vertex program. */
const OBJECT_INSTANCE_MATRIX_ATTRIBUTE_LOCATIONS = [3, 4, 5, 6] as const;
/** Fixed color-modulation location consumed by the instanced object vertex program. */
const OBJECT_INSTANCE_COLOR_ATTRIBUTE_LOCATION = 7;
/** Float count in one object instance record: one matrix followed by one RGBA color. */
/** Byte stride shared by persistent and frame-streamed object instance buffers. */
export const OBJECT_INSTANCE_STRIDE_BYTES =
	STATIC_INSTANCE_RECORD_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;

/** Upload policy selected from the lifetime of the instance population. */
export type WebGL2InstanceBufferUsage = "persistent-static" | "frame-dynamic";

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
	readonly #usage: WebGL2InstanceBufferUsage;
	readonly #buffer: WebGLBuffer;
	#capacity = 0;
	#populatedInstanceCount = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext, usage: WebGL2InstanceBufferUsage) {
		const buffer = gl.createBuffer();
		if (!buffer)
			throw new Error(`Failed to allocate ${usage} instance buffer.`);
		this.#gl = gl;
		this.#usage = usage;
		this.#buffer = buffer;
	}

	/** Publish the complete immutable contents of a persistent buffer exactly once. */
	publishPersistent(instances: readonly StaticInstanceData[]): void {
		this.#requireUsage("persistent-static");
		if (this.#capacity !== 0 || this.#populatedInstanceCount !== 0) {
			throw new Error("Persistent instance buffer has already been published.");
		}
		const values = encodeObjectInstances(instances);
		this.#withBoundBuffer(() => {
			this.#gl.bufferData(this.#gl.ARRAY_BUFFER, values, this.#gl.STATIC_DRAW);
		});
		this.#capacity = instances.length;
		this.#populatedInstanceCount = instances.length;
	}

	/**
	 * Reset one frame/view allocation, growing geometrically and orphaning its complete storage.
	 */
	resetFrame(requiredInstanceCount: number): boolean {
		this.#requireUsage("frame-dynamic");
		requireNonNegativeInteger(requiredInstanceCount, "Required instance count");
		const previousCapacity = this.#capacity;
		while (this.#capacity < requiredInstanceCount) {
			this.#capacity = Math.max(1, this.#capacity * 2);
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
		instances: readonly StaticInstanceData[],
	): void {
		this.#requireAlive();
		requireNonNegativeInteger(firstInstance, "First instance");
		if (firstInstance + instances.length > this.#capacity) {
			throw new Error(
				`Instance update ${firstInstance}+${instances.length} exceeds capacity ${this.#capacity}.`,
			);
		}
		if (instances.length === 0) return;
		const values = encodeObjectInstances(instances);
		this.#withBoundBuffer(() => {
			this.#gl.bufferSubData(
				this.#gl.ARRAY_BUFFER,
				firstInstance * OBJECT_INSTANCE_STRIDE_BYTES,
				values,
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

	#requireUsage(expected: WebGL2InstanceBufferUsage): void {
		this.#requireAlive();
		if (this.#usage !== expected) {
			throw new Error(
				`${this.#usage} instance buffer cannot perform ${expected} storage operations.`,
			);
		}
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
	instances: readonly StaticInstanceData[],
): Float32Array {
	const values = new Float32Array(
		instances.length * STATIC_INSTANCE_RECORD_FLOAT_COUNT,
	);
	for (const [index, instance] of instances.entries()) {
		const offset = index * STATIC_INSTANCE_RECORD_FLOAT_COUNT;
		mat4ToFloat32Array(
			instance.sourceToLandblock,
			values.subarray(offset, offset + 16),
		);
		values.set(
			[instance.color.r, instance.color.g, instance.color.b, instance.color.a],
			offset + 16,
		);
	}
	return values;
}

function requireNonNegativeInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer.`);
	}
}
