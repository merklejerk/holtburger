/** Positive pixel extent shared by renderer-owned WebGL2 targets. */
export interface WebGL2RenderExtent {
	readonly height: number;
	readonly width: number;
}

interface WebGL2AllocationBindings {
	readonly activeTexture: GLenum;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
}

/** Reject malformed target dimensions before any WebGL state or resource mutation. */
export function validateWebGL2RenderExtent(
	extent: WebGL2RenderExtent,
	owner: string,
): void {
	validateWebGL2RenderDimensions(extent.width, extent.height, owner);
}

/** Validate scalar dimensions without manufacturing an extent record on a hot resize check. */
export function validateWebGL2RenderDimensions(
	width: number,
	height: number,
	owner: string,
): void {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(
			`${owner} extent must contain positive integers within the safe range.`,
		);
	}
}

/** Run target allocation without leaking its framebuffer or texture bindings to the caller. */
export function withPreservedWebGL2AllocationBindings<T>(
	gl: WebGL2RenderingContext,
	allocate: () => T,
): T {
	const bindings = captureAllocationBindings(gl);
	try {
		return allocate();
	} finally {
		restoreAllocationBindings(gl, bindings);
	}
}

function captureAllocationBindings(
	gl: WebGL2RenderingContext,
): WebGL2AllocationBindings {
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

function restoreAllocationBindings(
	gl: WebGL2RenderingContext,
	bindings: WebGL2AllocationBindings,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, bindings.drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, bindings.readFramebuffer);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, bindings.texture0Binding);
	gl.activeTexture(bindings.activeTexture);
	gl.bindTexture(gl.TEXTURE_2D, bindings.activeTextureBinding);
}
