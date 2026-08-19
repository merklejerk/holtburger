import {
	type WebGL2RenderExtent,
	validateWebGL2RenderExtent,
	withPreservedWebGL2AllocationBindings,
} from "./webgl2-render-target";

const RGBA8_BYTES_PER_PIXEL = 4;
const DEPTH_COMPONENT24_BYTES_PER_PIXEL = 4;
const DEPTH_COMPONENT32F_BYTES_PER_PIXEL = 4;
const R8UI_BYTES_PER_PIXEL = 1;

/** Independent extents for atlas-local scene data and screen-space propagation state. */
export interface PortalScopeAtlasTargetExtents {
	/** Packed scope tiles; this extent is never smaller than the drawing buffer. */
	readonly atlas: WebGL2RenderExtent;
	/** One arrival state and nearest-crossing depth per destination pixel. */
	readonly drawingBuffer: WebGL2RenderExtent;
}

/** Scope-local opaque color and sampleable depth retained through final composition. */
interface WebGL2PortalScopeAtlasSceneTarget {
	readonly color: WebGLTexture;
	readonly depth: WebGLTexture;
	readonly framebuffer: WebGLFramebuffer;
}

/** One half of the fixed ping-pong arrival-state pair. */
interface WebGL2PortalScopeAtlasFrontierTarget {
	readonly framebuffer: WebGLFramebuffer;
	readonly state: WebGLTexture;
}

/** Encoded maximum exit per packed scope pixel; finite depths are scaled below the sentinels. */
interface WebGL2PortalScopeEnvelopeTarget {
	readonly depth: WebGLTexture;
	readonly framebuffer: WebGLFramebuffer;
}

/** One complete generation of fixed portal-compositing attachments. */
export interface WebGL2PortalScopeAtlasTargetSet {
	readonly envelope: WebGL2PortalScopeEnvelopeTarget;
	readonly extents: PortalScopeAtlasTargetExtents;
	/** Shared sampleable nearest-crossing depth, cleared before writing either frontier output. */
	readonly frontierDepth: WebGLTexture;
	readonly frontiers: readonly [
		WebGL2PortalScopeAtlasFrontierTarget,
		WebGL2PortalScopeAtlasFrontierTarget,
	];
	readonly scene: WebGL2PortalScopeAtlasSceneTarget;
}

/** Explicit allocation facts; queried diagnostics are outside the accepted-frame hot path. */
export interface WebGL2PortalScopeAtlasTargetDiagnostics {
	readonly activeBytes: number;
	readonly activeFramebufferCount: number;
	readonly activeTextureCount: number;
	readonly allocatedGenerationCount: number;
	readonly disposedGenerationCount: number;
	readonly extents: PortalScopeAtlasTargetExtents | null;
}

/**
 * Renderer-owned fixed attachment lifecycle for arrival-state scope-atlas composition.
 *
 * Construction and same-extent resize allocate nothing. A changed extent is transactional: the
 * previous complete generation remains active until every replacement framebuffer is complete.
 */
