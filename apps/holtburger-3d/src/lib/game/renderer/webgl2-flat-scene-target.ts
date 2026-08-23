import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";
import {
	type RenderExtent,
	validateRenderDimensions,
	validateRenderExtent,
} from "./render-extent";

const FLAT_SCENE_BYTES_PER_PIXEL = 8;

/** Complete opaque flat-scene generation retained through presentation. */
export interface WebGL2FlatSceneTargetSet {
	readonly color: WebGLTexture;
	readonly depth: WebGLTexture;
	readonly extent: RenderExtent;
	readonly framebuffer: WebGLFramebuffer;
}

/** Explicit flat-scene target lifecycle facts exposed through renderer diagnostics. */
export interface WebGL2FlatSceneTargetDiagnostics {
	readonly activeBytes: number;
	readonly activeFramebufferCount: number;
	readonly activeTextureCount: number;
	readonly allocatedGenerationCount: number;
	readonly disposedGenerationCount: number;
	readonly extent: RenderExtent | null;
}

/** Renderer-owned RGBA8 and D24 attachments for the unconditional flat presentation path. */
export class WebGL2FlatSceneTarget {
	readonly #gl: WebGL2RenderingContext;
	#allocatedGenerationCount = 0;
	#destroyed = false;
	#disposedGenerationCount = 0;
	#target: WebGL2FlatSceneTargetSet | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** Allocate or reuse one complete target generation without publishing partial resources. */
	resize(extent: RenderExtent): WebGL2FlatSceneTargetSet {
		validateRenderExtent(extent, "Flat scene target");
		return this.resizeDimensions(extent.width, extent.height);
	}

	/** Reuse a generation from scalar frame dimensions without allocating an extent record. */
	resizeDimensions(width: number, height: number): WebGL2FlatSceneTargetSet {
		this.#assertAlive();
		validateRenderDimensions(width, height, "Flat scene target");
		flatSceneTargetByteLengthFromDimensions(width, height);
		const current = this.#target;
		if (
			current &&
			current.extent.width === width &&
			current.extent.height === height
		) {
			return current;
		}
		this.#validateDeviceCapacity(width, height);
		const extent = { height, width };

		const replacement = withPreservedWebGL2AllocationBindings(this.#gl, () =>
			allocateTarget(this.#gl, extent),
		);
		const previous = this.#target;
		this.#target = replacement;
		this.#allocatedGenerationCount += 1;
		if (previous) this.#disposeTarget(previous);
		return replacement;
	}

	/** Exact live attachment bytes without allocating a diagnostic snapshot. */
	get activeBytes(): number {
		return this.#target ? flatSceneTargetByteLength(this.#target.extent) : 0;
	}

	/** Live framebuffer count without allocating a diagnostic snapshot. */
	get activeFramebufferCount(): number {
		return this.#target ? 1 : 0;
	}

	/** Complete generations allocated over this owner's lifetime. */
	get allocatedGenerationCount(): number {
		return this.#allocatedGenerationCount;
	}

	/** Complete generations disposed over this owner's lifetime. */
	get disposedGenerationCount(): number {
		return this.#disposedGenerationCount;
	}

	/** Return lifecycle diagnostics without retaining a mutable extent reference. */
	getDiagnostics(): WebGL2FlatSceneTargetDiagnostics {
		const extent = this.#target?.extent ?? null;
		return {
			activeBytes: extent ? flatSceneTargetByteLength(extent) : 0,
			activeFramebufferCount: this.#target ? 1 : 0,
			activeTextureCount: this.#target ? 2 : 0,
			allocatedGenerationCount: this.#allocatedGenerationCount,
			disposedGenerationCount: this.#disposedGenerationCount,
			extent: extent ? { ...extent } : null,
		};
	}

	/** Release the active generation exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (!this.#target) return;
		this.#disposeTarget(this.#target);
		this.#target = null;
	}

	#disposeTarget(target: WebGL2FlatSceneTargetSet): void {
		this.#gl.deleteFramebuffer(target.framebuffer);
		this.#gl.deleteTexture(target.color);
		this.#gl.deleteTexture(target.depth);
		this.#disposedGenerationCount += 1;
	}

	#validateDeviceCapacity(width: number, height: number): void {
		const maximumTextureSize = this.#gl.getParameter(
			this.#gl.MAX_TEXTURE_SIZE,
		) as unknown;
		if (
			typeof maximumTextureSize !== "number" ||
			!Number.isSafeInteger(maximumTextureSize) ||
			maximumTextureSize <= 0
		) {
			throw new Error(
				"WebGL2 MAX_TEXTURE_SIZE must be a positive safe integer.",
			);
		}
		if (width > maximumTextureSize || height > maximumTextureSize) {
			throw new Error(
				`Flat scene target extent ${width}x${height} exceeds maximum texture size ${maximumTextureSize}.`,
			);
		}
	}

	#assertAlive(): void {
		if (this.#destroyed)
			throw new Error("Flat scene target has been destroyed.");
	}
}

/** Exact configured color/depth texture bytes, excluding framebuffer metadata. */
export function flatSceneTargetByteLength(extent: RenderExtent): number {
	validateRenderExtent(extent, "Flat scene target");
	return flatSceneTargetByteLengthFromDimensions(extent.width, extent.height);
}

function flatSceneTargetByteLengthFromDimensions(
	width: number,
	height: number,
): number {
	const byteLength = width * height * FLAT_SCENE_BYTES_PER_PIXEL;
	if (!Number.isSafeInteger(byteLength)) {
		throw new Error("Flat scene target byte length exceeds safe integers.");
	}
	return byteLength;
}

function allocateTarget(
	gl: WebGL2RenderingContext,
	extent: RenderExtent,
): WebGL2FlatSceneTargetSet {
	const framebuffer = gl.createFramebuffer();
	if (!framebuffer)
		throw new Error("Failed to allocate flat scene framebuffer.");
	const textures: WebGLTexture[] = [];
	try {
		const color = createTexture(gl, textures, "color");
		initializeTexture(gl, color, gl.RGBA8, extent);
		const depth = createTexture(gl, textures, "depth");
		initializeTexture(gl, depth, gl.DEPTH_COMPONENT24, extent);
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
			gl.DEPTH_ATTACHMENT,
			gl.TEXTURE_2D,
			depth,
			0,
		);
		gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
		gl.readBuffer(gl.COLOR_ATTACHMENT0);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error(
				`Flat scene framebuffer is incomplete with status ${status}.`,
			);
		}
		return { color, depth, extent: { ...extent }, framebuffer };
	} catch (cause) {
		gl.deleteFramebuffer(framebuffer);
		for (const texture of textures) gl.deleteTexture(texture);
		throw cause;
	}
}

function createTexture(
	gl: WebGL2RenderingContext,
	resources: WebGLTexture[],
	owner: string,
): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture)
		throw new Error(`Failed to allocate flat scene ${owner} texture.`);
	resources.push(texture);
	return texture;
}

function initializeTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	internalFormat: GLenum,
	extent: RenderExtent,
): void {
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texStorage2D(
		gl.TEXTURE_2D,
		1,
		internalFormat,
		extent.width,
		extent.height,
	);
}
