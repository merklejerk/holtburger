import {
	PORTAL_CROSSING_TRIANGLE_DEPTH_POLICY_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_OUTPUT_ARRIVAL_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_POSITION_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_SOURCE_SCOPE_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	type PortalCrossingTriangleStreamView,
} from "./portal-crossing-triangle-stream";

const POSITION_ATTRIBUTE_LOCATION = 0;
const OUTPUT_ARRIVAL_ATTRIBUTE_LOCATION = 1;
const SOURCE_SCOPE_ATTRIBUTE_LOCATION = 2;
const DEPTH_POLICY_ATTRIBUTE_LOCATION = 3;

/** Fixed GPU owner for the crossing stream uploaded once and drawn once per propagation round. */
export class WebGL2PortalCrossingTriangleBuffer {
	readonly #buffer: WebGLBuffer;
	readonly #gl: WebGL2RenderingContext;
	readonly #maximumTriangleVertexCount: number;
	readonly #vertexArray: WebGLVertexArrayObject;
	#destroyed = false;
	#uploadedVertexCount = 0;

	constructor(gl: WebGL2RenderingContext, maximumTriangleVertexCount: number) {
		if (
			!Number.isSafeInteger(maximumTriangleVertexCount) ||
			maximumTriangleVertexCount < 3
		) {
			throw new Error(
				"Portal crossing GPU stream capacity must contain at least one triangle.",
			);
		}
		const buffer = gl.createBuffer();
		if (!buffer) {
			throw new Error("Failed to allocate portal crossing triangle buffer.");
		}
		const vertexArray = gl.createVertexArray();
		if (!vertexArray) {
			gl.deleteBuffer(buffer);
			throw new Error(
				"Failed to allocate portal crossing triangle vertex array.",
			);
		}
		this.#buffer = buffer;
		this.#gl = gl;
		this.#maximumTriangleVertexCount = maximumTriangleVertexCount;
		this.#vertexArray = vertexArray;

		const previousArrayBuffer = gl.getParameter(
			gl.ARRAY_BUFFER_BINDING,
		) as WebGLBuffer | null;
		const previousVertexArray = gl.getParameter(
			gl.VERTEX_ARRAY_BINDING,
		) as WebGLVertexArrayObject | null;
		try {
			gl.bindVertexArray(vertexArray);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				maximumTriangleVertexCount *
					PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
				gl.DYNAMIC_DRAW,
			);
			gl.enableVertexAttribArray(POSITION_ATTRIBUTE_LOCATION);
			gl.vertexAttribPointer(
				POSITION_ATTRIBUTE_LOCATION,
				3,
				gl.FLOAT,
				false,
				PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
				PORTAL_CROSSING_TRIANGLE_POSITION_OFFSET_BYTES,
			);
			for (const [location, offset] of [
				[
					OUTPUT_ARRIVAL_ATTRIBUTE_LOCATION,
					PORTAL_CROSSING_TRIANGLE_OUTPUT_ARRIVAL_OFFSET_BYTES,
				],
				[
					SOURCE_SCOPE_ATTRIBUTE_LOCATION,
					PORTAL_CROSSING_TRIANGLE_SOURCE_SCOPE_OFFSET_BYTES,
				],
				[
					DEPTH_POLICY_ATTRIBUTE_LOCATION,
					PORTAL_CROSSING_TRIANGLE_DEPTH_POLICY_OFFSET_BYTES,
				],
			] as const) {
				gl.enableVertexAttribArray(location);
				gl.vertexAttribIPointer(
					location,
					1,
					gl.UNSIGNED_INT,
					PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
					offset,
				);
			}
		} catch (cause) {
			gl.deleteBuffer(buffer);
			gl.deleteVertexArray(vertexArray);
			throw cause;
		} finally {
			gl.bindVertexArray(previousVertexArray);
			gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
		}
	}

	/** Upload the initialized byte prefix without reallocating GPU storage or slicing CPU storage. */
	upload(stream: PortalCrossingTriangleStreamView): void {
		this.#requireAlive();
		if (stream.vertexCount > this.#maximumTriangleVertexCount) {
			throw new Error(
				`Portal crossing upload ${stream.vertexCount} exceeds GPU capacity ${this.#maximumTriangleVertexCount}.`,
			);
		}
		const expectedByteLength =
			stream.vertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES;
		if (
			stream.usedByteLength !== expectedByteLength ||
			stream.usedByteLength > stream.bytes.byteLength
		) {
			throw new Error(
				"Portal crossing upload byte length does not match its vertex stream.",
			);
		}
		if (stream.usedByteLength === 0) {
			this.#uploadedVertexCount = 0;
			return;
		}
		try {
			this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
			this.#gl.bufferSubData(
				this.#gl.ARRAY_BUFFER,
				0,
				stream.bytes,
				0,
				stream.usedByteLength,
			);
		} finally {
			this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
		}
		this.#uploadedVertexCount = stream.vertexCount;
	}

	/** Submit the same uploaded stream once for the current propagation round. */
	draw(): void {
		this.#requireAlive();
		if (this.#uploadedVertexCount === 0) return;
		try {
			this.#gl.bindVertexArray(this.#vertexArray);
			this.#gl.drawArrays(this.#gl.TRIANGLES, 0, this.#uploadedVertexCount);
		} finally {
			this.#gl.bindVertexArray(null);
		}
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteBuffer(this.#buffer);
		this.#gl.deleteVertexArray(this.#vertexArray);
	}

	#requireAlive(): void {
		if (this.#destroyed) {
			throw new Error("Portal crossing triangle buffer has been destroyed.");
		}
	}
}
