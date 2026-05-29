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

	useProgram(program: WebGLProgram | null): boolean {
		if (this.currentProgram === program) {
			return false;
		}
		this.gl.useProgram(program);
		this.currentProgram = program;
		return true;
	}

	bindVertexArray(vertexArray: WebGLVertexArrayObject | null): boolean {
		if (this.currentVertexArray === vertexArray) {
			return false;
		}
		this.gl.bindVertexArray(vertexArray);
		this.currentVertexArray = vertexArray;
		return true;
	}

	bindTexture2D(unit: number, texture: WebGLTexture | null): boolean {
		const currentTexture = this.textureBindingsByUnit.get(unit);
		if (currentTexture === texture && this.currentActiveTextureUnit === unit) {
			return false;
		}
		let changed = false;
		if (this.currentActiveTextureUnit !== unit) {
			this.gl.activeTexture(this.gl.TEXTURE0 + unit);
			this.currentActiveTextureUnit = unit;
			changed = true;
		}
		if (currentTexture !== texture) {
			this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
			this.textureBindingsByUnit.set(unit, texture);
			changed = true;
		}
		return changed;
	}

	setDepthState(state: Webgl2DepthState): number {
		let changeCount = 0;
		if (!this.depthState || this.depthState.enabled !== state.enabled) {
			this.setCapability(this.gl.DEPTH_TEST, state.enabled);
			changeCount += 1;
		}
		if (!this.depthState || this.depthState.write !== state.write) {
			this.gl.depthMask(state.write);
			changeCount += 1;
		}
		if (!this.depthState || this.depthState.func !== state.func) {
			this.gl.depthFunc(state.func);
			changeCount += 1;
		}
		this.depthState = { ...state };
		return changeCount;
	}

	setBlendState(state: Webgl2BlendState): number {
		let changeCount = 0;
		if (!this.blendState || this.blendState.enabled !== state.enabled) {
			this.setCapability(this.gl.BLEND, state.enabled);
			changeCount += 1;
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
			changeCount += 1;
		}
		if (
			!this.blendState ||
			this.blendState.equationRgb !== state.equationRgb ||
			this.blendState.equationAlpha !== state.equationAlpha
		) {
			this.gl.blendEquationSeparate(state.equationRgb, state.equationAlpha);
			changeCount += 1;
		}
		this.blendState = { ...state };
		return changeCount;
	}

	setCullState(state: Webgl2CullState): number {
		let changeCount = 0;
		if (!this.cullState || this.cullState.enabled !== state.enabled) {
			this.setCapability(this.gl.CULL_FACE, state.enabled);
			changeCount += 1;
		}
		if (!this.cullState || this.cullState.mode !== state.mode) {
			this.gl.cullFace(state.mode);
			changeCount += 1;
		}
		this.cullState = { ...state };
		return changeCount;
	}

	setStencilState(state: Webgl2StencilState): number {
		let changeCount = 0;
		if (!this.stencilState || this.stencilState.enabled !== state.enabled) {
			this.setCapability(this.gl.STENCIL_TEST, state.enabled);
			changeCount += 1;
		}
		if (!this.stencilState || this.stencilState.writeMask !== state.writeMask) {
			this.gl.stencilMask(state.writeMask);
			changeCount += 1;
		}
		if (
			!this.stencilState ||
			this.stencilState.func !== state.func ||
			this.stencilState.ref !== state.ref ||
			this.stencilState.readMask !== state.readMask
		) {
			this.gl.stencilFunc(state.func, state.ref, state.readMask);
			changeCount += 1;
		}
		if (
			!this.stencilState ||
			this.stencilState.fail !== state.fail ||
			this.stencilState.zfail !== state.zfail ||
			this.stencilState.zpass !== state.zpass
		) {
			this.gl.stencilOp(state.fail, state.zfail, state.zpass);
			changeCount += 1;
		}
		this.stencilState = { ...state };
		return changeCount;
	}

	setViewport(state: Webgl2ViewportState): boolean {
		if (
			this.viewportState &&
			this.viewportState.x === state.x &&
			this.viewportState.y === state.y &&
			this.viewportState.width === state.width &&
			this.viewportState.height === state.height
		) {
			return false;
		}
		this.gl.viewport(state.x, state.y, state.width, state.height);
		this.viewportState = { ...state };
		return true;
	}

	bindFramebuffer(framebuffer: WebGLFramebuffer | null): boolean {
		if (this.framebuffer === framebuffer) {
			return false;
		}
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
		this.framebuffer = framebuffer;
		return true;
	}

	private setCapability(capability: GLenum, enabled: boolean): void {
		if (enabled) {
			this.gl.enable(capability);
		} else {
			this.gl.disable(capability);
		}
	}
}