export class WebGL2PortalScopeAtlasTargets {
	readonly #gl: WebGL2RenderingContext;
	#allocatedGenerationCount = 0;
	#destroyed = false;
	#disposedGenerationCount = 0;
	#targets: WebGL2PortalScopeAtlasTargetSet | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** Allocate or reuse the one complete attachment generation. */
	resize(
		extents: PortalScopeAtlasTargetExtents,
	): WebGL2PortalScopeAtlasTargetSet {
		this.#assertAlive();
		validateTargetExtents(extents);
		const current = this.#targets;
		if (current && sameTargetExtents(current.extents, extents)) {
			return current;
		}
		this.#validateDeviceCapacity(extents);
		const replacement = withPreservedWebGL2AllocationBindings(this.#gl, () =>
			allocateTargetSet(this.#gl, extents),
		);
		const previous = this.#targets;
		this.#targets = replacement;
		this.#allocatedGenerationCount += 1;
		if (previous) this.#disposeTargetSet(previous);
		return replacement;
	}

	/** Return the complete active generation without manufacturing a partial fallback. */
	getTargets(): WebGL2PortalScopeAtlasTargetSet {
		this.#assertAlive();
		if (!this.#targets) {
			throw new Error("Portal scope-atlas targets have no render extents.");
		}
		return this.#targets;
	}

	/** Copy cold lifecycle diagnostics without retaining them in frame state. */
	getDiagnostics(): WebGL2PortalScopeAtlasTargetDiagnostics {
		const extents = this.#targets?.extents ?? null;
		return {
			activeBytes: extents ? portalScopeAtlasTargetByteLength(extents) : 0,
			activeFramebufferCount: this.#targets ? 4 : 0,
			activeTextureCount: this.#targets ? 6 : 0,
			allocatedGenerationCount: this.#allocatedGenerationCount,
			disposedGenerationCount: this.#disposedGenerationCount,
			extents: extents ? copyTargetExtents(extents) : null,
		};
	}

	/** Release the active generation once; context restoration is owned by whole-device restart. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (!this.#targets) return;
		this.#disposeTargetSet(this.#targets);
		this.#targets = null;
	}

	#disposeTargetSet(targets: WebGL2PortalScopeAtlasTargetSet): void {
		disposeTargetSet(this.#gl, targets);
		this.#disposedGenerationCount += 1;
	}

	#validateDeviceCapacity(extents: PortalScopeAtlasTargetExtents): void {
		const maximumTextureSize = requirePositiveDeviceLimit(
			this.#gl.getParameter(this.#gl.MAX_TEXTURE_SIZE),
			"MAX_TEXTURE_SIZE",
		);
		for (const [owner, extent] of [
			["atlas", extents.atlas],
			["drawing buffer", extents.drawingBuffer],
		] as const) {
			if (
				extent.width > maximumTextureSize ||
				extent.height > maximumTextureSize
			) {
				throw new Error(
					`Portal scope-atlas ${owner} extent ${extent.width}x${extent.height} exceeds maximum texture size ${maximumTextureSize}.`,
				);
			}
		}
	}

	#assertAlive(): void {
		if (this.#destroyed) {
			throw new Error("Portal scope-atlas targets have been destroyed.");
		}
	}
}

function allocateTargetSet(
	gl: WebGL2RenderingContext,
	extents: PortalScopeAtlasTargetExtents,
): WebGL2PortalScopeAtlasTargetSet {
	const framebuffers: WebGLFramebuffer[] = [];
	const textures: WebGLTexture[] = [];
	try {
		const sceneFramebuffer = createFramebuffer(
			gl,
			framebuffers,
			"scene framebuffer",
		);
		const sceneColor = createTexture(gl, textures, "scene color texture");
		initializeTexture(gl, sceneColor, gl.RGBA8, extents.atlas);
		const sceneDepth = createTexture(gl, textures, "scene depth texture");
		initializeTexture(gl, sceneDepth, gl.DEPTH_COMPONENT24, extents.atlas);
		gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			sceneColor,
			0,
		);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.TEXTURE_2D,
			sceneDepth,
			0,
		);
		configureColorFramebuffer(gl);
		requireCompleteFramebuffer(gl, "scene framebuffer");

		const frontierDepth = createTexture(gl, textures, "frontier depth texture");
		initializeTexture(
			gl,
			frontierDepth,
			gl.DEPTH_COMPONENT24,
			extents.drawingBuffer,
		);
		const firstFrontier = allocateFrontierTarget(
			gl,
			0,
			extents.drawingBuffer,
			frontierDepth,
			framebuffers,
			textures,
		);
		const secondFrontier = allocateFrontierTarget(
			gl,
			1,
			extents.drawingBuffer,
			frontierDepth,
			framebuffers,
			textures,
		);
		const frontiers = [firstFrontier, secondFrontier] as const;

		const envelopeFramebuffer = createFramebuffer(
			gl,
			framebuffers,
			"scope-envelope framebuffer",
		);
		const envelopeDepth = createTexture(
			gl,
			textures,
			"scope-envelope depth texture",
		);
		initializeTexture(gl, envelopeDepth, gl.DEPTH_COMPONENT32F, extents.atlas);
		gl.bindFramebuffer(gl.FRAMEBUFFER, envelopeFramebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.TEXTURE_2D,
			envelopeDepth,
			0,
		);
		gl.drawBuffers([gl.NONE]);
		gl.readBuffer(gl.NONE);
		requireCompleteFramebuffer(gl, "scope-envelope framebuffer");

		return {
			envelope: { depth: envelopeDepth, framebuffer: envelopeFramebuffer },
			extents: copyTargetExtents(extents),
			frontierDepth,
			frontiers,
			scene: {
				color: sceneColor,
				depth: sceneDepth,
				framebuffer: sceneFramebuffer,
			},
		};
	} catch (cause) {
		for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
		for (const texture of textures) gl.deleteTexture(texture);
		throw cause;
	}
}

function allocateFrontierTarget(
	gl: WebGL2RenderingContext,
	ordinal: 0 | 1,
	extent: WebGL2RenderExtent,
	depth: WebGLTexture,
	framebuffers: WebGLFramebuffer[],
	textures: WebGLTexture[],
): WebGL2PortalScopeAtlasFrontierTarget {
	const framebuffer = createFramebuffer(
		gl,
		framebuffers,
		`frontier ${ordinal} framebuffer`,
	);
	const state = createTexture(
		gl,
		textures,
		`frontier ${ordinal} state texture`,
	);
	initializeTexture(gl, state, gl.R8UI, extent);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		state,
		0,
	);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.DEPTH_ATTACHMENT,
		gl.TEXTURE_2D,
		depth,
		0,
	);
	configureColorFramebuffer(gl);
	requireCompleteFramebuffer(gl, `frontier ${ordinal} framebuffer`);
	return { framebuffer, state };
}

function initializeTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	internalFormat: GLenum,
	extent: WebGL2RenderExtent,
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

function configureColorFramebuffer(gl: WebGL2RenderingContext): void {
	gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
	gl.readBuffer(gl.COLOR_ATTACHMENT0);
}

function requireCompleteFramebuffer(
	gl: WebGL2RenderingContext,
	owner: string,
): void {
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		throw new Error(
			`Portal scope-atlas ${owner} is incomplete with status ${status}.`,
		);
	}
}

function createFramebuffer(
	gl: WebGL2RenderingContext,
	resources: WebGLFramebuffer[],
	owner: string,
): WebGLFramebuffer {
	const resource = gl.createFramebuffer();
	if (!resource) {
		throw new Error(`Failed to allocate portal scope-atlas ${owner}.`);
	}
	resources.push(resource);
	return resource;
}

function createTexture(
	gl: WebGL2RenderingContext,
	resources: WebGLTexture[],
	owner: string,
): WebGLTexture {
	const resource = gl.createTexture();
	if (!resource) {
		throw new Error(`Failed to allocate portal scope-atlas ${owner}.`);
	}
	resources.push(resource);
	return resource;
}

function disposeTargetSet(
	gl: WebGL2RenderingContext,
	targets: WebGL2PortalScopeAtlasTargetSet,
): void {
	gl.deleteFramebuffer(targets.scene.framebuffer);
	gl.deleteFramebuffer(targets.frontiers[0].framebuffer);
	gl.deleteFramebuffer(targets.frontiers[1].framebuffer);
	gl.deleteFramebuffer(targets.envelope.framebuffer);
	gl.deleteTexture(targets.scene.color);
	gl.deleteTexture(targets.scene.depth);
	gl.deleteTexture(targets.frontiers[0].state);
	gl.deleteTexture(targets.frontiers[1].state);
	gl.deleteTexture(targets.frontierDepth);
	gl.deleteTexture(targets.envelope.depth);
}

function validateTargetExtents(extents: PortalScopeAtlasTargetExtents): void {
	validateWebGL2RenderExtent(extents.atlas, "Portal scope atlas");
	validateWebGL2RenderExtent(
		extents.drawingBuffer,
		"Portal scope-atlas drawing buffer",
	);
	if (
		extents.atlas.width < extents.drawingBuffer.width ||
		extents.atlas.height < extents.drawingBuffer.height
	) {
		throw new Error(
			"Portal scope atlas must contain the complete drawing-buffer root tile.",
		);
	}
	const byteLength = portalScopeAtlasTargetByteLength(extents);
	if (!Number.isSafeInteger(byteLength)) {
		throw new Error(
			"Portal scope-atlas target byte length exceeds safe integers.",
		);
	}
}

/** Exact configured attachment bytes, excluding opaque driver-owned framebuffer metadata. */
export function portalScopeAtlasTargetByteLength(
	extents: PortalScopeAtlasTargetExtents,
): number {
	const atlasPixels = extents.atlas.width * extents.atlas.height;
	const drawingBufferPixels =
		extents.drawingBuffer.width * extents.drawingBuffer.height;
	return (
		atlasPixels *
			(RGBA8_BYTES_PER_PIXEL +
				DEPTH_COMPONENT24_BYTES_PER_PIXEL +
				DEPTH_COMPONENT32F_BYTES_PER_PIXEL) +
		drawingBufferPixels *
			(2 * R8UI_BYTES_PER_PIXEL + DEPTH_COMPONENT24_BYTES_PER_PIXEL)
	);
}

function sameTargetExtents(
	left: PortalScopeAtlasTargetExtents | null,
	right: PortalScopeAtlasTargetExtents,
): boolean {
	return (
		left !== null &&
		left.atlas.width === right.atlas.width &&
		left.atlas.height === right.atlas.height &&
		left.drawingBuffer.width === right.drawingBuffer.width &&
		left.drawingBuffer.height === right.drawingBuffer.height
	);
}

function copyTargetExtents(
	extents: PortalScopeAtlasTargetExtents,
): PortalScopeAtlasTargetExtents {
	return {
		atlas: { ...extents.atlas },
		drawingBuffer: { ...extents.drawingBuffer },
	};
}

function requirePositiveDeviceLimit(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`WebGL2 ${name} must be a positive safe integer.`);
	}
	return value;
}
