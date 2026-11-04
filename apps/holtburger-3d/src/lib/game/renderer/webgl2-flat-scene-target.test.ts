import { describe, expect, it } from "vitest";
import {
	WebGL2FlatSceneTarget,
	flatSceneTargetByteLength,
} from "./webgl2-flat-scene-target";

const INITIAL_EXTENT = { height: 3, width: 4 } as const;
const RESIZED_EXTENT = { height: 6, width: 8 } as const;

describe("WebGL2 flat scene target", () => {
	it("allocates fixed RGBA8 and D24 attachments once", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2FlatSceneTarget(state.gl);

		expect(owner.getDiagnostics()).toEqual({
			activeBytes: 0,
			activeFramebufferCount: 0,
			activeTextureCount: 0,
			allocatedGenerationCount: 0,
			disposedGenerationCount: 0,
			extent: null,
		});
		const first = owner.resize(INITIAL_EXTENT);
		expect(
			owner.resizeDimensions(INITIAL_EXTENT.width, INITIAL_EXTENT.height),
		).toBe(first);
		expect(state.created).toEqual({ framebuffers: 1, textures: 2 });
		expect(state.textureStorage).toEqual([
			{ format: state.gl.RGBA8, ...INITIAL_EXTENT },
			{ format: state.gl.DEPTH_COMPONENT24, ...INITIAL_EXTENT },
		]);
		expect(owner.getDiagnostics()).toEqual({
			activeBytes: flatSceneTargetByteLength(INITIAL_EXTENT),
			activeFramebufferCount: 1,
			activeTextureCount: 2,
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extent: INITIAL_EXTENT,
		});
	});

	it("transactionally replaces and destroys complete generations", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2FlatSceneTarget(state.gl);
		owner.resize(INITIAL_EXTENT);
		owner.resize(RESIZED_EXTENT);

		expect(state.deleted).toEqual({ framebuffers: 1, textures: 2 });
		expect(owner.getDiagnostics()).toMatchObject({
			activeBytes: flatSceneTargetByteLength(RESIZED_EXTENT),
			allocatedGenerationCount: 2,
			disposedGenerationCount: 1,
			extent: RESIZED_EXTENT,
		});
		owner.destroy();
		owner.destroy();
		expect(state.deleted).toEqual({ framebuffers: 2, textures: 4 });
		expect(owner.getDiagnostics()).toMatchObject({
			activeBytes: 0,
			disposedGenerationCount: 2,
			extent: null,
		});
		expect(() => owner.resize(INITIAL_EXTENT)).toThrow("has been destroyed");
	});

	it("retains the previous generation and bindings after allocation failure", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2FlatSceneTarget(state.gl);
		const first = owner.resize(INITIAL_EXTENT);
		const unrelated = installUnrelatedBindings(state.gl);
		state.framebufferComplete = false;

		expect(() => owner.resize(RESIZED_EXTENT)).toThrow(
			"Flat scene framebuffer is incomplete",
		);
		expect(owner.resize(INITIAL_EXTENT)).toBe(first);
		expect(owner.getDiagnostics()).toMatchObject({
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extent: INITIAL_EXTENT,
		});
		expect(readBindings(state.gl)).toEqual(unrelated);
	});

	it("rejects invalid or unsupported extents before allocation", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2FlatSceneTarget(state.gl);
		expect(() => owner.resize({ height: 0, width: 1 })).toThrow(
			"positive integers",
		);
		expect(() => owner.resize({ height: 1, width: 16_385 })).toThrow(
			"exceeds maximum texture size",
		);
		expect(() =>
			flatSceneTargetByteLength({
				height: Number.MAX_SAFE_INTEGER,
				width: Number.MAX_SAFE_INTEGER,
			}),
		).toThrow("byte length exceeds safe integers");
		expect(state.created).toEqual({ framebuffers: 0, textures: 0 });
	});
});

interface ResourceCounts {
	framebuffers: number;
	textures: number;
}

interface FakeWebGL2State {
	readonly created: ResourceCounts;
	readonly deleted: ResourceCounts;
	framebufferComplete: boolean;
	readonly gl: WebGL2RenderingContext;
	readonly textureStorage: Array<{
		readonly format: GLenum;
		readonly height: number;
		readonly width: number;
	}>;
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
		DEPTH_ATTACHMENT: 0x8d00,
		DEPTH_COMPONENT24: 0x81a6,
		DRAW_FRAMEBUFFER: 0x8ca9,
		DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
		FRAMEBUFFER: 0x8d40,
		FRAMEBUFFER_COMPLETE: 0x8cd5,
		MAX_TEXTURE_SIZE: 0x0d33,
		NEAREST: 0x2600,
		READ_FRAMEBUFFER: 0x8ca8,
		READ_FRAMEBUFFER_BINDING: 0x8caa,
		RGBA8: 0x8058,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_BINDING_2D: 0x8069,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
	} as const;
	const created = { framebuffers: 0, textures: 0 };
	const deleted = { framebuffers: 0, textures: 0 };
	const textureStorage: FakeWebGL2State["textureStorage"] = [];
	const textureBindings = new Map<GLenum, WebGLTexture | null>();
	let activeTexture: GLenum = constants.TEXTURE0;
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
			fakeResource<WebGLFramebuffer>("framebuffer", ++created.framebuffers),
		createTexture: () =>
			fakeResource<WebGLTexture>("texture", ++created.textures),
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
				case constants.MAX_TEXTURE_SIZE:
					return 16_384;
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
	return {
		created,
		deleted,
		get framebufferComplete() {
			return framebufferComplete;
		},
		set framebufferComplete(value: boolean) {
			framebufferComplete = value;
		},
		gl,
		textureStorage,
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
