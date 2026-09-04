import type { PortalTransitionPolicy } from "../lib/client/portal-transition-controller";
import type { HexRgbaColor } from "../lib/frontend-color";
import type {
	PossessionCameraOrbitPolicy,
	PossessionCameraRecenterPolicy,
} from "../lib/game/camera/possession-camera-controller";
import type { HostKinematicBoomDistancePolicy } from "../lib/game/camera/host-kinematic-boom-session";
import type { FrameSettings } from "../lib/game/renderer/renderer";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import type {
	FrontendAudioTuning,
	FrontendPortalTransitionTuning,
	FrontendUiDiagnosticsTuning,
} from "../lib/frontend-tuning-contract";

/** Client-owned third-person camera projection, placement, and gesture policy. */
interface ClientCameraTuning {
	/** Far clipping distance in world units. */
	readonly far: number;
	/** Vertical field of view in degrees. */
	readonly fov: number;
	/** Camera height above its unrotated target origin. */
	readonly height: number;
	/** Near clipping distance in world units. */
	readonly near: number;
	/** Initial downward view angle. */
	readonly pitchRadians: number;
	/** Legacy fixed rear offset used before a boom presentation is available. */
	readonly rearDistance: number;
	/** Host-validated third-person boom distance bounds. */
	readonly distance: HostKinematicBoomDistancePolicy;
	/** Pointer-driven orbit limits and rates. */
	readonly orbit: PossessionCameraOrbitPolicy;
	/** Time-based return-behind policy during continuous movement. */
	readonly recenter: PossessionCameraRecenterPolicy;
}

/** Client transition timing paired with the shared renderer-owned appearance. */
export interface ClientPortalTransitionTuning extends FrontendPortalTransitionTuning {
	/** Client lifecycle durations for entering and leaving portal space. */
	readonly timing: PortalTransitionPolicy;
}

/** Exhaustive client-owned tuning contract used to drive authoring completion. */
export interface ClientTuning {
	/** Shared audio policy selected by the client composition. */
	readonly audio: FrontendAudioTuning;
	/** Client diagnostic publication and display policy. */
	readonly diagnostics: FrontendUiDiagnosticsTuning;
	/** Client portal lifecycle timing and visual policy. */
	readonly portalTransition: ClientPortalTransitionTuning;
	/** Client third-person camera behavior. */
	readonly camera: ClientCameraTuning;
	/** Precise-jump evaluation cadence, reach, and marker presentation. */
	readonly preciseJump: {
		/** Maximum cadence for coalesced authority aim evaluation. */
		readonly aimEvaluationIntervalMs: number;
		/** Finite reach of the camera aim ray. */
		readonly maximumAimDistance: number;
		/** World-space outer radius of the surface marker. */
		readonly markerRadius: number;
	};
	/** Client-local entity acquisition feedback policy. */
	readonly entitySelection: {
		/** Maximum cadence for hover acquisition and selected-target validity sampling. */
		readonly sampleIntervalMs: number;
		/** App-local offscreen selected-target arrow appearance. */
		readonly offscreenIndicator: {
			/** Minimum arrow-center distance from each viewport edge. */
			readonly safeInsetCssPixels: number;
			/** Square arrow extent in CSS pixels. */
			readonly sizeCssPixels: number;
			/** Translucent arrow fill color. */
			readonly fillColor: HexRgbaColor;
			/** Arrow outline color. */
			readonly outlineColor: HexRgbaColor;
			/** Arrow outline thickness in CSS pixels. */
			readonly outlineWidthCssPixels: number;
			/** Outer glow color. */
			readonly glowColor: HexRgbaColor;
			/** Outer glow blur radius in CSS pixels. */
			readonly glowBlurCssPixels: number;
		};
	};
	/** Initial static-content demand around the controlled player. */
	readonly sceneInterest: SceneInterestRadii;
	/** Complete starting renderer display policy. */
	readonly frameSettings: FrameSettings;
}
