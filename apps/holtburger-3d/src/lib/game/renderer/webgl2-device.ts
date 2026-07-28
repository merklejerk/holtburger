import { WebGL2Renderer } from "./webgl2-renderer";
import { RenderWorld } from "./render-world";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	IntegerTexture2DFormat,
	type Texture2DResourceKey,
} from "./resource-manager";
import { TexturePixelFormat } from "../textures/types";
import {
	runWebGL2PortalSubstrateFixture,
	type WebGL2PortalSubstrateFixtureResult,
} from "./webgl2-portal-substrate-fixture";
import {
	runWebGL2HybridPortalExecutionFixture,
	type WebGL2HybridPortalExecutionFixtureResult,
} from "./webgl2-hybrid-portal-executor-fixture";
import {
	runWebGL2InternalPortalExecutionFixture,
	type WebGL2InternalPortalExecutionFixtureResult,
} from "./webgl2-internal-portal-executor-fixture";

/** One transient RGBA preview copied from a live two-dimensional GPU texture. */
export interface Texture2DReadback {
	/** Original normalized texture format, used to display one- and two-channel pages faithfully. */
	readonly format: TexturePixelFormat;
	readonly height: number;
	/** Rows preserve the atlas packer's coordinate order for placement-bound overlays. */
	readonly pixels: Uint8Array;
	readonly width: number;
}

/** Executable browser facts for the fixed portal scene-domain target contract. */
export interface PortalTargetCapabilityProbe {
	readonly colorFormat: "RGBA8";
	readonly depthBits: number;
	readonly depthSampleMatchesClear: boolean;
	readonly depthStencilFormat: "DEPTH24_STENCIL8";
	readonly framebufferComplete: boolean;
	readonly maximumRenderbufferSize: number;
	readonly maximumTextureSize: number;
	readonly sampledDepthByte: number;
	readonly stencilBits: number;
}

/** Whole-device lifecycle state; a lost context requires rebuilding the complete runtime. */
export type WebGL2DeviceStatus =
	| { readonly kind: "ready" }
	| { readonly kind: "restart-required"; readonly reason: "context-lost" }
	| { readonly kind: "destroyed" };

/** Browser evidence that context loss invalidates every operation without claiming restoration. */
export interface WebGL2ContextLossPolicyProbe {
	readonly lossEventCanceled: boolean;
	readonly operationRejected: boolean;
	readonly rejectionMessage: string;
	readonly rendererDrawRejected: boolean;
	readonly rendererRejectionMessage: string;
	readonly status: WebGL2DeviceStatus;
}

