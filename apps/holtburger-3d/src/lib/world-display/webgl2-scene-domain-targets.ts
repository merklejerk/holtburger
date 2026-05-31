export type Webgl2SceneDomain = "exterior" | "interior";

export interface Webgl2SceneDomainTarget {
	readonly domain: Webgl2SceneDomain;
	readonly width: number;
	readonly height: number;
	readonly framebuffer: WebGLFramebuffer;
	readonly colorTexture: WebGLTexture;
	readonly depthTexture: WebGLTexture;
	dispose(): void;
}

export interface Webgl2SceneDomainTargetSet {
	readonly width: number;
	readonly height: number;
	readonly exterior: Webgl2SceneDomainTarget;
	readonly interior: Webgl2SceneDomainTarget;
	dispose(): void;
}

export interface Webgl2PortalCompositeTarget {
	readonly label: string;
	readonly width: number;
	readonly height: number;
	readonly framebuffer: WebGLFramebuffer;
	readonly colorTexture: WebGLTexture;
	readonly depthTexture: WebGLTexture;
	dispose(): void;
}

export interface Webgl2PortalCompositeTargetSet {
	readonly width: number;
	readonly height: number;
	readonly read: Webgl2PortalCompositeTarget;
	readonly write: Webgl2PortalCompositeTarget;
	dispose(): void;
}

export function createWebgl2SceneDomainTargetSet(
	gl: WebGL2RenderingContext,
	options: { width: number; height: number },
): Webgl2SceneDomainTargetSet {
	if (!Number.isInteger(options.width) || options.width <= 0) {
		throw new Error(
			`WebGL2 scene-domain target width must be a positive integer, got ${options.width}.`,
		);
	}
	if (!Number.isInteger(options.height) || options.height <= 0) {
		throw new Error(
			`WebGL2 scene-domain target height must be a positive integer, got ${options.height}.`,
		);
	}
	const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
	if (
		Number.isFinite(maxTextureSize) &&
		(options.width > maxTextureSize || options.height > maxTextureSize)
	) {
		throw new Error(
			`WebGL2 scene-domain target ${options.width}x${options.height} exceeds MAX_TEXTURE_SIZE ${maxTextureSize}.`,
		);
	}

	const exterior = createWebgl2SceneDomainTarget(gl, {
		domain: "exterior",
		width: options.width,
		height: options.height,
	});
	try {
		const interior = createWebgl2SceneDomainTarget(gl, {
			domain: "interior",
			width: options.width,
			height: options.height,
		});
		return {
			width: options.width,
			height: options.height,
			exterior,
			interior,
			dispose() {
				exterior.dispose();
				interior.dispose();
			},
		};
	} catch (error) {
		exterior.dispose();
		throw error;
	}
}

export function createWebgl2PortalCompositeTargetSet(
	gl: WebGL2RenderingContext,
	options: { width: number; height: number },
): Webgl2PortalCompositeTargetSet {
	validateTargetSize(gl, "portal composite", options);
	const read = createWebgl2PortalCompositeTarget(gl, {
		label: "portal composite read",
		width: options.width,
		height: options.height,
	});
	try {
		const write = createWebgl2PortalCompositeTarget(gl, {
			label: "portal composite write",
			width: options.width,
			height: options.height,
		});
		return {
			width: options.width,
			height: options.height,
			read,
			write,
			dispose() {
				read.dispose();
				write.dispose();
			},
		};
	} catch (error) {
		read.dispose();
		throw error;
	}
}

function createWebgl2SceneDomainTarget(
	gl: WebGL2RenderingContext,
	options: {
		domain: Webgl2SceneDomain;
		width: number;
		height: number;
	},
): Webgl2SceneDomainTarget {
	const colorTexture = createSceneDomainTexture(gl, {
		label: `${options.domain} color`,
		width: options.width,
		height: options.height,
		internalFormat: gl.RGB8,
		format: gl.RGB,
		type: gl.UNSIGNED_BYTE,
	});
	try {
		const depthTexture = createSceneDomainTexture(gl, {
			label: `${options.domain} depth-stencil`,
			width: options.width,
			height: options.height,
			internalFormat: gl.DEPTH24_STENCIL8,
			format: gl.DEPTH_STENCIL,
			type: gl.UNSIGNED_INT_24_8,
		});
		try {
			const framebuffer = gl.createFramebuffer();
			if (!framebuffer) {
				throw new Error(
					`Failed to create WebGL2 ${options.domain} scene-domain framebuffer.`,
				);
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			try {
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					gl.TEXTURE_2D,
					colorTexture,
					0,
				);
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.DEPTH_STENCIL_ATTACHMENT,
					gl.TEXTURE_2D,
					depthTexture,
					0,
				);
				const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
				if (status !== gl.FRAMEBUFFER_COMPLETE) {
					throw new Error(
						`WebGL2 ${options.domain} scene-domain framebuffer is incomplete: ${describeFramebufferStatus(
							gl,
							status,
						)}.`,
					);
				}
			} finally {
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			}
			return {
				domain: options.domain,
				width: options.width,
				height: options.height,
				framebuffer,
				colorTexture,
				depthTexture,
				dispose() {
					gl.deleteFramebuffer(framebuffer);
					gl.deleteTexture(colorTexture);
					gl.deleteTexture(depthTexture);
				},
			};
		} catch (error) {
			gl.deleteTexture(depthTexture);
			throw error;
		}
	} catch (error) {
		gl.deleteTexture(colorTexture);
		throw error;
	}
}

