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
import type { TextureFilteringCapabilities } from "./texture-filtering-policy";
import {
	probeWebGL2TextureFilteringSupport,
	type WebGL2TextureFilteringSupport,
} from "./webgl2-texture-filtering-support";

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
	readonly depthStencilFormat: "DEPTH24_STENCIL8";
	readonly framebufferComplete: boolean;
	readonly maximumTextureSize: number;
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
	/** One context-lifetime filtering probe shared by UI capability and backend sampler consumers. */
	readonly #textureFilteringSupport: WebGL2TextureFilteringSupport;
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
		textureFilteringSupport: WebGL2TextureFilteringSupport,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.resources = resources;
		this.#textureFilteringSupport = textureFilteringSupport;
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
		const textureFilteringSupport = probeWebGL2TextureFilteringSupport(gl);
		return new WebGL2Device(canvas, gl, resources, textureFilteringSupport);
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
			this.#textureFilteringSupport,
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

	/** Run the standalone direct exterior-transition fixture. */
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

	/** Return device filtering limits without exposing WebGL extension state to the frontend. */
	getTextureFilteringCapabilities(): TextureFilteringCapabilities {
		this.#assertReady();
		return { ...this.#textureFilteringSupport.capabilities };
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
	const framebuffer = requireGlResource(
		gl.createFramebuffer(),
		"portal capability framebuffer",
	);
	const color = requireGlResource(
		gl.createTexture(),
		"portal capability color texture",
	);
	const depthStencil = requireGlResource(
		gl.createTexture(),
		"portal capability depth-stencil texture",
	);
	const previous = captureProbeState(gl);
	try {
		gl.activeTexture(gl.TEXTURE0);
		initializeProbeTexture(gl, color, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
		initializeProbeTexture(
			gl,
			depthStencil,
			gl.DEPTH24_STENCIL8,
			gl.DEPTH_STENCIL,
			gl.UNSIGNED_INT_24_8,
		);

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
		const framebufferComplete =
			gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
		const error = gl.getError();
		if (error !== gl.NO_ERROR) {
			throw new Error(
				`Portal capability probe failed with WebGL error ${error}.`,
			);
		}
		return {
			colorFormat: "RGBA8",
			depthBits: framebufferComplete
				? (gl.getParameter(gl.DEPTH_BITS) as number)
				: 0,
			depthStencilFormat: "DEPTH24_STENCIL8",
			framebufferComplete,
			maximumTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
			stencilBits: framebufferComplete
				? (gl.getParameter(gl.STENCIL_BITS) as number)
				: 0,
		};
	} finally {
		restoreProbeState(gl, previous);
		gl.deleteTexture(depthStencil);
		gl.deleteTexture(color);
		gl.deleteFramebuffer(framebuffer);
	}
}

interface PortalProbeState {
	readonly activeTexture: number;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
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
		drawFramebuffer: gl.getParameter(
			gl.DRAW_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		readFramebuffer: gl.getParameter(
			gl.READ_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		texture0Binding,
	};
}

function restoreProbeState(
	gl: WebGL2RenderingContext,
	state: PortalProbeState,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
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

function requireGlResource<T>(resource: T | null, label: string): T {
	if (resource === null) throw new Error(`Failed to allocate ${label}.`);
	return resource;
}