/** One WebGL2 context composed with all backend services that consume it. */
export class WebGL2Device {
	readonly resources: WebGL2ResourceManager;
	/** Canvas whose context owns every backend resource allocated by this device. */
	readonly #canvas: HTMLCanvasElement;
	/** Context retained so this device, rather than one renderer, owns context loss. */
	readonly #gl: WebGL2RenderingContext;
	#status: WebGL2DeviceStatus = { kind: "ready" };
	readonly #onContextLost = (event: Event): void => {
		event.preventDefault();
		if (this.#status.kind === "ready") {
			this.#status = {
				kind: "restart-required",
				reason: "context-lost",
			};
		}
	};
	readonly #onContextRestored = (): void => {
		// Restoration cannot revive resource handles or upload descriptions owned by this device.
	};

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.resources = resources;
		this.#canvas.addEventListener("webglcontextlost", this.#onContextLost);
		this.#canvas.addEventListener(
			"webglcontextrestored",
			this.#onContextRestored,
		);
	}

	static async build(canvas: HTMLCanvasElement): Promise<WebGL2Device> {
		const gl = canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			depth: true,
			premultipliedAlpha: false,
			stencil: true,
		});
		if (!gl) throw new Error("WebGL2 is not available in this browser.");

		const resources = new WebGL2ResourceManager(gl);
		return new WebGL2Device(canvas, gl, resources);
	}

	/** Exercise context loss on an isolated device so the active renderer remains usable. */
	static async probeContextLossPolicy(): Promise<WebGL2ContextLossPolicyProbe> {
		const canvas = document.createElement("canvas");
		const device = await WebGL2Device.build(canvas);
		const renderer = await device.buildRenderer({} as RenderWorld);
		try {
			const lossEvent = await device.#loseContextForProbe();
			let rejectionMessage = "";
			let rendererRejectionMessage = "";
			try {
				device.probePortalTargetCapabilities();
			} catch (cause) {
				rejectionMessage =
					cause instanceof Error ? cause.message : String(cause);
			}
			try {
				renderer.drawFrame({} as Parameters<WebGL2Renderer["drawFrame"]>[0]);
			} catch (cause) {
				rendererRejectionMessage =
					cause instanceof Error ? cause.message : String(cause);
			}
			return {
				lossEventCanceled: lossEvent.defaultPrevented,
				operationRejected: rejectionMessage.includes("restart is required"),
				rejectionMessage,
				rendererDrawRejected: rendererRejectionMessage.includes(
					"restart is required",
				),
				rendererRejectionMessage,
				status: device.getStatus(),
			};
		} finally {
			await renderer.destroy();
			await device.destroy();
		}
	}

	/** Construct one renderer after the runtime exposes its read-only RenderWorld. */
	buildRenderer(world: RenderWorld): Promise<WebGL2Renderer> {
		this.#assertReady();
		return WebGL2Renderer.build(
			this.#canvas,
			this.#gl,
			this.resources,
			world,
			() => this.#assertReady(),
		);
	}

	/**
	 * Execute the Gate-C format probe against this device's actual browser context.
	 * All temporary state and resources are restored before normal renderer construction resumes.
	 */
	probePortalTargetCapabilities(): PortalTargetCapabilityProbe {
		this.#assertReady();
		return probePortalTargetCapabilities(this.#gl);
	}

	/** Run the Gate-D production-substrate fixture against this device's browser context. */
	probePortalSubstrate(): WebGL2PortalSubstrateFixtureResult {
		this.#assertReady();
		return runWebGL2PortalSubstrateFixture(this.#gl, this.resources);
	}

	/** Run the Gate-F standalone exterior-transition composition fixture. */
	probeHybridPortalExecution(): WebGL2HybridPortalExecutionFixtureResult {
		this.#assertReady();
		return runWebGL2HybridPortalExecutionFixture(this.#gl, this.resources);
	}

	/** Run the Gate-G indoor graph execution fixture through production targets and masks. */
	probeInternalPortalExecution(): WebGL2InternalPortalExecutionFixtureResult {
		this.#assertReady();
		return runWebGL2InternalPortalExecutionFixture(this.#gl, this.resources);
	}

	/** Return a copied discriminant suitable for app-level restart policy and diagnostics. */
	getStatus(): WebGL2DeviceStatus {
		return { ...this.#status };
	}

	/**
	 * Copy a live two-dimensional texture only when an explicit diagnostic inspector requests it.
	 * This avoids retaining page-sized CPU copies during normal rendering.
	 */
	readTexture2D(key: Texture2DResourceKey): Texture2DReadback {
		this.#assertReady();
		const resource = this.resources.getTexture2D(key);
		if (
			resource.format === IntegerTexture2DFormat.R32UI ||
			resource.format === IntegerTexture2DFormat.RGBA32UI
		) {
			throw new Error(
				`Texture ${key} uses an integer format and cannot be previewed.`,
			);
		}
		const framebuffer = this.#gl.createFramebuffer();
		if (!framebuffer)
			throw new Error("Failed to allocate texture readback framebuffer.");
		const previousFramebuffer = this.#gl.getParameter(
			this.#gl.FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null;
		try {
			this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, framebuffer);
			this.#gl.framebufferTexture2D(
				this.#gl.FRAMEBUFFER,
				this.#gl.COLOR_ATTACHMENT0,
				this.#gl.TEXTURE_2D,
				resource.texture,
				0,
			);
			if (
				this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER) !==
				this.#gl.FRAMEBUFFER_COMPLETE
			) {
				throw new Error(`Texture ${key} cannot be read through a framebuffer.`);
			}
			const pixels = new Uint8Array(resource.width * resource.height * 4);
			this.#gl.readPixels(
				0,
				0,
				resource.width,
				resource.height,
				this.#gl.RGBA,
				this.#gl.UNSIGNED_BYTE,
				pixels,
			);
			return {
				format: resource.format,
				height: resource.height,
				pixels,
				width: resource.width,
			};
		} finally {
			this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, previousFramebuffer);
			this.#gl.deleteFramebuffer(framebuffer);
		}
	}

	async destroy(): Promise<void> {
		if (this.#status.kind === "destroyed") return;
		this.#status = { kind: "destroyed" };
		this.#canvas.removeEventListener("webglcontextlost", this.#onContextLost);
		this.#canvas.removeEventListener(
			"webglcontextrestored",
			this.#onContextRestored,
		);
		await this.resources.destroy();
		this.#gl.getExtension("WEBGL_lose_context")?.loseContext();
	}

	#assertReady(): void {
		if (this.#status.kind === "ready") return;
		if (this.#status.kind === "restart-required") {
			throw new Error(
				"WebGL2 context was lost; a full app restart is required.",
			);
		}
		throw new Error("WebGL2 device has been destroyed.");
	}

	async #loseContextForProbe(): Promise<Event> {
		this.#assertReady();
		const extension = this.#gl.getExtension("WEBGL_lose_context");
		if (!extension) {
			throw new Error(
				"WEBGL_lose_context is unavailable for the lifecycle probe.",
			);
		}
		const event = new Promise<Event>((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				reject(new Error("Timed out waiting for WebGL context loss."));
			}, 5_000);
			this.#canvas.addEventListener(
				"webglcontextlost",
				(lossEvent) => {
					window.clearTimeout(timeout);
					resolve(lossEvent);
				},
				{ once: true },
			);
		});
		extension.loseContext();
		return event;
	}
}

