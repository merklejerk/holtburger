import { describe, expect, it } from "vitest";
import {
	WebGL2PortalScopeAtlasTargets,
	type PortalScopeAtlasTargetExtents,
} from "./webgl2-portal-scope-atlas-targets";

const INITIAL_EXTENTS = {
	atlas: { height: 4, width: 4 },
	drawingBuffer: { height: 2, width: 2 },
} as const satisfies PortalScopeAtlasTargetExtents;
const RESIZED_EXTENTS = {
	atlas: { height: 4, width: 8 },
	drawingBuffer: { height: 2, width: 4 },
} as const satisfies PortalScopeAtlasTargetExtents;

describe("WebGL2 portal scope-atlas targets", () => {
	it("allocates the fixed format set once and reports exact active bytes", () => {
		const state = createDefaultFakeWebGL2();
		const targets = new WebGL2PortalScopeAtlasTargets(state.gl);

		expect(targets.getDiagnostics()).toEqual({
			activeBytes: 0,
			activeFramebufferCount: 0,
			activeRenderbufferCount: 0,
			activeTextureCount: 0,
			allocatedGenerationCount: 0,
			disposedGenerationCount: 0,
			extents: null,
		});

		const first = targets.resize(INITIAL_EXTENTS);
		const reused = targets.resize({
			atlas: { ...INITIAL_EXTENTS.atlas },
			drawingBuffer: { ...INITIAL_EXTENTS.drawingBuffer },
		});

		expect(reused).toBe(first);
		expect(targets.getTargets()).toBe(first);
		expect(state.created).toEqual({
			framebuffers: 4,
			renderbuffers: 1,
			textures: 5,
		});
		expect(state.framebufferStatusCheckCount).toBe(4);
		expect(state.textureStorage).toEqual([
			{ format: state.gl.RGBA8, height: 4, width: 4 },
			{ format: state.gl.DEPTH_COMPONENT24, height: 4, width: 4 },
			{ format: state.gl.R8UI, height: 2, width: 2 },
			{ format: state.gl.R8UI, height: 2, width: 2 },
			{ format: state.gl.DEPTH_COMPONENT32F, height: 4, width: 4 },
		]);
		expect(state.renderbufferStorage).toEqual([
			{ format: state.gl.DEPTH_COMPONENT24, height: 2, width: 2 },
		]);
		expect(targets.getDiagnostics()).toEqual({
			activeBytes: 216,
			activeFramebufferCount: 4,
			activeRenderbufferCount: 1,
			activeTextureCount: 5,
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extents: INITIAL_EXTENTS,
		});
	});

	it("replaces a complete generation transactionally and disposes once", () => {
		const state = createDefaultFakeWebGL2();
		const targets = new WebGL2PortalScopeAtlasTargets(state.gl);
		const first = targets.resize(INITIAL_EXTENTS);

		const second = targets.resize(RESIZED_EXTENTS);

		expect(second).not.toBe(first);
		expect(targets.getTargets()).toBe(second);
		expect(state.deleted).toEqual({
			framebuffers: 4,
			renderbuffers: 1,
			textures: 5,
		});
		expect(targets.getDiagnostics()).toEqual({
			activeBytes: 432,
			activeFramebufferCount: 4,
			activeRenderbufferCount: 1,
			activeTextureCount: 5,
			allocatedGenerationCount: 2,
			disposedGenerationCount: 1,
			extents: RESIZED_EXTENTS,
		});

		targets.destroy();
		targets.destroy();
		expect(state.deleted).toEqual({
			framebuffers: 8,
			renderbuffers: 2,
			textures: 10,
		});
		expect(targets.getDiagnostics()).toMatchObject({
			activeBytes: 0,
			allocatedGenerationCount: 2,
			disposedGenerationCount: 2,
			extents: null,
		});
		expect(() => targets.getTargets()).toThrow("have been destroyed");
		expect(() => targets.resize(INITIAL_EXTENTS)).toThrow(
			"have been destroyed",
		);
	});

	it("retains the previous generation and restores bindings after replacement failure", () => {
		const state = createDefaultFakeWebGL2();
		const targets = new WebGL2PortalScopeAtlasTargets(state.gl);
		const first = targets.resize(INITIAL_EXTENTS);
		const expectedBindings = installUnrelatedBindings(state.gl);
		state.failFramebufferCheckAt = state.framebufferStatusCheckCount + 3;

		expect(() => targets.resize(RESIZED_EXTENTS)).toThrow(
			"frontier 1 framebuffer is incomplete",
		);

		expect(targets.getTargets()).toBe(first);
		expect(targets.getDiagnostics()).toMatchObject({
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extents: INITIAL_EXTENTS,
		});
		expect(state.deleted).toEqual({
			framebuffers: 3,
			renderbuffers: 1,
			textures: 4,
		});
		expect(readBindings(state.gl)).toEqual(expectedBindings);
	});

	it("rejects impossible extents before allocating resources", () => {
		const state = createFakeWebGL2({
			maximumRenderbufferSize: 4,
			maximumTextureSize: 8,
		});
		const targets = new WebGL2PortalScopeAtlasTargets(state.gl);

		expect(() =>
			targets.resize({
				atlas: { height: 3, width: 3 },
				drawingBuffer: { height: 4, width: 4 },
			}),
		).toThrow("contain the complete drawing-buffer root tile");
		expect(() =>
			targets.resize({
				atlas: { height: 9, width: 8 },
				drawingBuffer: { height: 4, width: 4 },
			}),
		).toThrow("exceeds maximum texture size 8");
		expect(() =>
			targets.resize({
				atlas: { height: 8, width: 8 },
				drawingBuffer: { height: 5, width: 4 },
			}),
		).toThrow("exceeds maximum renderbuffer size 4");
		expect(() =>
			targets.resize({
				atlas: {
					height: Number.MAX_SAFE_INTEGER,
					width: Number.MAX_SAFE_INTEGER,
				},
				drawingBuffer: {
					height: Number.MAX_SAFE_INTEGER,
					width: Number.MAX_SAFE_INTEGER,
				},
			}),
		).toThrow("target byte length exceeds safe integers");
		expect(state.created).toEqual({
			framebuffers: 0,
			renderbuffers: 0,
			textures: 0,
		});
	});
});

