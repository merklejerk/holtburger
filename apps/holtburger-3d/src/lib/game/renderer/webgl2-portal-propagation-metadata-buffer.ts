import {
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
} from "./portal-arrival-metadata";
import type { PortalPropagationMetadataStreamView } from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES } from "./portal-scope-tile-metadata";

/** Fixed WebGL2 uniform-buffer owner for arrival routes and selected scope-tile records. */
export class WebGL2PortalPropagationMetadataBuffer {
	readonly #buffer: WebGLBuffer;
	readonly #gl: WebGL2RenderingContext;
	readonly #maximumBindingCount: number;
	#destroyed = false;
	#uploaded = false;

	constructor(gl: WebGL2RenderingContext) {
		const maximumBlockBytes = requirePositiveLimit(
			gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
			"MAX_UNIFORM_BLOCK_SIZE",
		);
		if (maximumBlockBytes < PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES) {
			throw new Error(
				`Portal propagation metadata requires ${PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES} uniform bytes, but this device exposes ${maximumBlockBytes}.`,
			);
		}
		this.#maximumBindingCount = requirePositiveLimit(
			gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
			"MAX_UNIFORM_BUFFER_BINDINGS",
		);
		const buffer = gl.createBuffer();
		if (!buffer) {
			throw new Error("Failed to allocate portal propagation metadata buffer.");
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
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
				gl.DYNAMIC_DRAW,
			);
		} catch (cause) {
			gl.deleteBuffer(buffer);
			throw cause;
		} finally {
			gl.bindBuffer(gl.UNIFORM_BUFFER, previous);
		}
	}

	/** Upload one combined prefix, accepting bounded unused arrival slots to save one driver call. */
	upload(stream: PortalPropagationMetadataStreamView): void {
		this.#requireAlive();
		const expectedByteLength =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
			stream.scopeMetadataStateCount * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES;
		if (
			stream.arrivalMetadataStateCount < 1 ||
			stream.arrivalMetadataStateCount > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT ||
			stream.scopeMetadataStateCount < 1 ||
			stream.scopeMetadataStateCount > stream.arrivalMetadataStateCount ||
			stream.usedPropagationMetadataByteLength !== expectedByteLength ||
			expectedByteLength > stream.propagationMetadataBytes.byteLength ||
			stream.arrivalMetadataStateCount * PORTAL_ARRIVAL_METADATA_RECORD_BYTES >
				PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES
		) {
			throw new Error(
				"Portal propagation metadata upload does not match its populated state counts.",
			);
		}
		try {
			this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffer);
			this.#gl.bufferSubData(
				this.#gl.UNIFORM_BUFFER,
				0,
				stream.propagationMetadataBytes,
				0,
				expectedByteLength,
			);
		} finally {
			this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, null);
		}
		this.#uploaded = true;
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
				`Portal propagation metadata binding ${bindingPoint} is outside this device's binding range.`,
			);
		}
		if (!this.#uploaded) {
			throw new Error("Portal propagation metadata has not been uploaded.");
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
			throw new Error("Portal propagation metadata buffer has been destroyed.");
		}
	}
}

function requirePositiveLimit(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`WebGL2 ${name} must be a positive integer.`);
	}
	return value;
}
