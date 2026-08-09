import {
	PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
} from "./portal-arrival-metadata";
import type { PortalArrivalMetadataStreamView } from "./portal-crossing-triangle-stream";

/** Fixed WebGL2 uniform-buffer owner for root and directed-crossing arrival records. */
export class WebGL2PortalArrivalMetadataBuffer {
	readonly #buffer: WebGLBuffer;
	readonly #gl: WebGL2RenderingContext;
	readonly #maximumBindingCount: number;
	#destroyed = false;
	#uploadedStateCount = 0;

	constructor(gl: WebGL2RenderingContext) {
		const maximumBlockBytes = requirePositiveLimit(
			gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
			"MAX_UNIFORM_BLOCK_SIZE",
		);
		if (maximumBlockBytes < PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES) {
			throw new Error(
				`Portal arrival metadata requires ${PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES} uniform bytes, but this device exposes ${maximumBlockBytes}.`,
			);
		}
		this.#maximumBindingCount = requirePositiveLimit(
			gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
			"MAX_UNIFORM_BUFFER_BINDINGS",
		);
		const buffer = gl.createBuffer();
		if (!buffer) {
			throw new Error("Failed to allocate portal arrival metadata buffer.");
		}
		this.#buffer = buffer;
		this.#gl = gl;
		const previous = gl.getParameter(
			gl.UNIFORM_BUFFER_BINDING,
		) as WebGLBuffer | null;
		try {
			gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
			gl.bufferData(
				gl.UNIFORM_BUFFER,
				PORTAL_ARRIVAL_METADATA_CAPACITY_BYTES,
				gl.DYNAMIC_DRAW,
			);
		} catch (cause) {
			gl.deleteBuffer(buffer);
			throw cause;
		} finally {
			gl.bindBuffer(gl.UNIFORM_BUFFER, previous);
		}
	}

	/** Upload the populated root/crossing prefix without reallocating or slicing staging storage. */
	upload(stream: PortalArrivalMetadataStreamView): void {
		this.#requireAlive();
		const expectedByteLength =
			stream.arrivalMetadataStateCount * PORTAL_ARRIVAL_METADATA_RECORD_BYTES;
		if (
			stream.arrivalMetadataStateCount < 1 ||
			stream.arrivalMetadataStateCount > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT ||
			stream.usedArrivalMetadataByteLength !== expectedByteLength ||
			expectedByteLength > stream.arrivalMetadataBytes.byteLength
		) {
			throw new Error(
				"Portal arrival metadata upload does not match its populated state count.",
			);
		}
		try {
			this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffer);
			this.#gl.bufferSubData(
				this.#gl.UNIFORM_BUFFER,
				0,
				stream.arrivalMetadataBytes,
				0,
				expectedByteLength,
			);
		} finally {
			this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, null);
		}
		this.#uploadedStateCount = stream.arrivalMetadataStateCount;
	}

	/** Bind the already uploaded metadata to one shader-owned uniform-block binding point. */
	bindBase(bindingPoint: number): void {
		this.#requireAlive();
		if (
			!Number.isInteger(bindingPoint) ||
			bindingPoint < 0 ||
			bindingPoint >= this.#maximumBindingCount
		) {
			throw new Error(
				`Portal arrival metadata binding ${bindingPoint} is outside this device's binding range.`,
			);
		}
		if (this.#uploadedStateCount === 0) {
			throw new Error("Portal arrival metadata has not been uploaded.");
		}
		this.#gl.bindBufferBase(
			this.#gl.UNIFORM_BUFFER,
			bindingPoint,
			this.#buffer,
		);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteBuffer(this.#buffer);
	}

	#requireAlive(): void {
		if (this.#destroyed) {
			throw new Error("Portal arrival metadata buffer has been destroyed.");
		}
	}
}

function requirePositiveLimit(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`WebGL2 ${name} must be a positive integer.`);
	}
	return value;
}
