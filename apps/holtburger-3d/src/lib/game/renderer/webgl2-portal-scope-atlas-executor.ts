import {
	PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_OUTPUT_ARRIVAL_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_POSITION_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_SOURCE_SCOPE_OFFSET_BYTES,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
	PORTAL_QUAD_EXTENT_OFFSET_BYTES,
	PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
	PORTAL_QUAD_ORIGIN_OFFSET_BYTES,
	type PortalCrossingTriangleStreamView,
	type PortalPropagationExecutionScheduleView,
	type PortalPropagationMetadataStreamView,
} from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
	portalPropagationMetadataUsedByteLength,
} from "./portal-propagation-metadata";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	PORTAL_SCOPE_TILE_ATLAS_X_OFFSET_BYTES,
	PORTAL_SCOPE_TILE_ATLAS_Y_OFFSET_BYTES,
	PORTAL_SCOPE_TILE_HEIGHT_OFFSET_BYTES,
	PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
	PORTAL_SCOPE_TILE_WIDTH_OFFSET_BYTES,
} from "./portal-scope-tile-metadata";
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
const QUAD_ORIGIN_ATTRIBUTE_LOCATION = 0;
const QUAD_EXTENT_ATTRIBUTE_LOCATION = 1;

type SinkMethod<Name extends keyof PortalScopeAtlasWebGLSink> = Parameters<
	PortalScopeAtlasWebGLSink[Name]
>;

/** Complete non-retained input consumed synchronously by one scope-atlas execution. */
export interface WebGL2PortalScopeAtlasExecutionInput {
	/** Background clear color written by the root resolve pass at pixels owned by child portals. */
	readonly clearColor: readonly [number, number, number, number];
	/** External color/depth destination; null selects the drawing buffer. */
	readonly outputFramebuffer: WebGLFramebuffer | null;
	readonly outputExtent: RenderExtent;
	/** Arena-owned bytes remain valid for the duration of this call. */
	readonly stream: PortalCrossingTriangleStreamView &
		PortalPropagationMetadataStreamView &
		PortalPropagationExecutionScheduleView;
	readonly targets: WebGL2PortalScopeAtlasTargetSet;
	readonly traversalDepth: number;
}

/** Fixed GPU owner executing the proved allocation-free propagation/reduction/resolve loop. */
export class WebGL2PortalScopeAtlasExecutor implements PortalScopeAtlasWebGLSink {
	readonly #crossingBuffer: WebGLBuffer;
	readonly #crossingIndexBuffer: WebGLBuffer;
	readonly #crossingVertexArray: WebGLVertexArrayObject;
	readonly #gl: WebGL2RenderingContext;
	readonly #maximumCrossingIndexCount: number;
	readonly #maximumCrossingVertexCount: number;
	readonly #metadataBindingPoint: number;
	readonly #metadataBuffer: WebGLBuffer;
	readonly #programs: WebGL2PortalScopeAtlasPrograms;
	readonly #quadInstanceBuffer: WebGLBuffer;
	readonly #unboundedEnvelopeDepthTexture: WebGLTexture;
	readonly #unitQuadVertexArray: WebGLVertexArrayObject;
	readonly #clearDepth = new Float32Array(1);
	readonly #clearState = new Uint32Array(4);
	#activeInput: WebGL2PortalScopeAtlasExecutionInput | null = null;
	#boundArrayBuffer: "crossings" | "quads" | null = null;
	#boundFramebuffer:
		"dilation" | "envelope" | "frontier-0" | "frontier-1" | "output" = "output";
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
		this.#maximumCrossingIndexCount =
			PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth *
			maximumCrossingVertexCount;
		this.#metadataBindingPoint = metadataBindingPoint;

