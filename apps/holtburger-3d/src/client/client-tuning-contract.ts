import type { CycleSelectionPolicy } from "./client-cycle-selection-controller";
import type { PortalTransitionPolicy } from "../lib/client/portal-transition-controller";
import type { HexRgbaColor } from "../lib/frontend-color";
import type {
	PossessionCameraOrbitPolicy,
	PossessionCameraRecenterPolicy,
} from "../lib/game/camera/possession-camera-controller";
import type { HostKinematicBoomDistancePolicy } from "../lib/game/camera/host-kinematic-boom-session";
import type { FrameSettings } from "../lib/game/renderer/renderer";
import type {
	FrontendAudioTuning,
	FrontendPortalTransitionTuning,
	FrontendUiDiagnosticsTuning,
} from "../lib/frontend-tuning-contract";

/** Client-owned third-person camera projection, placement, and gesture policy. */
interface ClientCameraTuning {
	/** Far clipping distance in world units. */
	readonly far: number;
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
	/** Mounted spell-list artwork sampling; membership itself is event-driven. */
	readonly spells: { readonly iconDisplayIntervalMs: number };
	/** Shared audio policy selected by the client composition. */
	readonly audio: FrontendAudioTuning;
	/** Client diagnostic publication and display policy. */
	readonly diagnostics: FrontendUiDiagnosticsTuning;
	/** Client portal lifecycle timing and visual policy. */
	readonly portalTransition: ClientPortalTransitionTuning;
	/** Server-backed object-inspection presentation policy. */
	readonly objectInspection: {
		/** Delay between completed refreshes while an inspection window remains open. */
		readonly refreshIntervalMs: number;
		/** Maximum item-description characters shown before explicit expansion. */
		readonly collapsedDescriptionCharacters: number;
	};
	/** Isolated creature-inspection model presentation and local controls. */
	readonly objectPreview: {
		/** User-resizable preview-pane height in CSS pixels. */
		readonly height: {
			/** Height assigned when an inspection window is created. */
			readonly initial: number;
			/** Smallest height reachable by pointer or keyboard resizing. */
			readonly minimum: number;
			/** Largest height reachable by pointer or keyboard resizing. */
			readonly maximum: number;
			/** Height change for one keyboard resize command. */
			readonly keyboardStep: number;
		};
		readonly maximumFramesPerSecond: number;
		readonly maximumBufferWidth: number;
		readonly maximumBufferHeight: number;
		/** Minimum supersampling used when device pixel density would otherwise be lower. */
		readonly minimumResolutionScale: number;
		readonly initialYawRadians: number;
		readonly yawRadiansPerPixel: number;
		readonly keyboardYawStepRadians: number;
	};
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
		/** One-shot nearest acquisition threshold for all held Tab chords. */
		readonly holdDelayMs: number;
		/** Keyboard acquisition range, stable traversal, and approximate view policy. */
		readonly cycle: CycleSelectionPolicy;
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
	/** Bounded external-storage display pulls; access still commits at session cadence. */
	readonly worldContainer: {
		readonly displayIntervalMs: number;
		/** Bounds for the initial grid footprint before the container is shown. */
		readonly openingGrid: {
			/** Small containers reserve one row at this width. */
			readonly minColumns: number;
			/** Wider containers stop growing horizontally at this count. */
			readonly maxColumns: number;
			/** Additional items and pack headings scroll beyond this row budget. */
			readonly maxRows: number;
		};
	};
	/** Mounted inventory display sampling policy. */
	readonly inventory: {
		/** Pointer travel required before an inventory selection becomes a drag. */
		readonly dragThresholdCssPixels: number;
		/** Time after a drag during which synthetic double-click activation is suppressed. */
		readonly doubleClickSuppressionMs: number;
		readonly displayIntervalMs: number;
	};
	/** Selected-entity HUD display policy. */
	readonly selectedEntityHud: {
		/** Selected healing-kit name accent. */
		readonly healingKitColor: HexRgbaColor;
		/** Selected mana-stone name accent. */
		readonly manaStoneColor: HexRgbaColor;
		/** Bounded cadence for refreshing selected-entity display text. */
		readonly displayIntervalMs: number;
	};
	/** Complete starting renderer display policy. */
	readonly frameSettings: FrameSettings;
}