interface FakeWebGL2Options {
	readonly maximumRenderbufferSize: number;
	readonly maximumTextureSize: number;
}

interface FakeWebGL2State {
	readonly created: ResourceCounts;
	readonly deleted: ResourceCounts;
	failFramebufferCheckAt: number | null;
	readonly gl: WebGL2RenderingContext;
	readonly framebufferStatusCheckCount: number;
	readonly renderbufferStorage: StorageRecord[];
	readonly textureStorage: StorageRecord[];
}

interface ResourceCounts {
	framebuffers: number;
	renderbuffers: number;
	textures: number;
}

interface StorageRecord {
	readonly format: GLenum;
	readonly height: number;
	readonly width: number;
}

interface BindingSnapshot {
	readonly activeTexture: GLenum;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly renderbuffer: WebGLRenderbuffer | null;
	readonly texture0Binding: WebGLTexture | null;
}

function createDefaultFakeWebGL2(): FakeWebGL2State {
	return createFakeWebGL2({
		maximumRenderbufferSize: 16_384,
		maximumTextureSize: 16_384,
	});
}

function createFakeWebGL2(options: FakeWebGL2Options): FakeWebGL2State {
	const constants = {
		ACTIVE_TEXTURE: 0x84e0,
		CLAMP_TO_EDGE: 0x812f,
		COLOR_ATTACHMENT0: 0x8ce0,
		DEPTH_ATTACHMENT: 0x8d00,
		DEPTH_COMPONENT24: 0x81a6,
		DEPTH_COMPONENT32F: 0x8cac,
		DRAW_FRAMEBUFFER: 0x8ca9,
		DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
		FRAMEBUFFER: 0x8d40,
		FRAMEBUFFER_COMPLETE: 0x8cd5,
		MAX_RENDERBUFFER_SIZE: 0x84e8,
		MAX_TEXTURE_SIZE: 0x0d33,
		NEAREST: 0x2600,
		NONE: 0,
		R8UI: 0x8232,
		READ_FRAMEBUFFER: 0x8ca8,
		READ_FRAMEBUFFER_BINDING: 0x8caa,
		RENDERBUFFER: 0x8d41,
		RENDERBUFFER_BINDING: 0x8ca7,
		RGBA8: 0x8058,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_BINDING_2D: 0x8069,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
	} as const;
	const created: ResourceCounts = {
		framebuffers: 0,
		renderbuffers: 0,
		textures: 0,
	};
	const deleted: ResourceCounts = {
		framebuffers: 0,
		renderbuffers: 0,
		textures: 0,
	};
	const renderbufferStorage: StorageRecord[] = [];
	const textureStorage: StorageRecord[] = [];
	const textureBindings = new Map<GLenum, WebGLTexture | null>();
	let activeTexture: GLenum = constants.TEXTURE0;
	let drawFramebuffer: WebGLFramebuffer | null = null;
	let failFramebufferCheckAt: number | null = null;
	let framebufferStatusCheckCount = 0;
	let readFramebuffer: WebGLFramebuffer | null = null;
	let renderbuffer: WebGLRenderbuffer | null = null;
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
		bindRenderbuffer: (_target: GLenum, value: WebGLRenderbuffer | null) => {
			renderbuffer = value;
		},
		bindTexture: (_target: GLenum, texture: WebGLTexture | null) => {
			textureBindings.set(activeTexture, texture);
		},
		checkFramebufferStatus: () => {
			framebufferStatusCheckCount += 1;
			return failFramebufferCheckAt === framebufferStatusCheckCount
				? 0x8cd6
				: constants.FRAMEBUFFER_COMPLETE;
		},
		createFramebuffer: () =>
			fakeResource<WebGLFramebuffer>("framebuffer", ++created.framebuffers),
		createRenderbuffer: () =>
			fakeResource<WebGLRenderbuffer>("renderbuffer", ++created.renderbuffers),
		createTexture: () =>
			fakeResource<WebGLTexture>("texture", ++created.textures),
		deleteFramebuffer: () => {
			deleted.framebuffers += 1;
		},
		deleteRenderbuffer: () => {
			deleted.renderbuffers += 1;
		},
		deleteTexture: () => {
			deleted.textures += 1;
		},
		drawBuffers: () => undefined,
		framebufferRenderbuffer: () => undefined,
		framebufferTexture2D: () => undefined,
		getParameter: (parameter: GLenum): unknown => {
			switch (parameter) {
				case constants.ACTIVE_TEXTURE:
					return activeTexture;
				case constants.DRAW_FRAMEBUFFER_BINDING:
					return drawFramebuffer;
				case constants.MAX_RENDERBUFFER_SIZE:
					return options.maximumRenderbufferSize;
				case constants.MAX_TEXTURE_SIZE:
					return options.maximumTextureSize;
				case constants.READ_FRAMEBUFFER_BINDING:
					return readFramebuffer;
				case constants.RENDERBUFFER_BINDING:
					return renderbuffer;
				case constants.TEXTURE_BINDING_2D:
					return textureBindings.get(activeTexture) ?? null;
				default:
					throw new Error(`Unexpected fake WebGL parameter ${parameter}.`);
			}
		},
		readBuffer: () => undefined,
		renderbufferStorage: (
			_target: GLenum,
			format: GLenum,
			width: number,
			height: number,
		) => {
			renderbufferStorage.push({ format, height, width });
		},
		texParameteri: () => undefined,
		texStorage2D: (
			_target: GLenum,
			_levels: number,
			format: GLenum,
			width: number,
			height: number,
		) => {
			textureStorage.push({ format, height, width });
		},
	} as unknown as WebGL2RenderingContext;
	const state: FakeWebGL2State = {
		created,
		deleted,
		get failFramebufferCheckAt() {
			return failFramebufferCheckAt;
		},
		set failFramebufferCheckAt(value: number | null) {
			failFramebufferCheckAt = value;
		},
		get framebufferStatusCheckCount() {
			return framebufferStatusCheckCount;
		},
		gl,
		renderbufferStorage,
		textureStorage,
	};
	return state;
}