		let metadataBuffer: WebGLBuffer | null = null;
		let crossingBuffer: WebGLBuffer | null = null;
		let crossingIndexBuffer: WebGLBuffer | null = null;
		let quadInstanceBuffer: WebGLBuffer | null = null;
		let crossingVertexArray: WebGLVertexArrayObject | null = null;
		let unitQuadVertexArray: WebGLVertexArrayObject | null = null;
		let unboundedEnvelopeDepthTexture: WebGLTexture | null = null;
		let programs: WebGL2PortalScopeAtlasPrograms | null = null;
		const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
		const previousArrayBuffer = gl.getParameter(
			gl.ARRAY_BUFFER_BINDING,
		) as WebGLBuffer | null;
		const previousCopyWriteBuffer = gl.getParameter(
			gl.COPY_WRITE_BUFFER_BINDING,
		) as WebGLBuffer | null;
		const previousTexture2D = gl.getParameter(
			gl.TEXTURE_BINDING_2D,
		) as WebGLTexture | null;
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
			crossingIndexBuffer = requireBuffer(gl, "crossing index stream");
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
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, crossingIndexBuffer);
			gl.bufferData(
				gl.ELEMENT_ARRAY_BUFFER,
				this.#maximumCrossingIndexCount * Uint16Array.BYTES_PER_ELEMENT,
				gl.DYNAMIC_DRAW,
			);

			quadInstanceBuffer = requireBuffer(gl, "quad instance stream");
			unitQuadVertexArray = requireVertexArray(gl, "unit quad");
			gl.bindVertexArray(unitQuadVertexArray);
			gl.bindBuffer(gl.ARRAY_BUFFER, quadInstanceBuffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT * PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
				gl.DYNAMIC_DRAW,
			);
			configureQuadInstanceAttributes(gl);

			unboundedEnvelopeDepthTexture = createUnboundedEnvelopeDepthTexture(gl);
			programs = createWebGL2PortalScopeAtlasPrograms(gl, metadataBindingPoint);
		} catch (cause) {
			if (programs) destroyWebGL2PortalScopeAtlasPrograms(gl, programs);
			if (unboundedEnvelopeDepthTexture) {
				gl.deleteTexture(unboundedEnvelopeDepthTexture);
			}
			if (unitQuadVertexArray) gl.deleteVertexArray(unitQuadVertexArray);
			if (quadInstanceBuffer) gl.deleteBuffer(quadInstanceBuffer);
			if (crossingVertexArray) gl.deleteVertexArray(crossingVertexArray);
			if (crossingIndexBuffer) gl.deleteBuffer(crossingIndexBuffer);
			if (crossingBuffer) gl.deleteBuffer(crossingBuffer);
			if (metadataBuffer) gl.deleteBuffer(metadataBuffer);
			throw cause;
		} finally {
			gl.bindVertexArray(previousVertexArray);
			gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
			gl.bindBuffer(gl.COPY_WRITE_BUFFER, previousCopyWriteBuffer);
			gl.bindBuffer(gl.UNIFORM_BUFFER, previousUniformBuffer);
			gl.activeTexture(previousActiveTexture);
			gl.bindTexture(gl.TEXTURE_2D, previousTexture2D);
		}
		this.#metadataBuffer = metadataBuffer;
		this.#crossingBuffer = crossingBuffer;
		this.#crossingIndexBuffer = crossingIndexBuffer;
		this.#quadInstanceBuffer = quadInstanceBuffer;
		this.#crossingVertexArray = crossingVertexArray;
		this.#unitQuadVertexArray = unitQuadVertexArray;
		this.#unboundedEnvelopeDepthTexture = unboundedEnvelopeDepthTexture;
		this.#programs = programs;
	}

	/** Sampler-complete 1x1 depth placeholder bound when deferred passes short-circuit via UBO. */
	get unboundedEnvelopeDepthTexture(): WebGLTexture {
		this.#requireAlive();
		return this.#unboundedEnvelopeDepthTexture;
	}

	/** Upload and bind the metadata UBO directly when zero crossings bypass atlas targets. */
	bindDirectRootMetadata(stream: PortalPropagationMetadataStreamView): void {
		this.#requireAlive();
		if (this.#activeInput) {
			throw new Error("Portal scope-atlas execution cannot be re-entered.");
		}
		validateMetadataStream(stream);
		this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#metadataBuffer);
		this.#gl.bufferSubData(
			this.#gl.UNIFORM_BUFFER,
			0,
			stream.propagationMetadataBytes,
			0,
			stream.usedPropagationMetadataByteLength,
		);
		this.#gl.bindBufferBase(
			this.#gl.UNIFORM_BUFFER,
			this.#metadataBindingPoint,
			this.#metadataBuffer,
		);
		this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, null);
	}

	/** Execute directly from reusable arena views; no command or upload record is materialized. */
	execute(input: WebGL2PortalScopeAtlasExecutionInput): void {
		this.#requireAlive();
		if (this.#activeInput) {
			throw new Error("Portal scope-atlas execution cannot be re-entered.");
		}
		validateExecutionInput(
			input,
			this.#maximumCrossingVertexCount,
			this.#maximumCrossingIndexCount,
		);
		this.#activeInput = input;
		this.#boundArrayBuffer = null;
		try {
			const stream = input.stream;
			executePortalScopeAtlasWebGLCalls(this, {
				crossingIndexCount: stream.indexCount,
				crossingVertexCount: stream.vertexCount,
				metadataBindingPoint: this.#metadataBindingPoint,
				quadInstanceCount: stream.quadCount,
				renderDomainCount: stream.renderDomainMetadataStateCount,
				resolveQuadCount: stream.resolveQuadCount,
				resolveQuadOffset: stream.resolveQuadOffset,
				roundIndexCount: (round) => stream.roundIndexCount(round),
				roundIndexOffset: (round) => stream.roundIndexOffset(round),
				roundReductionQuadCount: (round) =>
					stream.roundReductionQuadCount(round),
				roundReductionQuadOffset: (round) =>
					stream.roundReductionQuadOffset(round),
				traversalDepth: input.traversalDepth,
			});
		} finally {
			this.#activeInput = null;
			this.#boundArrayBuffer = null;
		}
	}

	destroy(): void {
		if (this.#destroyed) return;
		if (this.#activeInput) {
			throw new Error("Cannot destroy an executing portal scope atlas.");
		}
		this.#destroyed = true;
		destroyWebGL2PortalScopeAtlasPrograms(this.#gl, this.#programs);
		this.#gl.deleteTexture(this.#unboundedEnvelopeDepthTexture);
		this.#gl.deleteVertexArray(this.#unitQuadVertexArray);
		this.#gl.deleteBuffer(this.#quadInstanceBuffer);
		this.#gl.deleteVertexArray(this.#crossingVertexArray);
		this.#gl.deleteBuffer(this.#crossingIndexBuffer);
		this.#gl.deleteBuffer(this.#crossingBuffer);
		this.#gl.deleteBuffer(this.#metadataBuffer);
	}

	bindBuffer(...[target, buffer]: SinkMethod<"bindBuffer">): void {
		const glTarget =
			target === "array"
				? this.#gl.ARRAY_BUFFER
				: target === "copy-write"
					? this.#gl.COPY_WRITE_BUFFER
					: this.#gl.UNIFORM_BUFFER;
		const handle =
			buffer === null
				? null
				: buffer === "crossings"
					? this.#crossingBuffer
					: buffer === "crossing-indices"
						? this.#crossingIndexBuffer
						: buffer === "quads"
							? this.#quadInstanceBuffer
							: this.#metadataBuffer;
		if (target === "array") {
			this.#boundArrayBuffer =
				buffer === "crossings" || buffer === "quads" ? buffer : null;
		}
		this.#gl.bindBuffer(glTarget, handle);
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
		if (target === "copy-write") {
			if (byteLength !== stream.usedIndexByteLength) {
				throw new Error(
					"Portal crossing index schedule disagrees with its arena view.",
				);
			}
			this.#gl.bufferSubData(
				this.#gl.COPY_WRITE_BUFFER,
				0,
				stream.indexBytes,
				0,
				byteLength,
			);
			return;
		}
		if (this.#boundArrayBuffer === "quads") {
			if (byteLength !== stream.usedQuadByteLength) {
				throw new Error("Portal quad schedule disagrees with its arena view.");
			}
			this.#gl.bufferSubData(
				this.#gl.ARRAY_BUFFER,
				0,
				stream.quadBytes,
				0,
				byteLength,
			);
			return;
		}
		if (
			this.#boundArrayBuffer !== "crossings" ||
			byteLength !== stream.usedByteLength
		) {
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
								: texture === "dilation-scratch"
									? targets.dilation.scratch
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
				: target === "dilation"
					? input.targets.dilation.framebuffer
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

	scissorTile(...[domain]: SinkMethod<"scissorTile">): void {
		const stream = this.#input().stream;
		if (
			!Number.isInteger(domain) ||
			domain < 0 ||
			domain >= stream.renderDomainMetadataStateCount
		) {
			throw new Error(
				`Portal scope-atlas tile scissor domain ${domain} is unavailable.`,
			);
		}
		const bytes = stream.propagationMetadataBytes;
		const baseOffset =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
			domain * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES;
		this.#gl.scissor(
			readUint32LittleEndian(
				bytes,
				baseOffset + PORTAL_SCOPE_TILE_ATLAS_X_OFFSET_BYTES,
			),
			readUint32LittleEndian(
				bytes,
				baseOffset + PORTAL_SCOPE_TILE_ATLAS_Y_OFFSET_BYTES,
			),
			readUint32LittleEndian(
				bytes,
				baseOffset + PORTAL_SCOPE_TILE_WIDTH_OFFSET_BYTES,
			),
			readUint32LittleEndian(
				bytes,
				baseOffset + PORTAL_SCOPE_TILE_HEIGHT_OFFSET_BYTES,
			),
		);
	}

	scissorRoundFrontier(...[round]: SinkMethod<"scissorRoundFrontier">): void {
		const stream = this.#input().stream;
		this.#gl.scissor(
			stream.roundFrontierScissorX(round),
			stream.roundFrontierScissorY(round),
			stream.roundFrontierScissorWidth(round),
			stream.roundFrontierScissorHeight(round),
		);
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
							: program === "dilation-horizontal"
								? this.#programs.dilationHorizontal
								: program === "dilation-vertical"
									? this.#programs.dilationVertical
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

	uniformResolveClearColor(): void {
		const [red, green, blue, alpha] = this.#input().clearColor;
		this.#gl.uniform4f(
			this.#programs.resolveUniforms.clearColor,
			red,
			green,
			blue,
			alpha,
		);
	}

	depthFunction(...[compare]: SinkMethod<"depthFunction">): void {
		this.#gl.depthFunc(
			compare === "always"
				? this.#gl.ALWAYS
				: compare === "greater"
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

	quadInstanceOffset(
		...[firstInstance]: SinkMethod<"quadInstanceOffset">
	): void {
		if (this.#boundArrayBuffer !== "quads") {
			throw new Error(
				"Portal scope-atlas quad instance offset requires the quad buffer.",
			);
		}
		const byteOffset = firstInstance * PORTAL_QUAD_INSTANCE_STRIDE_BYTES;
		this.#gl.vertexAttribIPointer(
			QUAD_ORIGIN_ATTRIBUTE_LOCATION,
			4,
			this.#gl.UNSIGNED_SHORT,
			PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
			byteOffset + PORTAL_QUAD_ORIGIN_OFFSET_BYTES,
		);
		this.#gl.vertexAttribIPointer(
			QUAD_EXTENT_ATTRIBUTE_LOCATION,
			4,
			this.#gl.UNSIGNED_SHORT,
			PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
			byteOffset + PORTAL_QUAD_EXTENT_OFFSET_BYTES,
		);
	}

	drawPropagation(
		...[output, indexOffset, indexCount]: SinkMethod<"drawPropagation">
	): void {
		this.#requireFramebuffer(`frontier-${output}`);
		this.#gl.drawElements(
			this.#gl.TRIANGLES,
			indexCount,
			this.#gl.UNSIGNED_SHORT,
			indexOffset * Uint16Array.BYTES_PER_ELEMENT,
		);
	}

	drawReduction(
		...[next, instanceCount, terminal]: SinkMethod<"drawReduction">
	): void {
		this.#requireFramebuffer("envelope");
		if (
			next !== this.#reductionRound % 2 ||
			terminal !== (this.#reductionRound + 1 === this.#traversalDepth)
		) {
			throw new Error("Portal scope-atlas reduction schedule is inconsistent.");
		}
		this.#gl.drawArraysInstanced(this.#gl.TRIANGLES, 0, 6, instanceCount);
	}

	drawDilationHorizontal(
		...[instanceCount]: SinkMethod<"drawDilationHorizontal">
	): void {
		this.#requireFramebuffer("dilation");
		this.#gl.drawArraysInstanced(this.#gl.TRIANGLES, 0, 6, instanceCount);
	}

	drawDilationVertical(
		...[instanceCount]: SinkMethod<"drawDilationVertical">
	): void {
		this.#requireFramebuffer("envelope");
		this.#gl.drawArraysInstanced(this.#gl.TRIANGLES, 0, 6, instanceCount);
	}

	drawResolve(...[instanceCount]: SinkMethod<"drawResolve">): void {
		this.#requireFramebuffer("output");
		this.#gl.drawArraysInstanced(this.#gl.TRIANGLES, 0, 6, instanceCount);
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
		expected: "dilation" | "envelope" | "frontier-0" | "frontier-1" | "output",
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
		maximumCrossingVertexCount < 3 ||
		maximumCrossingVertexCount > 0x1_0000
	) {
		throw new Error(
			"Portal scope-atlas GPU crossing capacity must contain one triangle within Uint16 index range.",
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
	maximumCrossingIndexCount: number,
): void {
	if (
		input.clearColor.length !== 4 ||
		!input.clearColor.every(Number.isFinite)
	) {
		throw new Error(
			"Portal scope-atlas clear color must contain 4 finite channels.",
		);
	}
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
		stream.usedByteLength > stream.bytes.byteLength ||
		stream.indexCount > maximumCrossingIndexCount ||
		stream.usedIndexByteLength !==
			stream.indexCount * Uint16Array.BYTES_PER_ELEMENT ||
		stream.usedIndexByteLength > stream.indexBytes.byteLength ||
		stream.quadCount > PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT ||
		stream.usedQuadByteLength !==
			stream.quadCount * PORTAL_QUAD_INSTANCE_STRIDE_BYTES ||
		stream.usedQuadByteLength > stream.quadBytes.byteLength
	) {
		throw new Error("Portal scope-atlas crossing stream is inconsistent.");
	}
	validateMetadataStream(stream);
}

function validateMetadataStream(
	stream: PortalPropagationMetadataStreamView,
): void {
	if (
		stream.arrivalMetadataStateCount < 1 ||
		stream.renderDomainMetadataStateCount < 1 ||
		stream.renderDomainMetadataStateCount > stream.arrivalMetadataStateCount ||
		stream.usedPropagationMetadataByteLength !==
			portalPropagationMetadataUsedByteLength(
				stream.renderDomainMetadataStateCount,
			) ||
		stream.propagationMetadataBytes.byteLength <
			stream.usedPropagationMetadataByteLength
	) {
		throw new Error("Portal scope-atlas metadata stream is inconsistent.");
	}
}

function readUint32LittleEndian(bytes: Uint8Array, byteOffset: number): number {
	return (
		(bytes[byteOffset]! |
			(bytes[byteOffset + 1]! << 8) |
			(bytes[byteOffset + 2]! << 16) |
			(bytes[byteOffset + 3]! << 24)) >>>
		0
	);
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

function configureQuadInstanceAttributes(gl: WebGL2RenderingContext): void {
	for (const [location, offset] of [
		[QUAD_ORIGIN_ATTRIBUTE_LOCATION, PORTAL_QUAD_ORIGIN_OFFSET_BYTES],
		[QUAD_EXTENT_ATTRIBUTE_LOCATION, PORTAL_QUAD_EXTENT_OFFSET_BYTES],
	] as const) {
		gl.enableVertexAttribArray(location);
		gl.vertexAttribIPointer(
			location,
			4,
			gl.UNSIGNED_SHORT,
			PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
			offset,
		);
		gl.vertexAttribDivisor(location, 1);
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

function createUnboundedEnvelopeDepthTexture(
	gl: WebGL2RenderingContext,
): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error(
			"Failed to allocate portal scope-atlas unbounded envelope texture.",
		);
	}
	try {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, 1, 1);
		return texture;
	} catch (cause) {
		gl.deleteTexture(texture);
		throw cause;
	}
}
