import type { SceneResidency } from "../lib/game/scene";
import type { ExplorerEnvironmentSelection } from "../lib/game/environment/scene-environment";
import type {
	FrameSettings,
	RendererFrameDiagnosticsSnapshot,
} from "../lib/game/renderer/renderer";
import type { WebGL2DeviceDiagnosticIdentity } from "../lib/game/renderer/webgl2-device";
import type { LoDConfig } from "../lib/game/runtime/types";
import type { ExplorerCameraLocation } from "./explorer-camera-location";
import type { FreeFlyCameraState } from "./free-fly-camera-controller";

const EXPLORER_FRAME_DIAGNOSTIC_REPORT_VERSION = 2;

/** Scene request that owns the content population represented by an exported frame report. */
export interface ExplorerSceneInterestSnapshot {
	readonly lod: LoDConfig;
	readonly residency: SceneResidency;
}

/** Browser-owned viewport facts recorded at the same instant as the diagnostic snapshot. */
interface ExplorerViewportDiagnosticSnapshot {
	readonly cssHeight: number;
	readonly cssWidth: number;
	readonly devicePixelRatio: number;
	readonly drawingBufferHeight: number;
	readonly drawingBufferWidth: number;
}

/** Versioned, JSON-safe evidence bundle composed at the Explorer diagnostic boundary. */
export interface ExplorerFrameDiagnosticReport {
	/** Explorer loop timing shown by the viewport HUD at capture time. */
	readonly applicationFrame: {
		readonly frameMs: number;
		readonly tickMs: number;
		readonly updateFrameMs: number;
	} | null;
	readonly browser: {
		readonly userAgent: string;
		readonly webgl: WebGL2DeviceDiagnosticIdentity;
	};
	readonly camera: {
		readonly location: {
			readonly position: {
				readonly x: number;
				readonly y: number;
				readonly z: number;
			};
			readonly residency: ExplorerCameraLocation["residency"];
		} | null;
		readonly pitchRadians: number;
		readonly position: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
		readonly yawRadians: number;
	} | null;
	readonly capturedAt: string;
	readonly environment: ExplorerEnvironmentSelection;
	readonly frame: RendererFrameDiagnosticsSnapshot;
	readonly frameSettings: FrameSettings;
	readonly sceneInterest: ExplorerSceneInterestSnapshot | null;
	readonly schemaVersion: typeof EXPLORER_FRAME_DIAGNOSTIC_REPORT_VERSION;
	readonly viewport: ExplorerViewportDiagnosticSnapshot;
}

export interface ExplorerFrameDiagnosticReportInput {
	readonly applicationFrame: ExplorerFrameDiagnosticReport["applicationFrame"];
	readonly browser: ExplorerFrameDiagnosticReport["browser"];
	readonly camera: FreeFlyCameraState | null;
	readonly cameraLocation: ExplorerCameraLocation | null;
	readonly capturedAt: string;
	readonly environment: ExplorerEnvironmentSelection;
	readonly frame: RendererFrameDiagnosticsSnapshot;
	readonly frameSettings: FrameSettings;
	readonly sceneInterest: ExplorerSceneInterestSnapshot | null;
	readonly viewport: ExplorerViewportDiagnosticSnapshot;
}

/** Freeze mutable Explorer and renderer state into one portable diagnostic fact set. */
export function createExplorerFrameDiagnosticReport(
	input: ExplorerFrameDiagnosticReportInput,
): ExplorerFrameDiagnosticReport {
	return {
		applicationFrame: input.applicationFrame,
		browser: input.browser,
		camera: input.camera
			? {
					location: input.cameraLocation
						? {
								position: {
									x: input.cameraLocation.position.x,
									y: input.cameraLocation.position.y,
									z: input.cameraLocation.position.z,
								},
								residency: input.cameraLocation.residency,
							}
						: null,
					pitchRadians: input.camera.pitchRadians,
					position: {
						x: input.camera.position.x,
						y: input.camera.position.y,
						z: input.camera.position.z,
					},
					yawRadians: input.camera.yawRadians,
				}
			: null,
		capturedAt: input.capturedAt,
		environment: input.environment,
		frame: input.frame,
		frameSettings: input.frameSettings,
		sceneInterest: input.sceneInterest,
		schemaVersion: EXPLORER_FRAME_DIAGNOSTIC_REPORT_VERSION,
		viewport: input.viewport,
	};
}

/** Stable human-readable serialization used by clipboard and file exports. */
export function serializeExplorerFrameDiagnosticReport(
	report: ExplorerFrameDiagnosticReport,
): string {
	return `${JSON.stringify(report, null, 2)}\n`;
}

/** Filesystem-safe name whose timestamp remains sortable across captures. */
export function explorerFrameDiagnosticReportFilename(
	report: ExplorerFrameDiagnosticReport,
): string {
	return `holtburger-frame-${report.capturedAt.replaceAll(":", "-")}.json`;
}