function createWebgl2PortalCompositeTarget(
	gl: WebGL2RenderingContext,
	options: {
		label: string;
		width: number;
		height: number;
	},
): Webgl2PortalCompositeTarget {
	const colorTexture = createSceneDomainTexture(gl, {
		label: `${options.label} color`,
		width: options.width,
		height: options.height,
		internalFormat: gl.RGB8,
		format: gl.RGB,
		type: gl.UNSIGNED_BYTE,
	});
	try {
		const depthTexture = createSceneDomainTexture(gl, {
			label: `${options.label} depth-stencil`,
			width: options.width,
			height: options.height,
			internalFormat: gl.DEPTH24_STENCIL8,
			format: gl.DEPTH_STENCIL,
			type: gl.UNSIGNED_INT_24_8,
		});
		try {
			const framebuffer = gl.createFramebuffer();
			if (!framebuffer) {
				throw new Error(
					`Failed to create WebGL2 ${options.label} framebuffer.`,
				);
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			try {
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					gl.TEXTURE_2D,
					colorTexture,
					0,
				);
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.DEPTH_STENCIL_ATTACHMENT,
					gl.TEXTURE_2D,
					depthTexture,
					0,
				);
				const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
				if (status !== gl.FRAMEBUFFER_COMPLETE) {
					throw new Error(
						`WebGL2 ${options.label} framebuffer is incomplete: ${describeFramebufferStatus(
							gl,
							status,
						)}.`,
					);
				}
			} finally {
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			}
			return {
				label: options.label,
				width: options.width,
				height: options.height,
				framebuffer,
				colorTexture,
				depthTexture,
				dispose() {
					gl.deleteFramebuffer(framebuffer);
					gl.deleteTexture(colorTexture);
					gl.deleteTexture(depthTexture);
				},
			};
		} catch (error) {
			gl.deleteTexture(depthTexture);
			throw error;
		}
	} catch (error) {
		gl.deleteTexture(colorTexture);
		throw error;
	}
}

function createSceneDomainTexture(
	gl: WebGL2RenderingContext,
	options: {
		label: string;
		width: number;
		height: number;
		internalFormat: GLenum;
		format: GLenum;
		type: GLenum;
	},
): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error(`Failed to create WebGL2 scene-domain ${options.label} texture.`);
	}
	gl.bindTexture(gl.TEXTURE_2D, texture);
	try {
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			options.internalFormat,
			options.width,
			options.height,
			0,
			options.format,
			options.type,
			null,
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	} finally {
		gl.bindTexture(gl.TEXTURE_2D, null);
	}
	return texture;
}

function validateTargetSize(
	gl: WebGL2RenderingContext,
	label: string,
	options: { width: number; height: number },
): void {
	if (!Number.isInteger(options.width) || options.width <= 0) {
		throw new Error(
			`WebGL2 ${label} target width must be a positive integer, got ${options.width}.`,
		);
	}
	if (!Number.isInteger(options.height) || options.height <= 0) {
		throw new Error(
			`WebGL2 ${label} target height must be a positive integer, got ${options.height}.`,
		);
	}
	const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
	if (
		Number.isFinite(maxTextureSize) &&
		(options.width > maxTextureSize || options.height > maxTextureSize)
	) {
		throw new Error(
			`WebGL2 ${label} target ${options.width}x${options.height} exceeds MAX_TEXTURE_SIZE ${maxTextureSize}.`,
		);
	}
}

function describeFramebufferStatus(
	gl: WebGL2RenderingContext,
	status: GLenum,
): string {
	switch (status) {
		case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
			return "FRAMEBUFFER_INCOMPLETE_ATTACHMENT";
		case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
			return "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT";
		case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
			return "FRAMEBUFFER_INCOMPLETE_DIMENSIONS";
		case gl.FRAMEBUFFER_UNSUPPORTED:
			return "FRAMEBUFFER_UNSUPPORTED";
		case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
			return "FRAMEBUFFER_INCOMPLETE_MULTISAMPLE";
		default:
			return `status ${status}`;
	}
}