function probePortalTargetCapabilities(
	gl: WebGL2RenderingContext,
): PortalTargetCapabilityProbe {
	const sourceFramebuffer = requireGlResource(
		gl.createFramebuffer(),
		"portal capability source framebuffer",
	);
	const destinationFramebuffer = requireGlResource(
		gl.createFramebuffer(),
		"portal capability destination framebuffer",
	);
	const sourceColor = requireGlResource(
		gl.createTexture(),
		"portal capability source color texture",
	);
	const sourceDepthStencil = requireGlResource(
		gl.createTexture(),
		"portal capability depth-stencil texture",
	);
	const destinationColor = requireGlResource(
		gl.createTexture(),
		"portal capability destination color texture",
	);
	const vertexArray = requireGlResource(
		gl.createVertexArray(),
		"portal capability vertex array",
	);
	const program = createDepthSamplingProgram(gl);
	const previous = captureProbeState(gl);
	const sampledPixel = new Uint8Array(4);
	try {
		gl.activeTexture(gl.TEXTURE0);
		initializeProbeTexture(
			gl,
			sourceColor,
			gl.RGBA8,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
		);
		initializeProbeTexture(
			gl,
			sourceDepthStencil,
			gl.DEPTH24_STENCIL8,
			gl.DEPTH_STENCIL,
			gl.UNSIGNED_INT_24_8,
		);
		initializeProbeTexture(
			gl,
			destinationColor,
			gl.RGBA8,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
		);

		gl.bindFramebuffer(gl.FRAMEBUFFER, sourceFramebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			sourceColor,
			0,
		);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.DEPTH_STENCIL_ATTACHMENT,
			gl.TEXTURE_2D,
			sourceDepthStencil,
			0,
		);
		const framebufferComplete =
			gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
		if (!framebufferComplete) {
			return capabilityResult(gl, false, 0, 0, sampledPixel[0]!);
		}
		const depthBits = gl.getParameter(gl.DEPTH_BITS) as number;
		const stencilBits = gl.getParameter(gl.STENCIL_BITS) as number;
		gl.viewport(0, 0, 1, 1);
		gl.clearDepth(0.25);
		gl.clearStencil(3);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

		gl.bindFramebuffer(gl.FRAMEBUFFER, destinationFramebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			destinationColor,
			0,
		);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error(
				"Portal capability destination framebuffer is incomplete.",
			);
		}
		gl.useProgram(program);
		gl.bindVertexArray(vertexArray);
		gl.bindTexture(gl.TEXTURE_2D, sourceDepthStencil);
		gl.uniform1i(gl.getUniformLocation(program, "u_depth"), 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sampledPixel);
		const error = gl.getError();
		if (error !== gl.NO_ERROR) {
			throw new Error(
				`Portal capability probe failed with WebGL error ${error}.`,
			);
		}
		return capabilityResult(gl, true, depthBits, stencilBits, sampledPixel[0]!);
	} finally {
		restoreProbeState(gl, previous);
		gl.deleteProgram(program);
		gl.deleteVertexArray(vertexArray);
		gl.deleteTexture(destinationColor);
		gl.deleteTexture(sourceDepthStencil);
		gl.deleteTexture(sourceColor);
		gl.deleteFramebuffer(destinationFramebuffer);
		gl.deleteFramebuffer(sourceFramebuffer);
	}
}

