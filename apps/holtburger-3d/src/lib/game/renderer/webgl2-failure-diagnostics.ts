import {
	registerWebGL2Diagnostics,
	getWebGL2Diagnostics,
} from "../webgl/diagnostics";
import type { FrameInput, PortalTransitionOnlyFrameInput } from "./renderer";
import {
	readWebGL2DiagnosticIdentity,
	type WebGL2DeviceDiagnosticIdentity,
} from "./webgl2-diagnostic-identity";

/** Device facts captured while the context is healthy, before loss makes queries unreliable. */
export interface WebGL2FailureDevice {
	readonly identity: WebGL2DeviceDiagnosticIdentity;
	readonly maximumTextureSize: number;
	readonly maximumArrayLayers: number;
	readonly maximumElementIndex: number;
	readonly maximumViewport: readonly number[];
}

/** Bounded context-local breadcrumb; labels include resource keys or shader options. */
interface WebGL2Operation {
	readonly sequence: number;
	readonly label: string;
}

/** Portable first-failure evidence, independent of resource handles and context lifetime. */
export interface WebGL2FailureReport {
	readonly schemaVersion: 1;
	readonly capturedAt: string;
	readonly userAgent: string;
	readonly device: WebGL2FailureDevice;
	readonly reason: string;
	/** Last submitted frame, copied only on failure; null before first presentation. */
	readonly frame: {
		readonly anchorLandblockId: string | null;
		readonly extent: FrameInput["extent"];
		readonly settings: FrameInput["frameSettings"];
		/** Distinguishes outdoor and dungeon views sharing the same floating origin. */
		readonly viewCells: readonly {
			readonly landblockId: string;
			readonly envCellId: string | null;
		}[];
	} | null;
	readonly operations: readonly WebGL2Operation[];
	/** Successful resource-manager allocations only; excludes failed attempts, render targets, driver padding and retired in-flight storage. */
	readonly managedResources: {
		readonly liveBytes: number;
		readonly peakBytes: number;
	};
}

/** Retain only recent cold resource/shader operations; never retain payloads or GPU handles. */
const MAXIMUM_OPERATIONS = 64;

/** Context-lifetime recorder; the application owns persistence and export of failures. */
export class WebGL2FailureDiagnostics {
	readonly #device: WebGL2FailureDevice;
	readonly #report: (report: WebGL2FailureReport) => void;
	readonly #operations: WebGL2Operation[] = [];
	#sequence = 0;
	#liveBytes = 0;
	#peakBytes = 0;
	#failed = false;
	#frame: FrameInput | PortalTransitionOnlyFrameInput | null = null;

	constructor(
		gl: WebGL2RenderingContext,
		report: (report: WebGL2FailureReport) => void,
	) {
		this.#device = {
			identity: readWebGL2DiagnosticIdentity(gl),
			maximumTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
			maximumArrayLayers: gl.getParameter(
				gl.MAX_ARRAY_TEXTURE_LAYERS,
			) as number,
			maximumElementIndex: gl.getParameter(gl.MAX_ELEMENT_INDEX) as number,
			maximumViewport: Array.from(
				gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array,
			),
		};
		this.#report = report;
		registerWebGL2Diagnostics(gl, this);
	}

	/** Keep one immutable input reference; no clocks, snapshots, or history on the frame path. */
	setFrame(input: FrameInput | PortalTransitionOnlyFrameInput): void {
		if (!this.#failed) this.#frame = input;
	}

	record(label: string): void {
		if (this.#failed) return;
		this.#operations.push({ sequence: ++this.#sequence, label });
		if (this.#operations.length > MAXIMUM_OPERATIONS) this.#operations.shift();
	}

	/** Record staged allocations before retiring their predecessors. */
	changeBytes(delta: number, label: string): void {
		this.#liveBytes += delta;
		this.#peakBytes = Math.max(this.#peakBytes, this.#liveBytes);
		this.record(
			`${label}: ${delta >= 0 ? "+" : ""}${delta} bytes, live=${this.#liveBytes}`,
		);
	}

	/** Freeze the first failure so teardown and later context-loss events cannot overwrite it. */
	fail(reason: string): void {
		if (this.#failed) return;
		this.#failed = true;
		const frame = this.#frame;
		this.#frame = null;
		this.#report({
			schemaVersion: 1,
			capturedAt: new Date().toISOString(),
			userAgent: navigator.userAgent,
			device: this.#device,
			reason,
			frame:
				frame === null
					? null
					: structuredClone({
							anchorLandblockId:
								"anchorLandblockId" in frame ? frame.anchorLandblockId : null,
							extent: frame.extent,
							settings: frame.frameSettings,
							viewCells:
								"views" in frame
									? frame.views.map(({ camera }) => ({
											landblockId: camera.placement.landblockId,
											envCellId: camera.placement.envCellId,
										}))
									: [],
						}),
			operations: this.#operations.slice(),
			managedResources: {
				liveBytes: this.#liveBytes,
				peakBytes: this.#peakBytes,
			},
		});
	}
}

/** Update failure context without adding a per-frame diagnostic snapshot. */
export function setWebGL2FailureFrame(
	gl: WebGL2RenderingContext,
	input: FrameInput | PortalTransitionOnlyFrameInput,
): void {
	const observer = getWebGL2Diagnostics(gl);
	if (observer instanceof WebGL2FailureDiagnostics) observer.setFrame(input);
}