function installUnrelatedBindings(gl: WebGL2RenderingContext): BindingSnapshot {
	const texture0 = fakeResource<WebGLTexture>("unrelated-texture", 0);
	const activeTextureBinding = fakeResource<WebGLTexture>(
		"unrelated-texture",
		1,
	);
	const drawFramebuffer = fakeResource<WebGLFramebuffer>(
		"unrelated-framebuffer",
		0,
	);
	const readFramebuffer = fakeResource<WebGLFramebuffer>(
		"unrelated-framebuffer",
		1,
	);
	const renderbuffer = fakeResource<WebGLRenderbuffer>(
		"unrelated-renderbuffer",
		0,
	);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture0);
	gl.activeTexture(gl.TEXTURE0 + 1);
	gl.bindTexture(gl.TEXTURE_2D, activeTextureBinding);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
	gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
	return {
		activeTexture: gl.TEXTURE0 + 1,
		activeTextureBinding,
		drawFramebuffer,
		readFramebuffer,
		renderbuffer,
		texture0Binding: texture0,
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
		renderbuffer: gl.getParameter(
			gl.RENDERBUFFER_BINDING,
		) as WebGLRenderbuffer | null,
		texture0Binding,
	};
}

function fakeResource<Resource>(kind: string, id: number): Resource {
	return { id, kind } as Resource;
}
