import { describe, expect, it } from "vitest";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import {
	WebGL2SaoScratchTargets,
	saoScratchByteLength,
	scaledSaoExtent,
} from "./webgl2-sao-pass";

const INITIAL_EXTENT = { height: 3, width: 4 } as const;
const RESIZED_EXTENT = { height: 6, width: 8 } as const;

describe("WebGL2 SAO scratch policy", () => {
	it("scales each axis independently and retains a positive minimum extent", () => {
		const scale = FRONTEND_TUNING.rendering.ambientOcclusion.resolutionScale;
		expect(scaledSaoExtent({ height: 721, width: 1_281 }, scale)).toEqual({
			height: Math.floor(721 * scale),
			width: Math.floor(1_281 * scale),
		});
		expect(scaledSaoExtent({ height: 1, width: 1 }, scale)).toEqual({
			height: 1,
			width: 1,
		});
	});

	it("reports the exact two-R8 allocation", () => {
		const extent = scaledSaoExtent(
			{ height: 1_080, width: 1_920 },
			FRONTEND_TUNING.rendering.ambientOcclusion.resolutionScale,
		);
		expect(saoScratchByteLength(extent)).toBe(extent.width * extent.height * 2);
	});

	it("rejects malformed source extents and scales", () => {
		expect(() => scaledSaoExtent({ height: 0, width: 1 }, 0.5)).toThrow(
			"positive source dimensions",
		);
		expect(() => scaledSaoExtent({ height: 1, width: 1 }, 0)).toThrow(
			"scale in (0, 1]",
		);
	});

	it("transactionally replaces, disables, and destroys complete generations", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2SaoScratchTargets(state.gl);
		const first = owner.resize(INITIAL_EXTENT);
		expect(
			owner.resizeDimensions(INITIAL_EXTENT.width, INITIAL_EXTENT.height),
		).toBe(first);
		owner.resize(RESIZED_EXTENT);
		expect(state.deleted).toEqual({ framebuffers: 2, textures: 2 });
		expect(owner.getDiagnostics()).toEqual({
			activeBytes: saoScratchByteLength(RESIZED_EXTENT),
			allocatedGenerationCount: 2,
			disposedGenerationCount: 1,
			extent: RESIZED_EXTENT,
		});
		owner.disable();
		expect(owner.getDiagnostics()).toMatchObject({
			activeBytes: 0,
			disposedGenerationCount: 2,
			extent: null,
		});
		owner.destroy();
		owner.destroy();
		expect(() => owner.resize(INITIAL_EXTENT)).toThrow("have been destroyed");
	});

	it("retains its generation and caller bindings after allocation failure", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2SaoScratchTargets(state.gl);
		const first = owner.resize(INITIAL_EXTENT);
		const unrelated = installUnrelatedBindings(state.gl);
		state.framebufferComplete = false;

		expect(() => owner.resize(RESIZED_EXTENT)).toThrow(
			"first SAO framebuffer is incomplete",
		);
		expect(owner.resize(INITIAL_EXTENT)).toBe(first);
		expect(owner.getDiagnostics()).toMatchObject({
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extent: INITIAL_EXTENT,
		});
		expect(readBindings(state.gl)).toEqual(unrelated);
	});
});

interface ResourceCounts {
	framebuffers: number;
	textures: number;
}

interface FakeWebGL2State {
	readonly deleted: ResourceCounts;
	framebufferComplete: boolean;
	readonly gl: WebGL2RenderingContext;
}

interface BindingSnapshot {
	readonly activeTexture: GLenum;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
}