interface PortalProbeState {
	readonly activeTexture: number;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly clearColor: Float32Array;
	readonly clearDepth: number;
	readonly clearStencil: number;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly program: WebGLProgram | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
	readonly vertexArray: WebGLVertexArrayObject | null;
	readonly viewport: Int32Array;
}

function captureProbeState(gl: WebGL2RenderingContext): PortalProbeState {
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
	const activeTextureBinding = gl.getParameter(
		gl.TEXTURE_BINDING_2D,
	) as WebGLTexture | null;
	gl.activeTexture(gl.TEXTURE0);
	const texture0Binding = gl.getParameter(
		gl.TEXTURE_BINDING_2D,
	) as WebGLTexture | null;
	gl.activeTexture(activeTexture);
	return {
		activeTexture,
		activeTextureBinding,
		clearColor: gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array,
		clearDepth: gl.getParameter(gl.DEPTH_CLEAR_VALUE) as number,
		clearStencil: gl.getParameter(gl.STENCIL_CLEAR_VALUE) as number,
		drawFramebuffer: gl.getParameter(
			gl.DRAW_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
		readFramebuffer: gl.getParameter(
			gl.READ_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		texture0Binding,
		vertexArray: gl.getParameter(
			gl.VERTEX_ARRAY_BINDING,
		) as WebGLVertexArrayObject | null,
		viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
	};
}

function restoreProbeState(
	gl: WebGL2RenderingContext,
	state: PortalProbeState,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
	gl.useProgram(state.program);
	gl.bindVertexArray(state.vertexArray);
	gl.viewport(
		state.viewport[0]!,
		state.viewport[1]!,
		state.viewport[2]!,
		state.viewport[3]!,
	);
	gl.clearColor(
		state.clearColor[0]!,
		state.clearColor[1]!,
		state.clearColor[2]!,
		state.clearColor[3]!,
	);
	gl.clearDepth(state.clearDepth);
	gl.clearStencil(state.clearStencil);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, state.texture0Binding);
	gl.activeTexture(state.activeTexture);
	gl.bindTexture(gl.TEXTURE_2D, state.activeTextureBinding);
}

function initializeProbeTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	internalFormat: number,
	format: number,
	type: number,
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 1, 1, 0, format, type, null);
}

function createDepthSamplingProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const vertex = compileProbeShader(
		gl,
		gl.VERTEX_SHADER,
		`#version 300 es
void main() {
	vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`,
	);
	const fragment = compileProbeShader(
		gl,
		gl.FRAGMENT_SHADER,
		`#version 300 es
precision highp float;
uniform sampler2D u_depth;
out vec4 outColor;
void main() {
	float depth = texture(u_depth, vec2(0.5)).r;
	outColor = vec4(depth, 0.0, 0.0, 1.0);
}`,
	);
	const program = requireGlResource(
		gl.createProgram(),
		"portal capability shader program",
	);
	try {
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Portal capability program failed to link: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
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

function compileProbeShader(
	gl: WebGL2RenderingContext,
	type: number,
	source: string,
): WebGLShader {
	const shader = requireGlResource(
		gl.createShader(type),
		"portal capability shader",
	);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown error";
		gl.deleteShader(shader);
		throw new Error(`Portal capability shader failed to compile: ${message}`);
	}
	return shader;
}

function capabilityResult(
	gl: WebGL2RenderingContext,
	framebufferComplete: boolean,
	depthBits: number,
	stencilBits: number,
	sampledDepthByte: number,
): PortalTargetCapabilityProbe {
	return {
		colorFormat: "RGBA8",
		depthBits,
		depthSampleMatchesClear: Math.abs(sampledDepthByte - 64) <= 1,
		depthStencilFormat: "DEPTH24_STENCIL8",
		framebufferComplete,
		maximumRenderbufferSize: gl.getParameter(
			gl.MAX_RENDERBUFFER_SIZE,
		) as number,
		maximumTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
		sampledDepthByte,
		stencilBits,
	};
}

function requireGlResource<T>(resource: T | null, label: string): T {
	if (resource === null) throw new Error(`Failed to allocate ${label}.`);
	return resource;
}
