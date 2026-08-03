import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";
import type { PortalViewWindow } from "./portal-view-window";

const COLOR_BYTES_PER_PIXEL = 4;
const DEPTH_STENCIL_BYTES_PER_PIXEL = 4;
/** Maximum render-layer label supported by the WebGL stencil attachment. */
export const MAXIMUM_PORTAL_RENDER_LAYER = 0xff;
/** Depth offset used only when an authored visible surface shares the portal aperture plane. */
const COPLANAR_PORTAL_MASK_DEPTH_OFFSET = { factor: 1, units: 1 } as const;

/** Resident-depth comparison selected by the planner-owned mask source. */
export type PortalMaskDepthCompare =
	"always" | "less-or-equal" | "less-or-equal-offset";
/** Positive drawing-buffer extent owned by one scene-domain target generation. */
export interface PortalRenderExtent {
	readonly height: number;
	readonly width: number;
}

/** One color/depth-stencil framebuffer owning the completed portal view. */
export interface WebGL2SceneDomainTarget {
	readonly color: WebGLTexture;
	readonly depthStencil: WebGLTexture;
	readonly extent: PortalRenderExtent;
	readonly framebuffer: WebGLFramebuffer;
}

/** Consumed lifecycle facts for browser fixtures and later renderer diagnostics. */
export interface WebGL2PortalSubstrateDiagnostics {
	readonly activeBytes: number;
	readonly activeTargetCount: number;
	readonly allocatedTargetCount: number;
	readonly disposedTargetCount: number;
	readonly extent: PortalRenderExtent | null;
}

/** One stencil transition supported by a portal mask rasterization pass. */
export type PortalMaskStencilPolicy =
	| {
			/** Replace passing pixels without requiring existing stencil ownership. */
			readonly kind: "replace";
			readonly value: number;
	  }
	| {
			/** Promote pixels from one planner-owned label to its adjacent suffix label. */
			readonly from: number;
			readonly kind: "promote-if-equal";
			readonly to: number;
	  };

/** Fixed-function pass baselines established without inspecting ambient renderer state. */
export type PortalPassStateCommand =
	| {
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer | null;
			readonly kind: "clear";
	  }
	| {
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer | null;
			readonly kind: "ordinary";
	  }
	| {
			readonly depthCompare: PortalMaskDepthCompare;
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "mask-write";
			readonly stencilPolicy: PortalMaskStencilPolicy;
	  }
	| {
			readonly depth: number;
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "masked-depth-reset";
			readonly renderLayer: number;
	  }
	| {
			readonly depth: number;
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "masked-scene-initialize";
			readonly renderLayer: number;
	  }
	| {
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "masked-ordinary";
			readonly renderLayer: number;
	  };

