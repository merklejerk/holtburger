export interface Webgl2StateCacheGl {
	readonly TEXTURE0: GLenum;
	readonly TEXTURE_2D: GLenum;
	readonly DEPTH_TEST: GLenum;
	readonly BLEND: GLenum;
	readonly CULL_FACE: GLenum;
	readonly STENCIL_TEST: GLenum;
	readonly FRAMEBUFFER: GLenum;
	readonly FRONT: GLenum;
	readonly BACK: GLenum;
	readonly FRONT_AND_BACK: GLenum;
	readonly ALWAYS: GLenum;
	readonly KEEP: GLenum;
	useProgram(program: WebGLProgram | null): void;
	bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void;
	activeTexture(textureUnit: GLenum): void;
	bindTexture(target: GLenum, texture: WebGLTexture | null): void;
	enable(capability: GLenum): void;
	disable(capability: GLenum): void;
	depthMask(flag: boolean): void;
	depthFunc(func: GLenum): void;
	blendFuncSeparate(
		srcRgb: GLenum,
		dstRgb: GLenum,
		srcAlpha: GLenum,
		dstAlpha: GLenum,
	): void;
	blendEquationSeparate(modeRgb: GLenum, modeAlpha: GLenum): void;
	cullFace(mode: GLenum): void;
	stencilMask(mask: number): void;
	stencilFunc(func: GLenum, ref: number, mask: number): void;
	stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void;
	viewport(x: number, y: number, width: number, height: number): void;
	bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void;
}

export interface Webgl2DepthState {
	enabled: boolean;
	write: boolean;
	func: GLenum;
}

export interface Webgl2BlendState {
	enabled: boolean;
	srcRgb: GLenum;
	dstRgb: GLenum;
	srcAlpha: GLenum;
	dstAlpha: GLenum;
	equationRgb: GLenum;
	equationAlpha: GLenum;
}

export interface Webgl2CullState {
	enabled: boolean;
	mode: GLenum;
}

export interface Webgl2StencilState {
	enabled: boolean;
	writeMask: number;
	func: GLenum;
	ref: number;
	readMask: number;
	fail: GLenum;
	zfail: GLenum;
	zpass: GLenum;
}

export interface Webgl2ViewportState {
	x: number;
	y: number;
	width: number;
	height: number;
}

export class Webgl2StateCache {
	private currentProgram: WebGLProgram | null | undefined;
	private currentVertexArray: WebGLVertexArrayObject | null | undefined;
	private currentActiveTextureUnit: number | undefined;
	private readonly textureBindingsByUnit = new Map<number, WebGLTexture | null>();
	private depthState: Webgl2DepthState | undefined;
	private blendState: Webgl2BlendState | undefined;
	private cullState: Webgl2CullState | undefined;
	private stencilState: Webgl2StencilState | undefined;
	private viewportState: Webgl2ViewportState | undefined;
	private framebuffer: WebGLFramebuffer | null | undefined;

	constructor(private readonly gl: Webgl2StateCacheGl) {}

	invalidate(): void {
		this.currentProgram = undefined;
		this.currentVertexArray = undefined;
		this.currentActiveTextureUnit = undefined;
		this.textureBindingsByUnit.clear();
		this.depthState = undefined;
		this.blendState = undefined;
		this.cullState = undefined;
		this.stencilState = undefined;
		this.viewportState = undefined;
		this.framebuffer = undefined;
	}

	useProgram(program: WebGLProgram | null): void {
		if (this.currentProgram === program) {
			return;
		}
		this.gl.useProgram(program);
		this.currentProgram = program;
	}

	bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
		if (this.currentVertexArray === vertexArray) {
			return;
		}
		this.gl.bindVertexArray(vertexArray);
		this.currentVertexArray = vertexArray;
	}

	bindTexture2D(unit: number, texture: WebGLTexture | null): void {
		const currentTexture = this.textureBindingsByUnit.get(unit);
		if (currentTexture === texture && this.currentActiveTextureUnit === unit) {
			return;
		}
		if (this.currentActiveTextureUnit !== unit) {
			this.gl.activeTexture(this.gl.TEXTURE0 + unit);
			this.currentActiveTextureUnit = unit;
		}
		if (currentTexture !== texture) {
			this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
			this.textureBindingsByUnit.set(unit, texture);
		}
	}

	setDepthState(state: Webgl2DepthState): void {
		if (!this.depthState || this.depthState.enabled !== state.enabled) {
			this.setCapability(this.gl.DEPTH_TEST, state.enabled);
		}
		if (!this.depthState || this.depthState.write !== state.write) {
			this.gl.depthMask(state.write);
		}
		if (!this.depthState || this.depthState.func !== state.func) {
			this.gl.depthFunc(state.func);
		}
		this.depthState = { ...state };
	}

	setBlendState(state: Webgl2BlendState): void {
		if (!this.blendState || this.blendState.enabled !== state.enabled) {
			this.setCapability(this.gl.BLEND, state.enabled);
		}
		if (
			!this.blendState ||
			this.blendState.srcRgb !== state.srcRgb ||
			this.blendState.dstRgb !== state.dstRgb ||
			this.blendState.srcAlpha !== state.srcAlpha ||
			this.blendState.dstAlpha !== state.dstAlpha
		) {
			this.gl.blendFuncSeparate(
				state.srcRgb,
				state.dstRgb,
				state.srcAlpha,
				state.dstAlpha,
			);
		}
		if (
			!this.blendState ||
			this.blendState.equationRgb !== state.equationRgb ||
			this.blendState.equationAlpha !== state.equationAlpha
		) {
			this.gl.blendEquationSeparate(state.equationRgb, state.equationAlpha);
		}
		this.blendState = { ...state };
	}

	setCullState(state: Webgl2CullState): void {
		if (!this.cullState || this.cullState.enabled !== state.enabled) {
			this.setCapability(this.gl.CULL_FACE, state.enabled);
		}
		if (!this.cullState || this.cullState.mode !== state.mode) {
			this.gl.cullFace(state.mode);
		}
		this.cullState = { ...state };
	}

	setStencilState(state: Webgl2StencilState): void {
		if (!this.stencilState || this.stencilState.enabled !== state.enabled) {
			this.setCapability(this.gl.STENCIL_TEST, state.enabled);
		}
		if (!this.stencilState || this.stencilState.writeMask !== state.writeMask) {
			this.gl.stencilMask(state.writeMask);
		}
		if (
			!this.stencilState ||
			this.stencilState.func !== state.func ||
			this.stencilState.ref !== state.ref ||
			this.stencilState.readMask !== state.readMask
		) {
			this.gl.stencilFunc(state.func, state.ref, state.readMask);
		}
		if (
			!this.stencilState ||
			this.stencilState.fail !== state.fail ||
			this.stencilState.zfail !== state.zfail ||
			this.stencilState.zpass !== state.zpass
		) {
			this.gl.stencilOp(state.fail, state.zfail, state.zpass);
		}
		this.stencilState = { ...state };
	}

	setViewport(state: Webgl2ViewportState): void {
		if (
			this.viewportState &&
			this.viewportState.x === state.x &&
			this.viewportState.y === state.y &&
			this.viewportState.width === state.width &&
			this.viewportState.height === state.height
		) {
			return;
		}
		this.gl.viewport(state.x, state.y, state.width, state.height);
		this.viewportState = { ...state };
	}

	bindFramebuffer(framebuffer: WebGLFramebuffer | null): void {
		if (this.framebuffer === framebuffer) {
			return;
		}
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
		this.framebuffer = framebuffer;
	}

	private setCapability(capability: GLenum, enabled: boolean): void {
		if (enabled) {
			this.gl.enable(capability);
		} else {
			this.gl.disable(capability);
		}
	}
}
