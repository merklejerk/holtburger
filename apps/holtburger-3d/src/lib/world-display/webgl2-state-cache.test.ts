import { describe, expect, it } from "vitest";

import {
	Webgl2StateCache,
	type Webgl2StateCacheGl,
} from "./webgl2-state-cache";

describe("Webgl2StateCache", () => {
	it("skips redundant program, vertex array, texture, framebuffer, and viewport binds", () => {
		const gl = new CapturingStateGl();
		const cache = new Webgl2StateCache(gl);
		const program = {} as WebGLProgram;
		const vertexArray = {} as WebGLVertexArrayObject;
		const texture = {} as WebGLTexture;
		const framebuffer = {} as WebGLFramebuffer;

		cache.useProgram(program);
		cache.useProgram(program);
		cache.bindVertexArray(vertexArray);
		cache.bindVertexArray(vertexArray);
		cache.bindTexture2D(0, texture);
		cache.bindTexture2D(0, texture);
		cache.bindFramebuffer(framebuffer);
		cache.bindFramebuffer(framebuffer);
		cache.setViewport({ x: 0, y: 0, width: 320, height: 240 });
		cache.setViewport({ x: 0, y: 0, width: 320, height: 240 });

		expect(gl.calls).toEqual([
			"useProgram:program",
			"bindVertexArray:vertex-array",
			"activeTexture:1000",
			"bindTexture:1001:texture",
			"bindFramebuffer:1013:framebuffer",
			"viewport:0:0:320:240",
		]);
	});

	it("skips redundant depth, blend, cull, and stencil state", () => {
		const gl = new CapturingStateGl();
		const cache = new Webgl2StateCache(gl);

		cache.setDepthState({ enabled: true, write: true, func: 200 });
		cache.setDepthState({ enabled: true, write: true, func: 200 });
		cache.setBlendState({
			enabled: false,
			srcRgb: 1,
			dstRgb: 0,
			srcAlpha: 1,
			dstAlpha: 0,
			equationRgb: 300,
			equationAlpha: 300,
		});
		cache.setBlendState({
			enabled: false,
			srcRgb: 1,
			dstRgb: 0,
			srcAlpha: 1,
			dstAlpha: 0,
			equationRgb: 300,
			equationAlpha: 300,
		});
		cache.setCullState({ enabled: false, mode: gl.BACK });
		cache.setCullState({ enabled: false, mode: gl.BACK });
		cache.setStencilState({
			enabled: false,
			writeMask: 0xff,
			func: gl.ALWAYS,
			ref: 0,
			readMask: 0xff,
			fail: gl.KEEP,
			zfail: gl.KEEP,
			zpass: gl.KEEP,
		});
		cache.setStencilState({
			enabled: false,
			writeMask: 0xff,
			func: gl.ALWAYS,
			ref: 0,
			readMask: 0xff,
			fail: gl.KEEP,
			zfail: gl.KEEP,
			zpass: gl.KEEP,
		});

		expect(gl.calls).toEqual([
			"enable:1002",
			"depthMask:true",
			"depthFunc:200",
			"disable:1003",
			"blendFuncSeparate:1:0:1:0",
			"blendEquationSeparate:300:300",
			"disable:1004",
			"cullFace:1015",
			"disable:1005",
			"stencilMask:255",
			"stencilFunc:1017:0:255",
			"stencilOp:1018:1018:1018",
		]);
	});

	it("reapplies state after invalidation", () => {
		const gl = new CapturingStateGl();
		const cache = new Webgl2StateCache(gl);
		const program = {} as WebGLProgram;

		cache.useProgram(program);
		cache.useProgram(program);
		cache.invalidate();
		cache.useProgram(program);

		expect(gl.calls).toEqual(["useProgram:program", "useProgram:program"]);
	});
});

class CapturingStateGl implements Webgl2StateCacheGl {
	readonly TEXTURE0 = 1000;
	readonly TEXTURE_2D = 1001;
	readonly DEPTH_TEST = 1002;
	readonly BLEND = 1003;
	readonly CULL_FACE = 1004;
	readonly STENCIL_TEST = 1005;
	readonly FRAMEBUFFER = 1013;
	readonly FRONT = 1014;
	readonly BACK = 1015;
	readonly FRONT_AND_BACK = 1016;
	readonly ALWAYS = 1017;
	readonly KEEP = 1018;
	readonly calls: string[] = [];

	useProgram(program: WebGLProgram | null): void {
		this.calls.push(`useProgram:${formatHandle(program, "program")}`);
	}

	bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
		this.calls.push(`bindVertexArray:${formatHandle(vertexArray, "vertex-array")}`);
	}

	activeTexture(textureUnit: GLenum): void {
		this.calls.push(`activeTexture:${textureUnit}`);
	}

	bindTexture(target: GLenum, texture: WebGLTexture | null): void {
		this.calls.push(`bindTexture:${target}:${formatHandle(texture, "texture")}`);
	}

	enable(capability: GLenum): void {
		this.calls.push(`enable:${capability}`);
	}

	disable(capability: GLenum): void {
		this.calls.push(`disable:${capability}`);
	}

	depthMask(flag: boolean): void {
		this.calls.push(`depthMask:${flag}`);
	}

	depthFunc(func: GLenum): void {
		this.calls.push(`depthFunc:${func}`);
	}

	blendFuncSeparate(
		srcRgb: GLenum,
		dstRgb: GLenum,
		srcAlpha: GLenum,
		dstAlpha: GLenum,
	): void {
		this.calls.push(
			`blendFuncSeparate:${srcRgb}:${dstRgb}:${srcAlpha}:${dstAlpha}`,
		);
	}

	blendEquationSeparate(modeRgb: GLenum, modeAlpha: GLenum): void {
		this.calls.push(`blendEquationSeparate:${modeRgb}:${modeAlpha}`);
	}

	cullFace(mode: GLenum): void {
		this.calls.push(`cullFace:${mode}`);
	}

	stencilMask(mask: number): void {
		this.calls.push(`stencilMask:${mask}`);
	}

	stencilFunc(func: GLenum, ref: number, mask: number): void {
		this.calls.push(`stencilFunc:${func}:${ref}:${mask}`);
	}

	stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void {
		this.calls.push(`stencilOp:${fail}:${zfail}:${zpass}`);
	}

	viewport(x: number, y: number, width: number, height: number): void {
		this.calls.push(`viewport:${x}:${y}:${width}:${height}`);
	}

	bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
		this.calls.push(
			`bindFramebuffer:${target}:${formatHandle(framebuffer, "framebuffer")}`,
		);
	}
}

function formatHandle(value: object | null, label: string): string {
	return value === null ? "null" : label;
}