/** Apply one complete portal/ordinary fixed-function baseline. */
export function applyPortalPassState(
	gl: WebGL2RenderingContext,
	command: PortalPassStateCommand,
): void {
	validateExtent(command.extent);
	gl.bindFramebuffer(gl.FRAMEBUFFER, command.framebuffer);
	gl.viewport(0, 0, command.extent.width, command.extent.height);
	gl.disable(gl.BLEND);
	gl.disable(gl.CULL_FACE);
	gl.disable(gl.POLYGON_OFFSET_FILL);
	gl.disable(gl.SCISSOR_TEST);
	if (command.kind === "clear" || command.kind === "ordinary") {
		gl.colorMask(true, true, true, true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		gl.disable(gl.STENCIL_TEST);
		gl.stencilMask(MAXIMUM_PORTAL_RENDER_LAYER);
		if (command.kind === "ordinary") {
			gl.clearDepth(1);
			gl.clearStencil(0);
		}
		return;
	}
	if (command.kind === "mask-write") {
		gl.colorMask(false, false, false, false);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(command.depthCompare === "always" ? gl.ALWAYS : gl.LEQUAL);
		gl.depthMask(false);
		if (command.depthCompare === "less-or-equal-offset") {
			gl.enable(gl.POLYGON_OFFSET_FILL);
			gl.polygonOffset(
				COPLANAR_PORTAL_MASK_DEPTH_OFFSET.factor,
				COPLANAR_PORTAL_MASK_DEPTH_OFFSET.units,
			);
		}
		gl.enable(gl.STENCIL_TEST);
		gl.stencilMask(MAXIMUM_PORTAL_RENDER_LAYER);
		if (command.stencilPolicy.kind === "replace") {
			requireMaskStencilValue(command.stencilPolicy.value);
			gl.stencilFunc(
				gl.ALWAYS,
				command.stencilPolicy.value,
				MAXIMUM_PORTAL_RENDER_LAYER,
			);
			gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
		} else {
			requireMaskStencilValue(command.stencilPolicy.from);
			requireMaskStencilValue(command.stencilPolicy.to);
			if (command.stencilPolicy.to !== command.stencilPolicy.from + 1) {
				throw new Error(
					"Portal stencil promotion must target the adjacent label.",
				);
			}
			gl.stencilFunc(
				gl.EQUAL,
				command.stencilPolicy.from,
				MAXIMUM_PORTAL_RENDER_LAYER,
			);
			gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
		}
		return;
	}
	if (
		command.kind === "masked-depth-reset" ||
		command.kind === "masked-scene-initialize"
	) {
		requireStencilValue(command.renderLayer);
		if (!isNormalized(command.depth)) {
			throw new Error(
				"Portal masked scene depth must be a finite value from 0 through 1.",
			);
		}
		const writesColor = command.kind === "masked-scene-initialize";
		gl.colorMask(writesColor, writesColor, writesColor, writesColor);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.ALWAYS);
		gl.depthMask(true);
		gl.enable(gl.STENCIL_TEST);
		gl.stencilMask(0);
		gl.stencilFunc(gl.EQUAL, command.renderLayer, MAXIMUM_PORTAL_RENDER_LAYER);
		gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
		return;
	}
	if (command.kind === "masked-ordinary") {
		requireStencilValue(command.renderLayer);
		gl.colorMask(true, true, true, true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		gl.enable(gl.STENCIL_TEST);
		gl.stencilMask(0);
		gl.stencilFunc(gl.EQUAL, command.renderLayer, MAXIMUM_PORTAL_RENDER_LAYER);
		gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
		return;
	}
	assertNever(command);
}

/**
 * Lazy renderer-owned mechanics for portal masks and direct scene-domain ownership.
 *
 * Construction allocates no GPU resources. Targets and programs appear only when portal execution
 * or the explicit browser fixture first requests them.
 */
export class WebGL2PortalSubstrate {
	readonly #gl: WebGL2RenderingContext;
	#allocatedTargetCount = 0;
	#disposedTargetCount = 0;
	#destroyed = false;
	#maskProgram: MaskProgram | null = null;
	#maskedSceneProgram: MaskedSceneProgram | null = null;
	#target: WebGL2SceneDomainTarget | null = null;
	#windowMaskProgram: WindowMaskProgram | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	resize(extent: PortalRenderExtent): WebGL2SceneDomainTarget {
		this.#assertAlive();
		validateExtent(extent);
		if (
			this.#target?.extent.width === extent.width &&
			this.#target.extent.height === extent.height
		) {
			return this.#target;
		}
		const replacement = this.#allocateTarget(extent);
		const previous = this.#target;
		this.#target = replacement;
		if (previous) this.#disposeTarget(previous);
		return replacement;
	}

	getTarget(): WebGL2SceneDomainTarget {
		this.#assertAlive();
		if (!this.#target) {
			throw new Error("Portal scene-domain target has no render extent.");
		}
		return this.#target;
	}

	clearTarget(
		target: WebGL2SceneDomainTarget,
		color: readonly [number, number, number, number],
		depth: number,
		stencil: number,
	): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		requireNormalizedColor(color, "Portal target clear color");
		if (!isNormalized(depth)) {
			throw new Error(
				"Portal target clear depth must be a finite value from 0 through 1.",
			);
		}
		requireStencilValue(stencil);
		const gl = this.#gl;
		applyPortalPassState(gl, {
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "clear",
		});
		gl.clearColor(color[0], color[1], color[2], color[3]);
		gl.clearDepth(depth);
		gl.clearStencil(stencil);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	writeLayerMask(
		target: WebGL2SceneDomainTarget,
		geometry: WebGL2GeometryBinding,
		indexStart: number,
		indexCount: number,
		clipFromLocal: Float32Array,
		stencilPolicy: PortalMaskStencilPolicy,
		depthCompare: PortalMaskDepthCompare,
	): void {
		this.#drawMask(
			{
				depthCompare,
				kind: "mask-write",
				stencilPolicy,
			},
			target,
			geometry,
			indexStart,
			indexCount,
			clipFromLocal,
		);
	}

	/**
	 * Transfer ownership of exact straddle rays without consulting resident depth.
	 *
	 * The retained NDC window already confines the mask to aperture-crossing rays. Testing
	 * resident depth here would let resident floor or terrain veto the adjacent domain precisely
	 * where the near-clipped world aperture cannot provide an ordinary depth-tested boundary.
	 */
	writeLayerWindowMask(
		target: WebGL2SceneDomainTarget,
		window: PortalViewWindow,
		stencilPolicy: PortalMaskStencilPolicy,
	): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		const vertices = triangulatePortalViewWindow(window);
		const program = this.#requireWindowMaskProgram();
		const gl = this.#gl;
		applyPortalPassState(gl, {
			depthCompare: "always",
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "mask-write",
			stencilPolicy,
		});
		gl.useProgram(program.program);
		gl.bindVertexArray(program.vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, program.positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
		gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
	}

	/** Establish an ordinary scene pass on one owned offscreen target. */
	beginTargetPass(target: WebGL2SceneDomainTarget): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		applyPortalPassState(this.#gl, {
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "ordinary",
		});
	}

	/** Establish ordinary color/depth drawing constrained by one completed mask intersection. */
	beginMaskedPass(target: WebGL2SceneDomainTarget, renderLayer: number): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		applyPortalPassState(this.#gl, {
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "masked-ordinary",
			renderLayer,
		});
	}

	/** Replace depth inside an established mask without changing color or stencil. */
	resetMaskedDepth(
		target: WebGL2SceneDomainTarget,
		renderLayer: number,
		depth: number,
	): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		const program = this.#requireMaskedSceneProgram();
		const gl = this.#gl;
		applyPortalPassState(gl, {
			depth,
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "masked-depth-reset",
			renderLayer,
		});
		gl.useProgram(program.program);
		gl.uniform1f(program.depth, depth);
		gl.bindVertexArray(program.vertexArray);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	/** Replace clear color and depth inside one completed label without changing stencil. */
	initializeMaskedScene(
		target: WebGL2SceneDomainTarget,
		renderLayer: number,
		color: readonly [number, number, number, number],
		depth: number,
	): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		requireNormalizedColor(color, "Portal masked scene color");
		const program = this.#requireMaskedSceneProgram();
		const gl = this.#gl;
		applyPortalPassState(gl, {
			depth,
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "masked-scene-initialize",
			renderLayer,
		});
		gl.useProgram(program.program);
		gl.uniform4f(program.color, color[0], color[1], color[2], color[3]);
		gl.uniform1f(program.depth, depth);
		gl.bindVertexArray(program.vertexArray);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	present(
		source: WebGL2SceneDomainTarget,
		destination: WebGLFramebuffer | null,
		destinationExtent: PortalRenderExtent,
	): void {
		this.#assertAlive();
		requireTarget(this.#target, source);
		validateExtent(destinationExtent);
		const gl = this.#gl;
		applyPortalPassState(gl, {
			extent: destinationExtent,
			framebuffer: destination,
			kind: "ordinary",
		});
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
		gl.blitFramebuffer(
			0,
			0,
			source.extent.width,
			source.extent.height,
			0,
			0,
			destinationExtent.width,
			destinationExtent.height,
			gl.COLOR_BUFFER_BIT,
			gl.NEAREST,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
	}

	restoreOrdinaryPass(
		framebuffer: WebGLFramebuffer | null,
		extent: PortalRenderExtent,
	): void {
		this.#assertAlive();
		const gl = this.#gl;
		applyPortalPassState(gl, { extent, framebuffer, kind: "ordinary" });
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.useProgram(null);
		gl.bindVertexArray(null);
	}

	getDiagnostics(): WebGL2PortalSubstrateDiagnostics {
		const extent = this.#target?.extent ?? null;
		return {
			activeBytes:
				extent === null
					? 0
					: extent.width *
						extent.height *
						(COLOR_BYTES_PER_PIXEL + DEPTH_STENCIL_BYTES_PER_PIXEL),
			activeTargetCount: this.#target ? 1 : 0,
			allocatedTargetCount: this.#allocatedTargetCount,
			disposedTargetCount: this.#disposedTargetCount,
			extent: extent ? { ...extent } : null,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (this.#target) {
			this.#disposeTarget(this.#target);
			this.#target = null;
		}
		if (this.#maskProgram) {
			this.#gl.deleteProgram(this.#maskProgram.program);
			this.#maskProgram = null;
		}
		if (this.#maskedSceneProgram) {
			this.#gl.deleteProgram(this.#maskedSceneProgram.program);
			this.#gl.deleteVertexArray(this.#maskedSceneProgram.vertexArray);
			this.#maskedSceneProgram = null;
		}
		if (this.#windowMaskProgram) {
			this.#gl.deleteBuffer(this.#windowMaskProgram.positionBuffer);
			this.#gl.deleteProgram(this.#windowMaskProgram.program);
			this.#gl.deleteVertexArray(this.#windowMaskProgram.vertexArray);
			this.#windowMaskProgram = null;
		}
	}

	#drawMask(
		command: {
			readonly depthCompare: PortalMaskDepthCompare;
			readonly kind: "mask-write";
			readonly stencilPolicy: PortalMaskStencilPolicy;
		},
		target: WebGL2SceneDomainTarget,
		geometry: WebGL2GeometryBinding,
		indexStart: number,
		indexCount: number,
		clipFromLocal: Float32Array,
	): void {
		this.#assertAlive();
		requireTarget(this.#target, target);
		validateDrawRange(geometry, indexStart, indexCount);
		if (clipFromLocal.length !== 16) {
			throw new Error(
				"Portal mask transform must contain 16 matrix components.",
			);
		}
		const program = this.#requireMaskProgram();
		const gl = this.#gl;
		applyPortalPassState(gl, {
			...command,
			extent: target.extent,
			framebuffer: target.framebuffer,
		});
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(program.clipFromLocal, false, clipFromLocal);
		gl.bindVertexArray(geometry.vertexArray);
		gl.drawElements(
			gl.TRIANGLES,
			indexCount,
			geometry.indexType,
			indexStart * geometry.indexElementBytes,
		);
	}

	#allocateTarget(extent: PortalRenderExtent): WebGL2SceneDomainTarget {
		const maximumTextureSize = this.#gl.getParameter(
			this.#gl.MAX_TEXTURE_SIZE,
		) as number;
		if (
			extent.width > maximumTextureSize ||
			extent.height > maximumTextureSize
		) {
			throw new Error(
				`Portal target extent ${extent.width}x${extent.height} exceeds maximum texture size ${maximumTextureSize}.`,
			);
		}
		const previous = captureAllocationBindings(this.#gl);
		try {
			const target = allocateSceneDomainTarget(this.#gl, extent, "portal");
			this.#allocatedTargetCount += 1;
			return target;
		} finally {
			restoreAllocationBindings(this.#gl, previous);
		}
	}

	#disposeTarget(target: WebGL2SceneDomainTarget): void {
		this.#gl.deleteFramebuffer(target.framebuffer);
		this.#gl.deleteTexture(target.depthStencil);
		this.#gl.deleteTexture(target.color);
		this.#disposedTargetCount += 1;
	}

	#requireMaskProgram(): MaskProgram {
		this.#maskProgram ??= createMaskProgram(this.#gl);
		return this.#maskProgram;
	}

	#requireMaskedSceneProgram(): MaskedSceneProgram {
		this.#maskedSceneProgram ??= createMaskedSceneProgram(this.#gl);
		return this.#maskedSceneProgram;
	}

	#requireWindowMaskProgram(): WindowMaskProgram {
		this.#windowMaskProgram ??= createWindowMaskProgram(this.#gl);
		return this.#windowMaskProgram;
	}

	#assertAlive(): void {
		if (this.#destroyed) {
			throw new Error("Portal GPU substrate has been destroyed.");
		}
	}
}

