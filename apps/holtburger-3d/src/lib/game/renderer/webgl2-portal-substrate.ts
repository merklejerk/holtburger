import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";

const COLOR_BYTES_PER_PIXEL = 4;
const DEPTH_STENCIL_BYTES_PER_PIXEL = 4;
/** Maximum render-layer label supported by the WebGL stencil attachment. */
const MAXIMUM_PORTAL_RENDER_LAYER = 0xff;

/** Positive drawing-buffer extent owned by one scene-domain target generation. */
export interface PortalRenderExtent {
	readonly height: number;
	readonly width: number;
}

/** One color/depth-stencil framebuffer used by portal scene-domain composition. */
export interface WebGL2SceneDomainTarget {
	readonly color: WebGLTexture;
	readonly depthStencil: WebGLTexture;
	readonly extent: PortalRenderExtent;
	readonly framebuffer: WebGLFramebuffer;
}

/** The fixed two-target portal allocation; no target is owned per path or aperture. */
export interface WebGL2SceneDomainTargets {
	readonly composite: WebGL2SceneDomainTarget;
	readonly exterior: WebGL2SceneDomainTarget;
}

/** Consumed lifecycle facts for browser fixtures and later renderer diagnostics. */
export interface WebGL2PortalSubstrateDiagnostics {
	readonly activeBytes: number;
	readonly activeTargetCount: number;
	readonly allocatedTargetCount: number;
	readonly disposedTargetCount: number;
	readonly extent: PortalRenderExtent | null;
}

/** Fixed-function pass baselines established without inspecting ambient renderer state. */
export type PortalPassStateCommand =
	| {
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer | null;
			readonly kind: "clear" | "ordinary";
	  }
	| {
			readonly depthCompare: "always" | "less-or-equal";
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "mask-write";
			readonly renderLayer: number;
	  }
	| {
			readonly depthCompare: "always" | "less";
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "masked-copy";
			readonly renderLayer: number;
	  }
	| {
			readonly depth: number;
			readonly extent: PortalRenderExtent;
			readonly framebuffer: WebGLFramebuffer;
			readonly kind: "masked-depth-reset";
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
		requireMaskRenderLayer(command.renderLayer);
		gl.colorMask(false, false, false, false);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(command.depthCompare === "always" ? gl.ALWAYS : gl.LEQUAL);
		gl.depthMask(false);
		gl.enable(gl.STENCIL_TEST);
		gl.stencilMask(MAXIMUM_PORTAL_RENDER_LAYER);
		gl.stencilFunc(gl.ALWAYS, command.renderLayer, MAXIMUM_PORTAL_RENDER_LAYER);
		gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
		return;
	}
	if (command.kind === "masked-depth-reset") {
		requireStencilValue(command.renderLayer);
		if (!isNormalized(command.depth)) {
			throw new Error(
				"Portal masked depth reset must be a finite value from 0 through 1.",
			);
		}
		gl.colorMask(false, false, false, false);
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
	if (command.kind !== "masked-copy") {
		throw new Error(`Unsupported portal pass state command ${command.kind}.`);
	}
	requireStencilValue(command.renderLayer);
	gl.colorMask(true, true, true, true);
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(command.depthCompare === "always" ? gl.ALWAYS : gl.LESS);
	gl.depthMask(true);
	gl.enable(gl.STENCIL_TEST);
	gl.stencilMask(0);
	gl.stencilFunc(gl.EQUAL, command.renderLayer, MAXIMUM_PORTAL_RENDER_LAYER);
	gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
}

/**
 * Lazy renderer-owned mechanics for portal masks and scene-domain composition.
 *
 * Construction allocates no GPU resources. Targets and programs appear only when portal execution
 * or the explicit browser fixture first requests them.
 */
