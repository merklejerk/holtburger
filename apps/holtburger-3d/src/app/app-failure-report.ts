import { formatError } from "../lib/format-error";
import type { RuntimeLogSnapshot } from "./runtime-log-contract";
import { APP_BUILD_LABEL } from "./app-build";
import type { WebGL2FailureReport } from "../lib/game/renderer/webgl2/webgl2-failure-diagnostics";

declare global {
	interface Window {
		holtburgerAppDiagnostics?: {
			readRuntimeLog(since: number): Promise<RuntimeLogSnapshot | null>;
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
	const bridge = window.holtburgerAppDiagnostics;
	if (!bridge) return;
	const serialized = JSON.stringify(
		{ appBuild: APP_BUILD_LABEL, ...report },
		null,
		2,
	);
	void bridge
		.save({ kind: "renderer", report: serialized })
		.catch((error: unknown) => {
			console.error("Could not persist failure report.", error);
		});
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