interface MaskProgram {
	readonly clipFromLocal: WebGLUniformLocation;
	readonly program: WebGLProgram;
}

/** Fullscreen scene initialization constrained by the active stencil value. */
interface MaskedSceneProgram {
	readonly color: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
	readonly program: WebGLProgram;
	readonly vertexArray: WebGLVertexArrayObject;
}

/** Dynamic NDC geometry used only when a portal intersects the camera's near-clip volume. */
interface WindowMaskProgram {
	readonly positionBuffer: WebGLBuffer;
	readonly program: WebGLProgram;
	readonly vertexArray: WebGLVertexArrayObject;
}

interface AllocationBindings {
	readonly activeTexture: GLenum;
	readonly framebuffer: WebGLFramebuffer | null;
	readonly texture: WebGLTexture | null;
}

function allocateSceneDomainTarget(
	gl: WebGL2RenderingContext,
	extent: PortalRenderExtent,
	label: string,
): WebGL2SceneDomainTarget {
	const framebuffer = requireResource(
		gl.createFramebuffer(),
		`${label} scene-domain framebuffer`,
	);
	const color = requireResource(
		gl.createTexture(),
		`${label} scene-domain color texture`,
	);
	const depthStencil = requireResource(
		gl.createTexture(),
		`${label} scene-domain depth-stencil texture`,
	);
	try {
		initializeTargetTexture(gl, color, extent, false);
		initializeTargetTexture(gl, depthStencil, extent, true);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			color,
			0,
		);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.DEPTH_STENCIL_ATTACHMENT,
			gl.TEXTURE_2D,
			depthStencil,
			0,
		);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error(`${label} scene-domain framebuffer is incomplete.`);
		}
		return { color, depthStencil, extent: { ...extent }, framebuffer };
	} catch (cause) {
		gl.deleteTexture(depthStencil);
		gl.deleteTexture(color);
		gl.deleteFramebuffer(framebuffer);
		throw cause;
	}
}

function initializeTargetTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	extent: PortalRenderExtent,
	depthStencil: boolean,
): void {
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	if (depthStencil) {
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.DEPTH24_STENCIL8,
			extent.width,
			extent.height,
			0,
			gl.DEPTH_STENCIL,
			gl.UNSIGNED_INT_24_8,
			null,
		);
		return;
	}
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA8,
		extent.width,
		extent.height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		null,
	);
}

function createMaskProgram(gl: WebGL2RenderingContext): MaskProgram {
	const program = linkProgram(
		gl,
		`#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 u_clipFromLocal;
void main() {
	gl_Position = u_clipFromLocal * vec4(aPosition, 1.0);
}`,
		`#version 300 es
precision highp float;
out vec4 outColor;
void main() {
	outColor = vec4(0.0);
}`,
	);
	try {
		return {
			clipFromLocal: requireWebGL2Uniform(gl, program, "u_clipFromLocal"),
			program,
		};
	} catch (cause) {
		gl.deleteProgram(program);
		throw cause;
	}
}

function createWindowMaskProgram(
	gl: WebGL2RenderingContext,
): WindowMaskProgram {
	const vertexArray = requireResource(
		gl.createVertexArray(),
		"portal window-mask vertex array",
	);
	const positionBuffer = gl.createBuffer();
	if (!positionBuffer) {
		gl.deleteVertexArray(vertexArray);
		throw new Error("Failed to allocate portal window-mask position buffer.");
	}
	let program: WebGLProgram | null = null;
	try {
		program = linkProgram(
			gl,
			`#version 300 es
layout(location = 0) in vec2 aPosition;
void main() {
	gl_Position = vec4(aPosition, 0.0, 1.0);
}`,
			`#version 300 es
precision highp float;
out vec4 outColor;
void main() {
	outColor = vec4(0.0);
}`,
		);
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		return { positionBuffer, program, vertexArray };
	} catch (cause) {
		if (program) gl.deleteProgram(program);
		gl.deleteBuffer(positionBuffer);
		gl.deleteVertexArray(vertexArray);
		throw cause;
	}
}

