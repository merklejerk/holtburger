import {
	PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_OUTPUT_ARRIVAL_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_POSITION_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_SOURCE_SCOPE_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	type PortalCrossingTriangleStreamView,
	type PortalPropagationMetadataStreamView,
} from "./portal-crossing-triangle-stream";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	executePortalScopeAtlasWebGLCalls,
	type PortalScopeAtlasWebGLSink,
} from "./portal-scope-atlas-command-model";
import type { WebGL2PortalScopeAtlasTargetSet } from "./webgl2-portal-scope-atlas-targets";
import type { RenderExtent } from "./render-extent";
import {
	createWebGL2PortalScopeAtlasPrograms,
	destroyWebGL2PortalScopeAtlasPrograms,
	type WebGL2PortalScopeAtlasPrograms,
} from "./webgl2-portal-scope-atlas-programs";

const POSITION_ATTRIBUTE_LOCATION = 0;
const OUTPUT_ARRIVAL_ATTRIBUTE_LOCATION = 1;
const SOURCE_SCOPE_ATTRIBUTE_LOCATION = 2;
const POLICY_ATTRIBUTE_LOCATION = 3;

type SinkMethod<Name extends keyof PortalScopeAtlasWebGLSink> = Parameters<
	PortalScopeAtlasWebGLSink[Name]
>;

/** Complete non-retained input consumed synchronously by one scope-atlas execution. */
export interface WebGL2PortalScopeAtlasExecutionInput {
	/** External color/depth destination; null selects the drawing buffer. */
	readonly outputFramebuffer: WebGLFramebuffer | null;
	readonly outputExtent: RenderExtent;
	/** Arena-owned bytes remain valid for the duration of this call. */
	readonly stream: PortalCrossingTriangleStreamView &
		PortalPropagationMetadataStreamView;
	readonly targets: WebGL2PortalScopeAtlasTargetSet;
	readonly traversalDepth: number;
}

/** Fixed GPU owner executing the proved allocation-free propagation/reduction/resolve loop. */
export class WebGL2PortalScopeAtlasExecutor implements PortalScopeAtlasWebGLSink {
	readonly #crossingBuffer: WebGLBuffer;
	readonly #crossingVertexArray: WebGLVertexArrayObject;
	readonly #gl: WebGL2RenderingContext;
	readonly #maximumCrossingVertexCount: number;
	readonly #metadataBindingPoint: number;
	readonly #metadataBuffer: WebGLBuffer;
	readonly #programs: WebGL2PortalScopeAtlasPrograms;
	readonly #unitQuadVertexArray: WebGLVertexArrayObject;
	readonly #clearDepth = new Float32Array(1);
	readonly #clearState = new Uint32Array(4);
	#activeInput: WebGL2PortalScopeAtlasExecutionInput | null = null;
	#boundFramebuffer: "envelope" | "frontier-0" | "frontier-1" | "output" =
		"output";
	#destroyed = false;
	#reductionRound = -1;
	#traversalDepth = -1;

	constructor(
		gl: WebGL2RenderingContext,
		maximumCrossingVertexCount: number,
		metadataBindingPoint: number,
	) {
		validateConstructorInput(
			gl,
			maximumCrossingVertexCount,
			metadataBindingPoint,
		);
		this.#gl = gl;
		this.#maximumCrossingVertexCount = maximumCrossingVertexCount;
		this.#metadataBindingPoint = metadataBindingPoint;

		let metadataBuffer: WebGLBuffer | null = null;
		let crossingBuffer: WebGLBuffer | null = null;
		let crossingVertexArray: WebGLVertexArrayObject | null = null;
		let unitQuadVertexArray: WebGLVertexArrayObject | null = null;
		let programs: WebGL2PortalScopeAtlasPrograms | null = null;
		const previousArrayBuffer = gl.getParameter(
			gl.ARRAY_BUFFER_BINDING,
		) as WebGLBuffer | null;
		const previousUniformBuffer = gl.getParameter(
			gl.UNIFORM_BUFFER_BINDING,
		) as WebGLBuffer | null;
		const previousVertexArray = gl.getParameter(
			gl.VERTEX_ARRAY_BINDING,
		) as WebGLVertexArrayObject | null;
		try {
			metadataBuffer = requireBuffer(gl, "metadata");
			gl.bindBuffer(gl.UNIFORM_BUFFER, metadataBuffer);
			gl.bufferData(
				gl.UNIFORM_BUFFER,
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
				gl.DYNAMIC_DRAW,
			);

			crossingBuffer = requireBuffer(gl, "crossing stream");
			crossingVertexArray = requireVertexArray(gl, "crossing stream");
			gl.bindVertexArray(crossingVertexArray);
			gl.bindBuffer(gl.ARRAY_BUFFER, crossingBuffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				maximumCrossingVertexCount *
					PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
				gl.DYNAMIC_DRAW,
			);
			configureCrossingAttributes(gl);

			unitQuadVertexArray = requireVertexArray(gl, "unit quad");
			programs = createWebGL2PortalScopeAtlasPrograms(gl, metadataBindingPoint);
		} catch (cause) {
			if (programs) destroyWebGL2PortalScopeAtlasPrograms(gl, programs);
			if (unitQuadVertexArray) gl.deleteVertexArray(unitQuadVertexArray);
			if (crossingVertexArray) gl.deleteVertexArray(crossingVertexArray);
			if (crossingBuffer) gl.deleteBuffer(crossingBuffer);
			if (metadataBuffer) gl.deleteBuffer(metadataBuffer);
			throw cause;
		} finally {
			gl.bindVertexArray(previousVertexArray);
			gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
			gl.bindBuffer(gl.UNIFORM_BUFFER, previousUniformBuffer);
		}
		this.#metadataBuffer = metadataBuffer;
		this.#crossingBuffer = crossingBuffer;
		this.#crossingVertexArray = crossingVertexArray;
		this.#unitQuadVertexArray = unitQuadVertexArray;
		this.#programs = programs;
	}

