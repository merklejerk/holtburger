import { formatError } from "../lib/format-error";
import { APP_BUILD_LABEL } from "./app-build";
import type { WebGL2FailureReport } from "../lib/game/renderer/webgl2-failure-diagnostics";

/** Browser harness storage when the native bridge is unavailable. */
const RENDERER_FAILURE_STORAGE_KEY = "holtburger.renderer-failure.v1";
let latestFailure: string | null = null;

declare global {
	interface Window {
		holtburgerAppDiagnostics?: {
			save(
				failure:
					| { readonly kind: "renderer"; readonly report: string }
					| { readonly kind: "startup"; readonly message: string },
			): Promise<void>;
		};
	}
}

/** Send desktop evidence to the application process before the game document retires. */
export function retainRendererFailure(report: WebGL2FailureReport): void {
	latestFailure = JSON.stringify(
		{ appBuild: APP_BUILD_LABEL, ...report },
		null,
		2,
	);
	const bridge = window.holtburgerAppDiagnostics;
	if (bridge) {
		void bridge
			.save({ kind: "renderer", report: latestFailure })
			.catch((error: unknown) => {
				console.error("Could not persist failure report.", error);
			});
		return;
	}
	try {
		window.localStorage.setItem(RENDERER_FAILURE_STORAGE_KEY, latestFailure);
	} catch (error) {
		console.error("Could not persist failure report.", error);
	}
}

/** Read only on a cold diagnostic action, in the browser harness. */
export function readRendererFailure(): string | null {
	if (latestFailure !== null) return latestFailure;
	return window.localStorage.getItem(RENDERER_FAILURE_STORAGE_KEY);
}

/** Startup can fail before a WebGL device exists, so submit the error separately. */
export function retainStartupFailure(error: unknown): void {
	const bridge = window.holtburgerAppDiagnostics;
	if (bridge) {
		void bridge
			.save({ kind: "startup", message: formatError(error).slice(0, 4096) })
			.catch((cause: unknown) => {
				console.error("Could not persist startup failure report.", cause);
			});
	}
}
