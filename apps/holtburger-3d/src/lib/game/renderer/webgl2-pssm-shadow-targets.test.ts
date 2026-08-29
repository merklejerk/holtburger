import { describe, expect, it } from "vitest";
import {
	WebGL2PssmShadowTargets,
	pssmShadowTargetByteLength,
} from "./webgl2-pssm-shadow-targets";

describe("WebGL2 PSSM shadow targets", () => {
	it("validates each new depth-array layer once and only selects layers during submission", () => {
		const state = createFakeWebGL2();
		const targets = new WebGL2PssmShadowTargets(state.gl);
		expect(targets.getDiagnostics()).toEqual({
			activeBytes: 0,
			activeFramebufferCount: 0,
			activeTextureCount: 0,
			allocatedGenerationCount: 0,
			cascadeCount: null,
			disposedGenerationCount: 0,
			resolution: null,
		});

		const first = targets.resize(512, 3);
		expect(targets.resize(512, 3)).toBe(first);
		expect(state.storage).toEqual([
			{ depth: 3, format: state.gl.DEPTH_COMPONENT24, height: 512, width: 512 },
		]);
		expect(state.attachedLayers).toEqual([0, 1, 2]);
		expect(state.framebufferChecks).toBe(3);
		expect(targets.getDiagnostics()).toEqual({
			activeBytes: pssmShadowTargetByteLength(512, 3),
			activeFramebufferCount: 1,
			activeTextureCount: 1,
			allocatedGenerationCount: 1,
			cascadeCount: 3,
			disposedGenerationCount: 0,
			resolution: 512,
		});

		expect(targets.attachLayer(1)).toBe(first);
		targets.attachLayer(0);
		targets.attachLayer(2);
		expect(state.attachedLayers).toEqual([0, 1, 2, 1, 0, 2]);
		expect(state.framebufferChecks).toBe(3);
		expect(() => targets.attachLayer(3)).toThrow("outside cascade count 3");

		targets.resize(256, 2);
		expect(state.attachedLayers).toEqual([0, 1, 2, 1, 0, 2, 0, 1]);
		expect(state.framebufferChecks).toBe(5);
		targets.attachLayer(0);
		targets.attachLayer(1);
		expect(state.framebufferChecks).toBe(5);
	});

	it("replaces, disables, re-enables, and destroys each generation once", () => {
		const state = createFakeWebGL2();
		const targets = new WebGL2PssmShadowTargets(state.gl);
		targets.resize(256, 2);
		targets.resize(512, 3);
		expect(state.deleted).toEqual({ framebuffers: 1, textures: 1 });
		targets.disable();
		targets.disable();
		expect(state.deleted).toEqual({ framebuffers: 2, textures: 2 });
		expect(() => targets.attachLayer(0)).toThrow("not allocated");
		targets.resize(256, 1);
		targets.destroy();
		targets.destroy();
		expect(state.deleted).toEqual({ framebuffers: 3, textures: 3 });
		expect(targets.getDiagnostics()).toMatchObject({
			activeBytes: 0,
			allocatedGenerationCount: 3,
			disposedGenerationCount: 3,
		});
		expect(() => targets.resize(256, 1)).toThrow("have been destroyed");
	});

	it("retains the previous generation and array bindings after allocation failure", () => {
		const state = createFakeWebGL2();
		const targets = new WebGL2PssmShadowTargets(state.gl);
		const first = targets.resize(256, 2);
		const bindings = installUnrelatedBindings(state.gl);
		state.failFramebufferCheckAt = state.framebufferChecks + 2;

		expect(() => targets.resize(512, 3)).toThrow(
			"framebuffer layer 1 is incomplete",
		);
		expect(targets.resize(256, 2)).toBe(first);
		expect(targets.getDiagnostics()).toMatchObject({
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
		});
		expect(state.deleted).toEqual({ framebuffers: 1, textures: 1 });
		expect(readBindings(state.gl)).toEqual(bindings);
	});

	it("rejects invalid and unsupported configurations before allocation", () => {
		const state = createFakeWebGL2({
			maximumArrayLayers: 2,
			maximumTextureSize: 512,
		});
		const targets = new WebGL2PssmShadowTargets(state.gl);
		expect(() => targets.resize(0, 1)).toThrow("positive integer");
		expect(() => targets.resize(512, 0)).toThrow("integer from 1");
		expect(() => targets.resize(1_024, 1)).toThrow(
			"exceeds maximum texture size 512",
		);
		expect(() => targets.resize(512, 3)).toThrow(
			"exceeds maximum array layers 2",
		);
		expect(state.created).toEqual({ framebuffers: 0, textures: 0 });
	});
});

interface FakeOptions {
	readonly maximumArrayLayers: number;
	readonly maximumTextureSize: number;
}

interface ResourceCounts {
	framebuffers: number;
	textures: number;
}