	/** Execute directly from reusable arena views; no command or upload record is materialized. */
	execute(input: WebGL2PortalScopeAtlasExecutionInput): void {
		this.#requireAlive();
		if (this.#activeInput) {
			throw new Error("Portal scope-atlas execution cannot be re-entered.");
		}
		validateExecutionInput(input, this.#maximumCrossingVertexCount);
		this.#activeInput = input;
		try {
			executePortalScopeAtlasWebGLCalls(this, {
				crossingVertexCount: input.stream.vertexCount,
				metadataBindingPoint: this.#metadataBindingPoint,
				renderDomainCount: input.stream.renderDomainMetadataStateCount,
				traversalDepth: input.traversalDepth,
			});
		} finally {
			this.#activeInput = null;
		}
	}

	destroy(): void {
		if (this.#destroyed) return;
		if (this.#activeInput) {
			throw new Error("Cannot destroy an executing portal scope atlas.");
		}
		this.#destroyed = true;
		destroyWebGL2PortalScopeAtlasPrograms(this.#gl, this.#programs);
		this.#gl.deleteVertexArray(this.#unitQuadVertexArray);
		this.#gl.deleteVertexArray(this.#crossingVertexArray);
		this.#gl.deleteBuffer(this.#crossingBuffer);
		this.#gl.deleteBuffer(this.#metadataBuffer);
	}

	bindBuffer(...[target, buffer]: SinkMethod<"bindBuffer">): void {
		this.#gl.bindBuffer(
			target === "array" ? this.#gl.ARRAY_BUFFER : this.#gl.UNIFORM_BUFFER,
			buffer === null
				? null
				: buffer === "crossings"
					? this.#crossingBuffer
					: this.#metadataBuffer,
		);
	}

	bindBufferBase(
		...[bindingPoint, buffer]: SinkMethod<"bindBufferBase">
	): void {
		if (buffer !== "metadata") {
			throw new Error("Portal scope-atlas has no indexed non-metadata buffer.");
		}
		this.#gl.bindBufferBase(
			this.#gl.UNIFORM_BUFFER,
			bindingPoint,
			this.#metadataBuffer,
		);
	}

	bufferSubData(...[target, byteLength]: SinkMethod<"bufferSubData">): void {
		const stream = this.#input().stream;
		if (target === "uniform") {
			if (byteLength !== stream.usedPropagationMetadataByteLength) {
				throw new Error(
					"Portal metadata schedule disagrees with its arena view.",
				);
			}
			this.#gl.bufferSubData(
				this.#gl.UNIFORM_BUFFER,
				0,
				stream.propagationMetadataBytes,
				0,
				byteLength,
			);
			return;
		}
		if (byteLength !== stream.usedByteLength) {
			throw new Error(
				"Portal crossing schedule disagrees with its arena view.",
			);
		}
		this.#gl.bufferSubData(
			this.#gl.ARRAY_BUFFER,
			0,
			stream.bytes,
			0,
			byteLength,
		);
	}

	activeTexture(...[unit]: SinkMethod<"activeTexture">): void {
		this.#gl.activeTexture(this.#gl.TEXTURE0 + unit);
	}

	bindTexture2D(...[texture]: SinkMethod<"bindTexture2D">): void {
		const targets = this.#input().targets;
		const handle =
			texture === "frontier-0-state"
				? targets.frontiers[0].state
				: texture === "frontier-1-state"
					? targets.frontiers[1].state
					: texture === "frontier-depth"
						? targets.frontierDepth
						: texture === "scene-color"
							? targets.scene.color
							: texture === "scene-depth"
								? targets.scene.depth
								: targets.envelope.depth;
		this.#gl.bindTexture(this.#gl.TEXTURE_2D, handle);
	}

	bindSampler(...[unit, sampler]: SinkMethod<"bindSampler">): void {
		this.#gl.bindSampler(unit, sampler);
	}

	setCapability(...[capability, enabled]: SinkMethod<"setCapability">): void {
		const glCapability =
			capability === "blend"
				? this.#gl.BLEND
				: capability === "cull-face"
					? this.#gl.CULL_FACE
					: capability === "depth-test"
						? this.#gl.DEPTH_TEST
						: capability === "polygon-offset-fill"
							? this.#gl.POLYGON_OFFSET_FILL
							: capability === "scissor-test"
								? this.#gl.SCISSOR_TEST
								: this.#gl.STENCIL_TEST;
		if (enabled) this.#gl.enable(glCapability);
		else this.#gl.disable(glCapability);
	}

	colorMask(...[write]: SinkMethod<"colorMask">): void {
		this.#gl.colorMask(write, write, write, write);
	}

	depthMask(...[write]: SinkMethod<"depthMask">): void {
		this.#gl.depthMask(write);
	}

	bindFramebuffer(...[target]: SinkMethod<"bindFramebuffer">): void {
		const input = this.#input();
		const framebuffer =
			target === "output"
				? input.outputFramebuffer
				: target === "envelope"
					? input.targets.envelope.framebuffer
					: target === "frontier-0"
						? input.targets.frontiers[0].framebuffer
						: input.targets.frontiers[1].framebuffer;
		this.#gl.bindFramebuffer(this.#gl.DRAW_FRAMEBUFFER, framebuffer);
		this.#boundFramebuffer = target;
	}

	viewport(...[target]: SinkMethod<"viewport">): void {
		const input = this.#input();
		const extent =
			target === "atlas"
				? input.targets.extents.atlas
				: target === "drawing-buffer"
					? input.targets.extents.drawingBuffer
					: input.outputExtent;
		this.#gl.viewport(0, 0, extent.width, extent.height);
	}

	clearEnvelopeDepth(...[depth]: SinkMethod<"clearEnvelopeDepth">): void {
		this.#clearDepth[0] = depth;
		this.#gl.clearBufferfv(this.#gl.DEPTH, 0, this.#clearDepth);
	}

	clearFrontierState(...[target]: SinkMethod<"clearFrontierState">): void {
		this.#requireFramebuffer(`frontier-${target}`);
		this.#gl.clearBufferuiv(this.#gl.COLOR, 0, this.#clearState);
	}

	clearFrontierDepth(...[depth]: SinkMethod<"clearFrontierDepth">): void {
		this.#clearDepth[0] = depth;
		this.#gl.clearBufferfv(this.#gl.DEPTH, 0, this.#clearDepth);
	}

	useProgram(...[program]: SinkMethod<"useProgram">): void {
		const handle =
			program === "propagation-root"
				? this.#programs.propagationRoot
				: program === "propagation-from-0"
					? this.#programs.propagationFrom0
					: program === "propagation-from-1"
						? this.#programs.propagationFrom1
						: program === "reduction"
							? this.#programs.reduction
							: this.#programs.resolve;
		this.#gl.useProgram(handle);
	}

	uniformReductionDepth(...[depth]: SinkMethod<"uniformReductionDepth">): void {
		this.#gl.uniform1i(this.#programs.reductionUniforms.traversalDepth, depth);
		this.#traversalDepth = depth;
	}

	uniformReductionRound(...[round]: SinkMethod<"uniformReductionRound">): void {
		this.#gl.uniform1i(this.#programs.reductionUniforms.round, round);
		this.#reductionRound = round;
	}

	depthFunction(...[compare]: SinkMethod<"depthFunction">): void {
		this.#gl.depthFunc(
			compare === "greater"
				? this.#gl.GREATER
				: compare === "less-equal"
					? this.#gl.LEQUAL
					: this.#gl.LESS,
		);
	}

	bindVertexArray(...[vertexArray]: SinkMethod<"bindVertexArray">): void {
		this.#gl.bindVertexArray(
			vertexArray === "crossings"
				? this.#crossingVertexArray
				: this.#unitQuadVertexArray,
		);
	}

	drawPropagation(
		...[output, vertexCount]: SinkMethod<"drawPropagation">
	): void {
		this.#requireFramebuffer(`frontier-${output}`);
		this.#gl.drawArrays(this.#gl.TRIANGLES, 0, vertexCount);
	}

	drawReduction(
		...[next, renderDomainCount, terminal]: SinkMethod<"drawReduction">
	): void {
		this.#requireFramebuffer("envelope");
		if (
			next !== this.#reductionRound % 2 ||
			terminal !== (this.#reductionRound + 1 === this.#traversalDepth)
		) {
			throw new Error("Portal scope-atlas reduction schedule is inconsistent.");
		}
		this.#gl.drawArraysInstanced(this.#gl.TRIANGLES, 0, 6, renderDomainCount);
	}

	drawResolve(...[renderDomainCount]: SinkMethod<"drawResolve">): void {
		this.#requireFramebuffer("output");
		this.#gl.drawArraysInstanced(this.#gl.TRIANGLES, 0, 6, renderDomainCount);
	}

	#input(): WebGL2PortalScopeAtlasExecutionInput {
		if (!this.#activeInput) {
			throw new Error("Portal scope-atlas sink has no active execution input.");
		}
		return this.#activeInput;
	}

	#requireAlive(): void {
		if (this.#destroyed) {
			throw new Error("Portal scope-atlas executor has been destroyed.");
		}
	}

	#requireFramebuffer(
		expected: "envelope" | "frontier-0" | "frontier-1" | "output",
	): void {
		if (this.#boundFramebuffer !== expected) {
			throw new Error(
				`Portal scope-atlas expected ${expected}, found ${this.#boundFramebuffer}.`,
			);
		}
	}
}

