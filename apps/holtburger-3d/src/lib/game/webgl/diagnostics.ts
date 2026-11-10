/** Context-wide diagnostic observer; scene state and persistence belong to its caller. */
export interface WebGL2DiagnosticSink {
	record(label: string): void;
	fail(reason: string): void;
	changeBytes(delta: number, label: string): void;
}

const observers = new WeakMap<WebGL2RenderingContext, WebGL2DiagnosticSink>();

/** Attach one observer for this context's lifetime without retaining the context globally. */
export function registerWebGL2Diagnostics(
	gl: WebGL2RenderingContext,
	sink: WebGL2DiagnosticSink,
): void {
	observers.set(gl, sink);
}

/** Renderer owners can refine their own observer without exposing it through resource bindings. */
export function getWebGL2Diagnostics(
	gl: WebGL2RenderingContext,
): WebGL2DiagnosticSink | undefined {
	return observers.get(gl);
}

/** Cold operation attribution shared by resource publication and shader compilation. */
export function recordWebGL2Operation(
	gl: WebGL2RenderingContext,
	label: string,
): void {
	observers.get(gl)?.record(label);
}

/** Capture before the caller releases resources or starts a replacement runtime. */
export function reportWebGL2Failure(
	gl: WebGL2RenderingContext,
	reason: string,
): void {
	observers.get(gl)?.fail(reason);
}

/**
 * Check at cold publication boundaries, not every draw. Pending errors remain distinct
 * from upload errors: never silently drain them or blame them on the next upload.
 */
export function requireWebGL2NoError(
	gl: WebGL2RenderingContext,
	boundary: string,
): void {
	const error = gl.getError();
	if (error === gl.NO_ERROR) return;
	const reason = `${boundary}: WebGL error 0x${error.toString(16)}.`;
	reportWebGL2Failure(gl, reason);
	throw new Error(reason);
}

/** Track successful allocation overlap without querying the driver or retaining handles. */
export function recordWebGL2ResourceBytes(
	gl: WebGL2RenderingContext,
	delta: number,
	label: string,
): void {
	observers.get(gl)?.changeBytes(delta, label);
}
