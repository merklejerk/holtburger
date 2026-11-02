/** Cold context identity captured only for an explicitly exported diagnostic report. */
export interface WebGL2DeviceDiagnosticIdentity {
	readonly renderer: string;
	readonly shadingLanguageVersion: string;
	/**
	 * Adapter string behind `WEBGL_debug_renderer_info`, or null where the browser withholds it.
	 *
	 * Non-null is not the same as true. WebKitGTK returns a fabricated value — it reported
	 * "Apple GPU" on an RX 7900 XT — so this field has three states, not two: absent, honest, and
	 * confidently wrong. Never branch on it, and never read it as evidence that timing came from a
	 * real adapter; that is what the harness records `glRenderer` against a known-good host for.
	 */
	readonly unmaskedRenderer: string | null;
	readonly unmaskedVendor: string | null;
	readonly vendor: string;
	readonly version: string;
}

/** Privacy-gated constants exposed by WEBGL_debug_renderer_info when the browser permits it. */
interface WebGLDebugRendererInfo {
	readonly UNMASKED_RENDERER_WEBGL: GLenum;
	readonly UNMASKED_VENDOR_WEBGL: GLenum;
}

/** Read identity from an existing context only for an explicit diagnostic request. */
export function readWebGL2DiagnosticIdentity(
	gl: WebGL2RenderingContext,
): WebGL2DeviceDiagnosticIdentity {
	const debug = gl.getExtension(
		"WEBGL_debug_renderer_info",
	) as WebGLDebugRendererInfo | null;
	return {
		renderer: gl.getParameter(gl.RENDERER) as string,
		shadingLanguageVersion: gl.getParameter(
			gl.SHADING_LANGUAGE_VERSION,
		) as string,
		unmaskedRenderer: debug
			? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string)
			: null,
		unmaskedVendor: debug
			? (gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string)
			: null,
		vendor: gl.getParameter(gl.VENDOR) as string,
		version: gl.getParameter(gl.VERSION) as string,
	};
}
