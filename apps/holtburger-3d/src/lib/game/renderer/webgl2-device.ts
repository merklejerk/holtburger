import { WebGL2Renderer } from "./webgl2-renderer";
import { RenderWorld } from "./render-world";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	IntegerTexture2DFormat,
	type Texture2DResourceKey,
} from "./resource-manager";
import { TexturePixelFormat } from "../textures/types";
import type { TextureFilteringCapabilities } from "./texture-filtering-policy";
import {
	probeWebGL2TextureFilteringSupport,
	type WebGL2TextureFilteringSupport,
} from "./webgl2-texture-filtering-support";
import {
	runWebGL2PortalScopeAtlasTargetsFixture,
	type WebGL2PortalScopeAtlasTargetsFixtureResult,
} from "./webgl2-portal-scope-atlas-targets-fixture";
import {
	runWebGL2PortalScopeAtlasExecutorFixture,
	type WebGL2PortalScopeAtlasExecutorFixtureResult,
} from "./webgl2-portal-scope-atlas-executor-fixture";
import {
	runWebGL2PssmFixture,
	type WebGL2PssmFixtureResult,
} from "./webgl2-pssm-fixture";

/** One transient RGBA preview copied from a live two-dimensional GPU texture. */
export interface Texture2DReadback {
	/** Original normalized texture format, used to display one- and two-channel pages faithfully. */
	readonly format: TexturePixelFormat;
	readonly height: number;
	/** Rows preserve the atlas packer's coordinate order for placement-bound overlays. */
	readonly pixels: Uint8Array;
	readonly width: number;
}

/** Cold context identity captured only for an explicitly exported diagnostic report. */
export interface WebGL2DeviceDiagnosticIdentity {
	readonly renderer: string;
	readonly shadingLanguageVersion: string;
	/**
	 * Adapter string behind `WEBGL_debug_renderer_info`, or null where the browser withholds it.
	 *
	 * Non-null is not the same as true. WebKitGTK returns a fabricated value — it reported
	 * "Apple GPU" on an RX 7900 XT — so this field has three states, not two: absent, honest, and
	 * confidently wrong. Never branch on it, and never read it as evidence that timing came from a
	 * real adapter; that is what the harness records `glRenderer` against a known-good host for.
	 */
	readonly unmaskedRenderer: string | null;
	readonly unmaskedVendor: string | null;
	readonly vendor: string;
	readonly version: string;
}

/** Privacy-gated constants exposed by WEBGL_debug_renderer_info when the browser permits it. */
interface WebGLDebugRendererInfo {
	readonly UNMASKED_RENDERER_WEBGL: GLenum;
	readonly UNMASKED_VENDOR_WEBGL: GLenum;
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
				device.probePortalScopeAtlasTargets();
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

	/** Prove the selected scope-atlas attachment formats and lifecycle on this browser context. */
	probePortalScopeAtlasTargets(): WebGL2PortalScopeAtlasTargetsFixtureResult {
		this.#assertReady();
		return runWebGL2PortalScopeAtlasTargetsFixture(this.#gl);
	}

	/** Execute the propagation, envelope, and resolve GLSL against the symbolic oracle. */
	probePortalScopeAtlasExecutor(): WebGL2PortalScopeAtlasExecutorFixtureResult {
		this.#assertReady();
		return runWebGL2PortalScopeAtlasExecutorFixture(this.#gl);
	}

	/** Prove the outdoor depth-array and material-free caster shader on this browser context. */
	probeOutdoorPssm(): WebGL2PssmFixtureResult {
		this.#assertReady();
		return runWebGL2PssmFixture(this.#gl);
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

	/** Read browser and driver identity only when the Explorer creates a diagnostic report. */
	getDiagnosticIdentity(): WebGL2DeviceDiagnosticIdentity {
		this.#assertReady();
		const gl = this.#gl;
		const debug = gl.getExtension(
			"WEBGL_debug_renderer_info",
		) as WebGLDebugRendererInfo | null;
		return {
			renderer: gl.getParameter(gl.RENDERER) as string,
			shadingLanguageVersion: gl.getParameter(
				gl.SHADING_LANGUAGE_VERSION,
			) as string,
			unmaskedRenderer: debug
				? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string)
				: null,
			unmaskedVendor: debug
				? (gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string)
				: null,
			vendor: gl.getParameter(gl.VENDOR) as string,
			version: gl.getParameter(gl.VERSION) as string,
		};
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