function triangulatePortalViewWindow(window: PortalViewWindow): Float32Array {
	const vertexCount = window.fragments.reduce(
		(count, fragment) => count + (fragment.vertices.length - 2) * 3,
		0,
	);
	const output = new Float32Array(vertexCount * 2);
	let offset = 0;
	for (const fragment of window.fragments) {
		const first = fragment.vertices[0]!;
		for (let index = 1; index < fragment.vertices.length - 1; index += 1) {
			for (const vertex of [
				first,
				fragment.vertices[index]!,
				fragment.vertices[index + 1]!,
			]) {
				output[offset] = vertex.x;
				output[offset + 1] = vertex.y;
				offset += 2;
			}
		}
	}
	return output;
}

function createMaskedSceneProgram(
	gl: WebGL2RenderingContext,
): MaskedSceneProgram {
	const vertexArray = requireResource(
		gl.createVertexArray(),
		"portal masked-scene vertex array",
	);
	let program: WebGLProgram | null = null;
	try {
		program = linkProgram(
			gl,
			`#version 300 es
void main() {
	vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`,
			`#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_depth;
out vec4 outColor;
void main() {
	outColor = u_color;
	gl_FragDepth = u_depth;
}`,
		);
		return {
			color: requireWebGL2Uniform(gl, program, "u_color"),
			depth: requireWebGL2Uniform(gl, program, "u_depth"),
			program,
			vertexArray,
		};
	} catch (cause) {
		if (program) gl.deleteProgram(program);
		gl.deleteVertexArray(vertexArray);
		throw cause;
	}
}

function linkProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string,
): WebGLProgram {
	const vertex = compileWebGL2Shader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragment = compileWebGL2Shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = requireResource(gl.createProgram(), "portal shader program");
	try {
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link portal shader program: ${gl.getProgramInfoLog(program) ?? "unknown error"}.`,
			);
		}
		return program;
	} catch (cause) {
		gl.deleteProgram(program);
		throw cause;
	} finally {
		gl.deleteShader(fragment);
		gl.deleteShader(vertex);
	}
}

function captureAllocationBindings(
	gl: WebGL2RenderingContext,
): AllocationBindings {
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as GLenum;
	gl.activeTexture(gl.TEXTURE0);
	const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
	gl.activeTexture(activeTexture);
	return {
		activeTexture,
		framebuffer: gl.getParameter(
			gl.FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		texture,
	};
}

function restoreAllocationBindings(
	gl: WebGL2RenderingContext,
	bindings: AllocationBindings,
): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, bindings.framebuffer);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, bindings.texture);
	gl.activeTexture(bindings.activeTexture);
}

function validateExtent(extent: PortalRenderExtent): void {
	if (
		!Number.isInteger(extent.width) ||
		!Number.isInteger(extent.height) ||
		extent.width <= 0 ||
		extent.height <= 0
	) {
		throw new Error("Portal render extent must contain positive integers.");
	}
}

function validateDrawRange(
	geometry: WebGL2GeometryBinding,
	indexStart: number,
	indexCount: number,
): void {
	if (
		!Number.isInteger(indexStart) ||
		!Number.isInteger(indexCount) ||
		indexStart < 0 ||
		indexCount <= 0 ||
		indexStart + indexCount > geometry.indexCount
	) {
		throw new Error(
			`Portal mask draw range ${indexStart}+${indexCount} exceeds geometry index count ${geometry.indexCount}.`,
		);
	}
}

function requireStencilValue(value: number): void {
	if (
		!Number.isInteger(value) ||
		value < 0 ||
		value > MAXIMUM_PORTAL_RENDER_LAYER
	) {
		throw new Error(
			`Portal stencil value must be an integer from 0 through ${MAXIMUM_PORTAL_RENDER_LAYER}.`,
		);
	}
}

function requireMaskStencilValue(value: number): void {
	requireStencilValue(value);
	if (value === 0) {
		throw new Error(
			"Portal mask writes cannot target the unmasked base layer.",
		);
	}
}

function requireNormalizedColor(
	color: readonly [number, number, number, number],
	label: string,
): void {
	if (color.some((component) => !isNormalized(component))) {
		throw new Error(
			`${label} components must be finite values from 0 through 1.`,
		);
	}
}

function requireTarget(
	ownedTarget: WebGL2SceneDomainTarget | null,
	target: WebGL2SceneDomainTarget,
): void {
	if (!ownedTarget || target !== ownedTarget) {
		throw new Error(
			"Portal scene-domain target is not owned by this substrate.",
		);
	}
}

function requireResource<T>(value: T | null, label: string): T {
	if (value === null) throw new Error(`Failed to allocate ${label}.`);
	return value;
}

function isNormalized(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Fail loudly if malformed runtime input escapes the compile-time pass-state union. */
function assertNever(value: never): never {
	throw new Error(
		`Unsupported portal pass-state command: ${JSON.stringify(value)}.`,
	);
}
