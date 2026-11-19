import { describe, expect, it } from "vitest";
import { WebGL2TransitionSnapshot } from "./webgl2-transition-snapshot";

const INITIAL_EXTENT = { height: 3, width: 4 } as const;
const RESIZED_EXTENT = { height: 6, width: 8 } as const;

describe("WebGL2 transition snapshot", () => {
	it("captures once, preserves bindings, and reports exact transient bytes", () => {
		const state = createFakeWebGL2();
		const snapshot = new WebGL2TransitionSnapshot(state.gl);
		const bindings = installUnrelatedBindings(state.gl);
		const source = fakeResource<WebGLFramebuffer>("source", 1);

		const first = snapshot.capture(source, INITIAL_EXTENT);
		const second = snapshot.capture(source, INITIAL_EXTENT);

		expect(second).toBe(first);
		expect(state.createdTextures).toBe(1);
		expect(state.copiedExtents).toEqual([INITIAL_EXTENT, INITIAL_EXTENT]);
		expect(readBindings(state.gl)).toEqual(bindings);
		expect(snapshot.getDiagnostics()).toEqual({
			activeBytes: INITIAL_EXTENT.width * INITIAL_EXTENT.height * 4,
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extent: INITIAL_EXTENT,
		});
	});

	it("replaces a resized source and releases it exactly once", () => {
		const state = createFakeWebGL2();
		const snapshot = new WebGL2TransitionSnapshot(state.gl);
		const source = fakeResource<WebGLFramebuffer>("source", 1);

		snapshot.capture(source, INITIAL_EXTENT);
		snapshot.capture(source, RESIZED_EXTENT);
		expect(state.createdTextures).toBe(2);
		expect(state.deletedTextures).toBe(1);
		expect(snapshot.getDiagnostics()).toMatchObject({
			activeBytes: RESIZED_EXTENT.width * RESIZED_EXTENT.height * 4,
			allocatedGenerationCount: 2,
			disposedGenerationCount: 1,
			extent: RESIZED_EXTENT,
		});

		snapshot.clear();
		snapshot.destroy();
		expect(state.deletedTextures).toBe(2);
		expect(snapshot.getDiagnostics()).toMatchObject({
			activeBytes: 0,
			disposedGenerationCount: 2,
			extent: null,
		});
		expect(() => snapshot.capture(source, INITIAL_EXTENT)).toThrow(
			"has been destroyed",
		);
	});
});

interface BindingSnapshot {
	readonly activeTexture: GLenum;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
}

interface FakeWebGL2State {
	readonly copiedExtents: RenderExtentLike[];
	readonly gl: WebGL2RenderingContext;
	readonly createdTextures: number;
	readonly deletedTextures: number;
}

interface RenderExtentLike {
	readonly height: number;
	readonly width: number;
}

function createFakeWebGL2(): FakeWebGL2State {
	const constants = {
		ACTIVE_TEXTURE: 0x84e0,
		CLAMP_TO_EDGE: 0x812f,
		DRAW_FRAMEBUFFER: 0x8ca9,
		DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
		NEAREST: 0x2600,
		READ_FRAMEBUFFER: 0x8ca8,
		READ_FRAMEBUFFER_BINDING: 0x8caa,
		RGBA: 0x1908,
		RGBA8: 0x8058,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_BINDING_2D: 0x8069,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
		UNSIGNED_BYTE: 0x1401,
	} as const;
	const textureBindings = new Map<GLenum, WebGLTexture | null>();
	const copiedExtents: RenderExtentLike[] = [];
	let activeTexture: GLenum = constants.TEXTURE0;
	let createdTextures = 0;
	let deletedTextures = 0;
	let drawFramebuffer: WebGLFramebuffer | null = null;
	let readFramebuffer: WebGLFramebuffer | null = null;
	const gl = {
		...constants,
		activeTexture: (texture: GLenum) => {
			activeTexture = texture;
		},
		bindFramebuffer: (target: GLenum, framebuffer: WebGLFramebuffer | null) => {
			if (target === constants.DRAW_FRAMEBUFFER) drawFramebuffer = framebuffer;
			if (target === constants.READ_FRAMEBUFFER) readFramebuffer = framebuffer;
		},
		bindTexture: (_target: GLenum, texture: WebGLTexture | null) => {
			textureBindings.set(activeTexture, texture);
		},
		copyTexSubImage2D: (
			_target: GLenum,
			_level: number,
			_xOffset: number,
			_yOffset: number,
			_x: number,
			_y: number,
			width: number,
			height: number,
		) => {
			copiedExtents.push({ height, width });
		},
		createTexture: () =>
			fakeResource<WebGLTexture>("texture", ++createdTextures),
		deleteTexture: () => {
			deletedTextures += 1;
		},
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
		texImage2D: () => undefined,
		texParameteri: () => undefined,
	} as unknown as WebGL2RenderingContext;
	return {
		copiedExtents,
		get createdTextures() {
			return createdTextures;
		},
		get deletedTextures() {
			return deletedTextures;
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