function validateConstructorInput(
	gl: WebGL2RenderingContext,
	maximumCrossingVertexCount: number,
	metadataBindingPoint: number,
): void {
	if (
		!Number.isSafeInteger(maximumCrossingVertexCount) ||
		maximumCrossingVertexCount < 3
	) {
		throw new Error(
			"Portal scope-atlas GPU crossing capacity must contain one triangle.",
		);
	}
	const maximumBlockBytes = gl.getParameter(
		gl.MAX_UNIFORM_BLOCK_SIZE,
	) as number;
	if (maximumBlockBytes < PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES) {
		throw new Error(
			`Portal scope-atlas metadata requires ${PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES} bytes, but this device exposes ${maximumBlockBytes}.`,
		);
	}
	const maximumBindings = gl.getParameter(
		gl.MAX_UNIFORM_BUFFER_BINDINGS,
	) as number;
	if (
		!Number.isInteger(metadataBindingPoint) ||
		metadataBindingPoint < 0 ||
		metadataBindingPoint >= maximumBindings
	) {
		throw new Error(
			`Portal scope-atlas metadata binding ${metadataBindingPoint} is outside this device's binding range.`,
		);
	}
}

function validateExecutionInput(
	input: WebGL2PortalScopeAtlasExecutionInput,
	maximumCrossingVertexCount: number,
): void {
	const stream = input.stream;
	if (
		input.outputExtent.width !== input.targets.extents.drawingBuffer.width ||
		input.outputExtent.height !== input.targets.extents.drawingBuffer.height
	) {
		throw new Error(
			"Portal scope-atlas output extent must match its drawing-buffer frontier.",
		);
	}
	if (
		!Number.isInteger(input.traversalDepth) ||
		input.traversalDepth < 0 ||
		input.traversalDepth > PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth
	) {
		throw new Error("Portal scope-atlas traversal depth exceeds its policy.");
	}
	if (
		stream.vertexCount > maximumCrossingVertexCount ||
		stream.usedByteLength !==
			stream.vertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES ||
		stream.usedByteLength > stream.bytes.byteLength
	) {
		throw new Error("Portal scope-atlas crossing stream is inconsistent.");
	}
	if (
		stream.usedPropagationMetadataByteLength !==
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES ||
		stream.propagationMetadataBytes.byteLength <
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES ||
		stream.arrivalMetadataStateCount < 1 ||
		stream.renderDomainMetadataStateCount < 1 ||
		stream.renderDomainMetadataStateCount > stream.arrivalMetadataStateCount
	) {
		throw new Error("Portal scope-atlas metadata stream is inconsistent.");
	}
}

function configureCrossingAttributes(gl: WebGL2RenderingContext): void {
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
		[POLICY_ATTRIBUTE_LOCATION, PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES],
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
}

function requireBuffer(gl: WebGL2RenderingContext, owner: string): WebGLBuffer {
	const buffer = gl.createBuffer();
	if (!buffer) {
		throw new Error(`Failed to allocate portal scope-atlas ${owner} buffer.`);
	}
	return buffer;
}

function requireVertexArray(
	gl: WebGL2RenderingContext,
	owner: string,
): WebGLVertexArrayObject {
	const vertexArray = gl.createVertexArray();
	if (!vertexArray) {
		throw new Error(
			`Failed to allocate portal scope-atlas ${owner} vertex array.`,
		);
	}
	return vertexArray;
}
