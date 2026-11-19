interface WebGL2AllocationBindings {
	readonly activeTexture: GLenum;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
}

/** Run target allocation without leaking its framebuffer or texture bindings to the caller. */
export function withPreservedWebGL2AllocationBindings<T>(
	gl: WebGL2RenderingContext,
	allocate: () => T,
	textureTarget: GLenum = gl.TEXTURE_2D,
): T {
	const bindings = captureAllocationBindings(gl, textureTarget);
	try {
		return allocate();
	} finally {
		restoreAllocationBindings(gl, bindings, textureTarget);
	}
}

function captureAllocationBindings(
	gl: WebGL2RenderingContext,
	textureTarget: GLenum,
): WebGL2AllocationBindings {
	const textureBindingParameter = bindingParameter(gl, textureTarget);
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as GLenum;
	const activeTextureBinding = gl.getParameter(
		textureBindingParameter,
	) as WebGLTexture | null;
	gl.activeTexture(gl.TEXTURE0);
	const texture0Binding = gl.getParameter(
		textureBindingParameter,
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
	textureTarget: GLenum,
): void {
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, bindings.drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, bindings.readFramebuffer);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(textureTarget, bindings.texture0Binding);
	gl.activeTexture(bindings.activeTexture);
	gl.bindTexture(textureTarget, bindings.activeTextureBinding);
}

function bindingParameter(
	gl: WebGL2RenderingContext,
	textureTarget: GLenum,
): GLenum {
	if (textureTarget === gl.TEXTURE_2D) return gl.TEXTURE_BINDING_2D;
	if (textureTarget === gl.TEXTURE_2D_ARRAY) return gl.TEXTURE_BINDING_2D_ARRAY;
	throw new Error(`Unsupported allocation texture target ${textureTarget}.`);
}