function createFakeWebGL2(): FakeWebGL2State {
	const constants = {
		ACTIVE_TEXTURE: 0x84e0,
		CLAMP_TO_EDGE: 0x812f,
		COLOR_ATTACHMENT0: 0x8ce0,
		DRAW_FRAMEBUFFER: 0x8ca9,
		DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
		FRAMEBUFFER: 0x8d40,
		FRAMEBUFFER_COMPLETE: 0x8cd5,
		NEAREST: 0x2600,
		R8: 0x8229,
		READ_FRAMEBUFFER: 0x8ca8,
		READ_FRAMEBUFFER_BINDING: 0x8caa,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_BINDING_2D: 0x8069,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
	} as const;
	const deleted = { framebuffers: 0, textures: 0 };
	const textureBindings = new Map<GLenum, WebGLTexture | null>();
	let activeTexture: GLenum = constants.TEXTURE0;
	let createdFramebuffers = 0;
	let createdTextures = 0;
	let drawFramebuffer: WebGLFramebuffer | null = null;
	let framebufferComplete = true;
	let readFramebuffer: WebGLFramebuffer | null = null;
	const gl = {
		...constants,
		activeTexture: (texture: GLenum) => {
			activeTexture = texture;
		},
		bindFramebuffer: (target: GLenum, framebuffer: WebGLFramebuffer | null) => {
			if (
				target === constants.FRAMEBUFFER ||
				target === constants.DRAW_FRAMEBUFFER
			) {
				drawFramebuffer = framebuffer;
			}
			if (
				target === constants.FRAMEBUFFER ||
				target === constants.READ_FRAMEBUFFER
			) {
				readFramebuffer = framebuffer;
			}
		},
		bindTexture: (_target: GLenum, texture: WebGLTexture | null) => {
			textureBindings.set(activeTexture, texture);
		},
		checkFramebufferStatus: () =>
			framebufferComplete ? constants.FRAMEBUFFER_COMPLETE : 0x8cd6,
		createFramebuffer: () =>
			fakeResource<WebGLFramebuffer>("framebuffer", ++createdFramebuffers),
		createTexture: () =>
			fakeResource<WebGLTexture>("texture", ++createdTextures),
		deleteFramebuffer: () => {
			deleted.framebuffers += 1;
		},
		deleteTexture: () => {
			deleted.textures += 1;
		},
		drawBuffers: () => undefined,
		framebufferTexture2D: () => undefined,
		getParameter: (parameter: GLenum): unknown => {
			switch (parameter) {
				case constants.ACTIVE_TEXTURE:
					return activeTexture;
				case constants.DRAW_FRAMEBUFFER_BINDING:
					return drawFramebuffer;
				case constants.READ_FRAMEBUFFER_BINDING:
					return readFramebuffer;
				case constants.TEXTURE_BINDING_2D:
					return textureBindings.get(activeTexture) ?? null;
				default:
					throw new Error(`Unexpected fake WebGL parameter ${parameter}.`);
			}
		},
		readBuffer: () => undefined,
		texParameteri: () => undefined,
		texStorage2D: () => undefined,
	} as unknown as WebGL2RenderingContext;
	return {
		deleted,
		get framebufferComplete() {
			return framebufferComplete;
		},
		set framebufferComplete(value: boolean) {
			framebufferComplete = value;
		},
		gl,
	};
}

function installUnrelatedBindings(gl: WebGL2RenderingContext): BindingSnapshot {
	const drawFramebuffer = fakeResource<WebGLFramebuffer>("draw", 1);
	const readFramebuffer = fakeResource<WebGLFramebuffer>("read", 1);
	const texture0Binding = fakeResource<WebGLTexture>("texture0", 1);
	const activeTextureBinding = fakeResource<WebGLTexture>("texture3", 1);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture0Binding);
	gl.activeTexture(gl.TEXTURE0 + 3);
	gl.bindTexture(gl.TEXTURE_2D, activeTextureBinding);
	return {
		activeTexture: gl.TEXTURE0 + 3,
		activeTextureBinding,
		drawFramebuffer,
		readFramebuffer,
		texture0Binding,
	};
}

function readBindings(gl: WebGL2RenderingContext): BindingSnapshot {
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as GLenum;
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

function fakeResource<T>(kind: string, ordinal: number): T {
	return { kind, ordinal } as T;
}