export class WebGL2PortalSubstrate {
	readonly #gl: WebGL2RenderingContext;
	#allocatedTargetCount = 0;
	#disposedTargetCount = 0;
	#destroyed = false;
	#depthResetProgram: DepthResetProgram | null = null;
	#maskProgram: MaskProgram | null = null;
	#sceneCopyProgram: SceneCopyProgram | null = null;
	#targets: WebGL2SceneDomainTargets | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	resize(extent: PortalRenderExtent): WebGL2SceneDomainTargets {
		this.#assertAlive();
		validateExtent(extent);
		if (
			this.#targets?.exterior.extent.width === extent.width &&
			this.#targets.exterior.extent.height === extent.height
		) {
			return this.#targets;
		}
		const replacement = this.#allocateTargets(extent);
		const previous = this.#targets;
		this.#targets = replacement;
		if (previous) this.#disposeTargets(previous);
		return replacement;
	}

	getTargets(): WebGL2SceneDomainTargets {
		this.#assertAlive();
		if (!this.#targets) {
			throw new Error("Portal scene-domain targets have no render extent.");
		}
		return this.#targets;
	}

	clearTarget(
		target: WebGL2SceneDomainTarget,
		color: readonly [number, number, number, number],
		depth: number,
		stencil: number,
	): void {
		this.#assertAlive();
		requireTarget(this.#targets, target);
		if (color.some((component) => !isNormalized(component))) {
			throw new Error(
				"Portal target clear color components must be finite values from 0 through 1.",
			);
		}
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
		renderLayer: number,
		depthCompare: "always" | "less-or-equal",
	): void {
		this.#drawMask(
			{
				depthCompare,
				kind: "mask-write",
				renderLayer,
			},
			target,
			geometry,
			indexStart,
			indexCount,
			clipFromLocal,
		);
	}

	/** Establish an ordinary scene pass on one owned offscreen target. */
	beginTargetPass(target: WebGL2SceneDomainTarget): void {
		this.#assertAlive();
		requireTarget(this.#targets, target);
		applyPortalPassState(this.#gl, {
			extent: target.extent,
			framebuffer: target.framebuffer,
			kind: "ordinary",
		});
	}

	/** Establish ordinary color/depth drawing constrained by one completed mask intersection. */
	beginMaskedPass(target: WebGL2SceneDomainTarget, renderLayer: number): void {
		this.#assertAlive();
		requireTarget(this.#targets, target);
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
		requireTarget(this.#targets, target);
		const program = this.#requireDepthResetProgram();
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

	copyScene(
		source: WebGL2SceneDomainTarget,
		destination: WebGL2SceneDomainTarget,
		renderLayer: number,
		depthCompare: "always" | "less",
	): void {
		this.#assertAlive();
		requireTarget(this.#targets, source);
		requireTarget(this.#targets, destination);
		if (source === destination) {
			throw new Error(
				"Portal scene copy cannot sample from its destination framebuffer.",
			);
		}
		if (
			source.extent.width !== destination.extent.width ||
			source.extent.height !== destination.extent.height
		) {
			throw new Error("Portal scene copy requires matching source extents.");
		}
		const program = this.#requireSceneCopyProgram();
		const gl = this.#gl;
		applyPortalPassState(gl, {
			depthCompare,
			extent: destination.extent,
			framebuffer: destination.framebuffer,
			kind: "masked-copy",
			renderLayer,
		});
		gl.useProgram(program.program);
		gl.bindVertexArray(program.vertexArray);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, source.color);
		gl.uniform1i(program.color, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, source.depthStencil);
		gl.uniform1i(program.depth, 1);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	present(
		source: WebGL2SceneDomainTarget,
		destination: WebGLFramebuffer | null,
		destinationExtent: PortalRenderExtent,
	): void {
		this.#assertAlive();
		requireTarget(this.#targets, source);
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
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.useProgram(null);
		gl.bindVertexArray(null);
	}

	getDiagnostics(): WebGL2PortalSubstrateDiagnostics {
		const extent = this.#targets?.exterior.extent ?? null;
		return {
			activeBytes:
				extent === null
					? 0
					: extent.width *
						extent.height *
						(COLOR_BYTES_PER_PIXEL + DEPTH_STENCIL_BYTES_PER_PIXEL) *
						2,
			activeTargetCount: this.#targets ? 2 : 0,
			allocatedTargetCount: this.#allocatedTargetCount,
			disposedTargetCount: this.#disposedTargetCount,
			extent: extent ? { ...extent } : null,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (this.#targets) {
			this.#disposeTargets(this.#targets);
			this.#targets = null;
		}
		if (this.#maskProgram) {
			this.#gl.deleteProgram(this.#maskProgram.program);
			this.#maskProgram = null;
		}
		if (this.#depthResetProgram) {
			this.#gl.deleteProgram(this.#depthResetProgram.program);
			this.#gl.deleteVertexArray(this.#depthResetProgram.vertexArray);
			this.#depthResetProgram = null;
		}
		if (this.#sceneCopyProgram) {
			this.#gl.deleteProgram(this.#sceneCopyProgram.program);
			this.#gl.deleteVertexArray(this.#sceneCopyProgram.vertexArray);
			this.#sceneCopyProgram = null;
		}
	}

	#drawMask(
		command: {
			readonly depthCompare: "always" | "less-or-equal";
			readonly kind: "mask-write";
			readonly renderLayer: number;
		},
		target: WebGL2SceneDomainTarget,
		geometry: WebGL2GeometryBinding,
		indexStart: number,
		indexCount: number,
		clipFromLocal: Float32Array,
	): void {
		this.#assertAlive();
		requireTarget(this.#targets, target);
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

	#allocateTargets(extent: PortalRenderExtent): WebGL2SceneDomainTargets {
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
		let exterior: WebGL2SceneDomainTarget | null = null;
		let composite: WebGL2SceneDomainTarget | null = null;
		try {
			exterior = allocateSceneDomainTarget(this.#gl, extent, "exterior");
			this.#allocatedTargetCount += 1;
			composite = allocateSceneDomainTarget(this.#gl, extent, "composite");
			this.#allocatedTargetCount += 1;
			return { composite, exterior };
		} catch (cause) {
			if (composite) this.#disposeTarget(composite);
			if (exterior) this.#disposeTarget(exterior);
			throw cause;
		} finally {
			restoreAllocationBindings(this.#gl, previous);
		}
	}

	#disposeTargets(targets: WebGL2SceneDomainTargets): void {
		this.#disposeTarget(targets.composite);
		this.#disposeTarget(targets.exterior);
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

	#requireDepthResetProgram(): DepthResetProgram {
		this.#depthResetProgram ??= createDepthResetProgram(this.#gl);
		return this.#depthResetProgram;
	}

	#requireSceneCopyProgram(): SceneCopyProgram {
		this.#sceneCopyProgram ??= createSceneCopyProgram(this.#gl);
		return this.#sceneCopyProgram;
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

/** Fullscreen depth replacement constrained by the active stencil value. */
interface DepthResetProgram {
	readonly depth: WebGLUniformLocation;
	readonly program: WebGLProgram;
	readonly vertexArray: WebGLVertexArrayObject;
}

interface SceneCopyProgram {
	readonly color: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
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

function createDepthResetProgram(
	gl: WebGL2RenderingContext,
): DepthResetProgram {
	const vertexArray = requireResource(
		gl.createVertexArray(),
		"portal depth-reset vertex array",
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
uniform float u_depth;
out vec4 outColor;
void main() {
	outColor = vec4(0.0);
	gl_FragDepth = u_depth;
}`,
		);
		return {
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

function createSceneCopyProgram(gl: WebGL2RenderingContext): SceneCopyProgram {
	const vertexArray = requireResource(
		gl.createVertexArray(),
		"portal scene-copy vertex array",
	);
	let program: WebGLProgram | null = null;
	try {
		program = linkProgram(
			gl,
			`#version 300 es
out vec2 vTextureCoordinate;
void main() {
	vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	vTextureCoordinate = position;
	gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`,
			`#version 300 es
precision highp float;
uniform sampler2D u_color;
uniform sampler2D u_depth;
in vec2 vTextureCoordinate;
out vec4 outColor;
void main() {
	outColor = texture(u_color, vTextureCoordinate);
	gl_FragDepth = texture(u_depth, vTextureCoordinate).r;
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

function requireMaskRenderLayer(renderLayer: number): void {
	requireStencilValue(renderLayer);
	if (renderLayer === 0) {
		throw new Error(
			"Portal mask writes cannot target the unmasked base layer.",
		);
	}
}

function requireTarget(
	targets: WebGL2SceneDomainTargets | null,
	target: WebGL2SceneDomainTarget,
): void {
	if (
		!targets ||
		(target !== targets.exterior && target !== targets.composite)
	) {
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
