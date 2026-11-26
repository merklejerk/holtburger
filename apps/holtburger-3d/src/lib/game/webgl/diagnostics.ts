/** Context-wide diagnostic observer; scene state and persistence belong to its caller. */
export interface WebGL2DiagnosticSink {
	/**
	 * Whether synchronous per-upload `gl.getError()` checks are enabled for this context.
	 *
	 * Disabled during normal play because each `gl.getError()` forces a synchronous GPU-process
	 * round-trip; enabled explicitly via `--gl-error-checks` or WebGL diagnostic fixtures.
	 */
	readonly checkUploadErrors: boolean;
	record(label: string): void;
	fail(reason: string): void;
	changeBytes(delta: number, label: string): void;
}

/** Whether synchronous per-upload WebGL2 error checks were requested via `--gl-error-checks`. */
export function webGL2UploadErrorChecksEnabled(search: string): boolean {
	return new URLSearchParams(search).get("gl-error-checks") === "true";
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
 * Check at upload boundaries when synchronous upload error checks are enabled (or on unregistered
 * mock test contexts). Pending errors remain distinct from upload errors: never silently drain
 * them or blame them on the next upload.
 */
export function requireWebGL2NoError(
	gl: WebGL2RenderingContext,
	boundary: string,
): void {
	const observer = observers.get(gl);
	if (observer !== undefined && !observer.checkUploadErrors) return;
	const error = gl.getError();
	if (error === gl.NO_ERROR) return;
	const reason = `${boundary}: WebGL error 0x${error.toString(16)}.`;
	observer?.fail(reason);
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