interface FakeState {
	readonly attachedLayers: number[];
	readonly created: ResourceCounts;
	readonly deleted: ResourceCounts;
	failFramebufferCheckAt: number | null;
	readonly framebufferChecks: number;
	readonly gl: WebGL2RenderingContext;
	readonly storage: Array<{
		readonly depth: number;
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

function createFakeWebGL2(
	options: FakeOptions = {
		maximumArrayLayers: 256,
		maximumTextureSize: 16_384,
	},
): FakeState {
	const constants = {
		ACTIVE_TEXTURE: 0x84e0,
		CLAMP_TO_EDGE: 0x812f,
		COMPARE_REF_TO_TEXTURE: 0x884e,
		DEPTH_ATTACHMENT: 0x8d00,
		DEPTH_COMPONENT24: 0x81a6,
		DRAW_FRAMEBUFFER: 0x8ca9,
		DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
		FRAMEBUFFER: 0x8d40,
		FRAMEBUFFER_COMPLETE: 0x8cd5,
		LEQUAL: 0x0203,
		MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
		MAX_TEXTURE_SIZE: 0x0d33,
		NEAREST: 0x2600,
		NONE: 0,
		READ_FRAMEBUFFER: 0x8ca8,
		READ_FRAMEBUFFER_BINDING: 0x8caa,
		TEXTURE0: 0x84c0,
		TEXTURE_2D_ARRAY: 0x8c1a,
		TEXTURE_BINDING_2D_ARRAY: 0x8c1d,
		TEXTURE_COMPARE_FUNC: 0x884d,
		TEXTURE_COMPARE_MODE: 0x884c,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
	} as const;
	const attachedLayers: number[] = [];
	const created = { framebuffers: 0, textures: 0 };
	const deleted = { framebuffers: 0, textures: 0 };
	const storage: FakeState["storage"] = [];
	const textureBindings = new Map<GLenum, WebGLTexture | null>();
	let activeTexture: GLenum = constants.TEXTURE0;
	let drawFramebuffer: WebGLFramebuffer | null = null;
	let failFramebufferCheckAt: number | null = null;
	let framebufferChecks = 0;
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
			)
				drawFramebuffer = framebuffer;
			if (
				target === constants.FRAMEBUFFER ||
				target === constants.READ_FRAMEBUFFER
			)
				readFramebuffer = framebuffer;
		},
		bindTexture: (_target: GLenum, texture: WebGLTexture | null) => {
			textureBindings.set(activeTexture, texture);
		},
		checkFramebufferStatus: () => {
			framebufferChecks += 1;
			return framebufferChecks === failFramebufferCheckAt
				? 0x8cd6
				: constants.FRAMEBUFFER_COMPLETE;
		},
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
		framebufferTextureLayer: (
			_target: GLenum,
			_attachment: GLenum,
			_texture: WebGLTexture | null,
			_level: number,
			layer: number,
		) => attachedLayers.push(layer),
		getParameter: (parameter: GLenum): unknown => {
			switch (parameter) {
				case constants.ACTIVE_TEXTURE:
					return activeTexture;
				case constants.DRAW_FRAMEBUFFER_BINDING:
					return drawFramebuffer;
				case constants.MAX_ARRAY_TEXTURE_LAYERS:
					return options.maximumArrayLayers;
				case constants.MAX_TEXTURE_SIZE:
					return options.maximumTextureSize;
				case constants.READ_FRAMEBUFFER_BINDING:
					return readFramebuffer;
				case constants.TEXTURE_BINDING_2D_ARRAY:
					return textureBindings.get(activeTexture) ?? null;
				default:
					throw new Error(`Unexpected fake WebGL parameter ${parameter}.`);
			}
		},
		readBuffer: () => undefined,
		texParameteri: () => undefined,
		texStorage3D: (
			_target: GLenum,
			_levels: number,
			format: GLenum,
			width: number,
			height: number,
			depth: number,
		) => storage.push({ depth, format, height, width }),
	} as unknown as WebGL2RenderingContext;
	return {
		attachedLayers,
		created,
		deleted,
		get failFramebufferCheckAt() {
			return failFramebufferCheckAt;
		},
		set failFramebufferCheckAt(value: number | null) {
			failFramebufferCheckAt = value;
		},
		get framebufferChecks() {
			return framebufferChecks;
		},
		gl,
		storage,
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
	gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture0Binding);
	gl.activeTexture(gl.TEXTURE0 + 3);
	gl.bindTexture(gl.TEXTURE_2D_ARRAY, activeTextureBinding);
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
		gl.TEXTURE_BINDING_2D_ARRAY,
	) as WebGLTexture | null;
	gl.activeTexture(gl.TEXTURE0);
	const texture0Binding = gl.getParameter(
		gl.TEXTURE_BINDING_2D_ARRAY,
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

function fakeResource<Resource>(kind: string, ordinal: number): Resource {
	return { kind, ordinal } as Resource;
}
