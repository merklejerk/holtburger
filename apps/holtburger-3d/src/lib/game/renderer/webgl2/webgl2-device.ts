import {
	WebGL2FailureDiagnostics,
	type WebGL2FailureReport,
} from "./webgl2-failure-diagnostics";
import {
	readWebGL2DiagnosticIdentity,
	type WebGL2DeviceDiagnosticIdentity,
} from "./webgl2-diagnostic-identity";
import { WebGL2Renderer } from "./webgl2-renderer";
import { RenderWorld } from "../render-world";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	IntegerTexture2DFormat,
	type Texture2DResourceKey,
} from "../resource-manager";
import { TexturePixelFormat } from "../../textures/types";
import type { TextureFilteringCapabilities } from "./texture-filtering-policy";
import {
	probeWebGL2TextureFilteringSupport,
	type WebGL2TextureFilteringSupport,
} from "./webgl2-texture-filtering-support";
import type { PortalWarpDriveTuning } from "../portal/portal-warp-drive-tuning";

/** One transient RGBA preview copied from a live two-dimensional GPU texture. */
export interface Texture2DReadback {
	/** Original normalized texture format, used to display one- and two-channel pages faithfully. */
	readonly format: TexturePixelFormat;
	readonly height: number;
	/** Rows preserve the atlas packer's coordinate order for placement-bound overlays. */
	readonly pixels: Uint8Array;
	readonly width: number;
}

/** Whole-device lifecycle state; a lost context requires rebuilding the complete runtime. */
export type WebGL2DeviceStatus =
	| { readonly kind: "ready" }
	| { readonly kind: "restart-required"; readonly reason: "context-lost" }
	| { readonly kind: "destroyed" };

/** One WebGL2 context composed with all backend services that consume it. */
export class WebGL2Device {
	readonly resources: WebGL2ResourceManager;
	/** Canvas whose context owns every backend resource allocated by this device. */
	readonly #canvas: HTMLCanvasElement;
	/** Context retained so this device, rather than one renderer, owns context loss. */
	readonly #gl: WebGL2RenderingContext;
	/** First-failure recorder remains valid after the context is lost. */
	readonly #failureDiagnostics: WebGL2FailureDiagnostics;
	/** One context-lifetime filtering probe shared by UI capability and backend sampler consumers. */
	readonly #textureFilteringSupport: WebGL2TextureFilteringSupport;
	/** Frontend-selected portal look retained for every renderer built on this device. */
	readonly #portalWarpDriveTuning: PortalWarpDriveTuning;
	#status: WebGL2DeviceStatus = { kind: "ready" };
	readonly #onContextLost = (event: Event): void => {
		event.preventDefault();
		if (this.#status.kind === "ready") {
			this.#status = {
				kind: "restart-required",
				reason: "context-lost",
			};
		}
		this.#failureDiagnostics.fail(
			`WebGL2 context lost: ${(event as WebGLContextEvent).statusMessage || "no browser status message"}`,
		);
	};
	readonly #onContextRestored = (): void => {
		// Restoration cannot revive resource handles or upload descriptions owned by this device.
	};

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		textureFilteringSupport: WebGL2TextureFilteringSupport,
		portalWarpDriveTuning: PortalWarpDriveTuning,
		failureDiagnostics: WebGL2FailureDiagnostics,
	) {
		this.#failureDiagnostics = failureDiagnostics;
		this.#canvas = canvas;
		this.#gl = gl;
		this.resources = resources;
		this.#textureFilteringSupport = textureFilteringSupport;
		this.#portalWarpDriveTuning = portalWarpDriveTuning;
		this.#canvas.addEventListener("webglcontextlost", this.#onContextLost);
		this.#canvas.addEventListener(
			"webglcontextrestored",
			this.#onContextRestored,
		);
	}

	static async build(
		canvas: HTMLCanvasElement,
		portalWarpDriveTuning: PortalWarpDriveTuning,
		options: {
			readonly checkUploadErrors: boolean;
			readonly onFailure?: (report: WebGL2FailureReport) => void;
		},
	): Promise<WebGL2Device> {
		const gl = canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			depth: true,
			// Prefer rendering performance on hybrid GPUs; the browser may ignore this hint.
			powerPreference: "high-performance",
			premultipliedAlpha: false,
			stencil: true,
		});
		if (!gl) throw new Error("WebGL2 is not available in this browser.");

		const failureDiagnostics = new WebGL2FailureDiagnostics(
			gl,
			(report) => {
				if (options.onFailure) options.onFailure(report);
				else console.error("WebGL2 failure", JSON.stringify(report));
			},
			options.checkUploadErrors,
		);
		const resources = new WebGL2ResourceManager(gl);
		const textureFilteringSupport = probeWebGL2TextureFilteringSupport(gl);
		return new WebGL2Device(
			canvas,
			gl,
			resources,
			textureFilteringSupport,
			portalWarpDriveTuning,
			failureDiagnostics,
		);
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
			this.#portalWarpDriveTuning,
			() => this.#assertReady(),
		);
	}

	/** Execute a harness diagnostic against the live GL context while enforcing device readiness. */
	runDiagnostic<T>(probe: (gl: WebGL2RenderingContext) => T): T {
		this.#assertReady();
		return probe(this.#gl);
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
		return readWebGL2DiagnosticIdentity(this.#gl);
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
}
