/** Browser-observed WebGL calls made while the sampler-free far terrain program is active. */
export interface TerrainGlTrace {
	/** Far-program indexed draws observed across all rendered frames. */
	readonly farDrawCount: number;
	/** Texture-unit selections made since the preceding far draw or program activation. */
	readonly farDrawActiveTextureCount: number;
	/** Sampler binds made since the preceding far draw or program activation. */
	readonly farDrawSamplerBindCount: number;
	/** Texture binds made since the preceding far draw or program activation. */
	readonly farDrawTextureBindCount: number;
	/** Palette-shaped uniform uploads made while the far program is active. */
	readonly farPaletteUploadCount: number;
	/** Far-program activations observed across all rendered frames. */
	readonly farProgramActivationCount: number;
	/** Near-program activations observed across all rendered frames. */
	readonly nearProgramActivationCount: number;
}

export interface TerrainGlTraceInstallation {
	destroy(): void;
	reset(): void;
	snapshot(): TerrainGlTrace;
}

/**
 * Trace the real WebGL context without teaching production renderer contracts about diagnostics.
 * Shader source identifies the far program before the renderer can submit its first frame.
 */
export function installTerrainGlTrace(): TerrainGlTraceInstallation {
	const prototype = WebGL2RenderingContext.prototype;
	const original = {
		activeTexture: prototype.activeTexture,
		attachShader: prototype.attachShader,
		bindSampler: prototype.bindSampler,
		bindTexture: prototype.bindTexture,
		drawElements: prototype.drawElements,
		shaderSource: prototype.shaderSource,
		uniform3fv: prototype.uniform3fv,
		useProgram: prototype.useProgram,
	};
	const farShaders = new WeakSet<WebGLShader>();
	const farPrograms = new WeakSet<WebGLProgram>();
	const nearShaders = new WeakSet<WebGLShader>();
	const nearPrograms = new WeakSet<WebGLProgram>();
	const activePrograms = new WeakMap<
		WebGL2RenderingContext,
		WebGLProgram | null
	>();
	type PendingTextureState = {
		activeTextureCount: number;
		samplerBindCount: number;
		textureBindCount: number;
	};
	const pendingTextureState = new WeakMap<
		WebGL2RenderingContext,
		PendingTextureState
	>();
	const trace = {
		farDrawCount: 0,
		farDrawActiveTextureCount: 0,
		farDrawSamplerBindCount: 0,
		farDrawTextureBindCount: 0,
		farPaletteUploadCount: 0,
		farProgramActivationCount: 0,
		nearProgramActivationCount: 0,
	};
	const isFarActive = (gl: WebGL2RenderingContext): boolean => {
		const program = activePrograms.get(gl);
		return (
			program !== undefined && program !== null && farPrograms.has(program)
		);
	};
	const requirePendingTextureState = (
		gl: WebGL2RenderingContext,
	): PendingTextureState => {
		const pending = pendingTextureState.get(gl);
		if (!pending) {
			throw new Error("Active far program has no texture-state trace scope.");
		}
		return pending;
	};

	prototype.shaderSource = function (...args): void {
		const [shader, source] = args;
		if (source.includes("uTerrainPalette")) farShaders.add(shader);
		if (source.includes("uSurfaceField")) nearShaders.add(shader);
		original.shaderSource.apply(this, args);
	};
	prototype.attachShader = function (...args): void {
		const [program, shader] = args;
		if (farShaders.has(shader)) farPrograms.add(program);
		if (nearShaders.has(shader)) nearPrograms.add(program);
		original.attachShader.apply(this, args);
	};
	prototype.useProgram = function (...args): void {
		const [program] = args;
		activePrograms.set(this, program);
		pendingTextureState.set(this, {
			activeTextureCount: 0,
			samplerBindCount: 0,
			textureBindCount: 0,
		});
		if (program !== null && farPrograms.has(program)) {
			trace.farProgramActivationCount += 1;
		}
		if (program !== null && nearPrograms.has(program)) {
			trace.nearProgramActivationCount += 1;
		}
		original.useProgram.apply(this, args);
	};
	prototype.activeTexture = function (...args): void {
		if (isFarActive(this)) {
			requirePendingTextureState(this).activeTextureCount += 1;
		}
		original.activeTexture.apply(this, args);
	};
	prototype.bindTexture = function (...args): void {
		if (isFarActive(this)) {
			requirePendingTextureState(this).textureBindCount += 1;
		}
		original.bindTexture.apply(this, args);
	};
	prototype.bindSampler = function (...args): void {
		if (isFarActive(this)) {
			requirePendingTextureState(this).samplerBindCount += 1;
		}
		original.bindSampler.apply(this, args);
	};
	prototype.uniform3fv = function (...args): void {
		if (isFarActive(this)) trace.farPaletteUploadCount += 1;
		original.uniform3fv.apply(this, args);
	};
	prototype.drawElements = function (...args): void {
		if (isFarActive(this)) {
			const pending = requirePendingTextureState(this);
			trace.farDrawActiveTextureCount += pending.activeTextureCount;
			trace.farDrawSamplerBindCount += pending.samplerBindCount;
			trace.farDrawTextureBindCount += pending.textureBindCount;
			pending.activeTextureCount = 0;
			pending.samplerBindCount = 0;
			pending.textureBindCount = 0;
			trace.farDrawCount += 1;
		}
		original.drawElements.apply(this, args);
	};

	return {
		destroy() {
			Object.assign(prototype, original);
		},
		reset() {
			trace.farDrawCount = 0;
			trace.farDrawActiveTextureCount = 0;
			trace.farDrawSamplerBindCount = 0;
			trace.farDrawTextureBindCount = 0;
			trace.farPaletteUploadCount = 0;
			trace.farProgramActivationCount = 0;
			trace.nearProgramActivationCount = 0;
		},
		snapshot: () => ({ ...trace }),
	};
}
