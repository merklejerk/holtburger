import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
import { SHARED_FRAME_SETTINGS } from "../lib/frontend-frame-settings";
import type { FrameSettings } from "../lib/game/renderer/renderer";
import type { FrontendUiDiagnosticsTuning } from "../lib/frontend-tuning-contract";
import type {
	ExplorerTuning,
	ExplorerTuningOverrides,
} from "./explorer-tuning-contract";

const EXPLORER_DIAGNOSTICS = {
	/** Smoothing window used by the Explorer frame-time readout. */
	frameMetricsEmaWindowMs: 1_000,
	/** Explorer UI publication cadence for sampled frame-rate facts. */
	frameRateDisplayIntervalMs: 250,
	/** Largest numeric frame rate rendered by Explorer diagnostics. */
	maximumDisplayedFramesPerSecond: 1_000,
} as const satisfies FrontendUiDiagnosticsTuning;

/** Explorer-owned interaction, environment, diagnostics, and initial presentation policy. */
const EXPLORER_TUNING_OVERRIDES = {
	/** Shared audio policy selected explicitly by the Explorer composition root. */
	audio: SHARED_FRONTEND_TUNING.audio,
	diagnostics: EXPLORER_DIAGNOSTICS,
	portalTransition: {
		/** Lifecycle timing consumed once by the Explorer transition controller. */
		timing: {
			/** Time available for the previous Explorer view to enter portal space. */
			enterDurationMs: 1_000,
			/** Time available for portal space to reveal the installed Explorer view. */
			exitDurationMs: 1_000,
		},
		/** Shared browser-frontend look selected explicitly by the Explorer composition root. */
		visual: SHARED_FRONTEND_TUNING.portalTransition.visual,
	},
	camera: {
		controls: {
			/** Seconds over which held keyboard movement reaches full speed. */
			keyboardAccelerationSeconds: 2,
			/** Starting fraction of full speed for held keyboard movement. */
			keyboardInitialSpeedMultiplier: 0.125,
			/** Free-fly keyboard yaw speed before the precision modifier is applied. */
			keyboardYawRadiansPerSecond: 1.8,
			/** Largest simulation step admitted after an animation-frame pause. */
			maximumFrameDeltaSeconds: 0.05,
			/** Vertical rotation limit, short of the camera-axis singularity. */
			maximumPitchRadians: 1.38,
			/** Full-speed keyboard translation rate in world units per second. */
			moveSpeed: 150,
			/** World-space pan distance applied per pointer pixel. */
			panUnitsPerPixel: 0.18,
			/** Vertical rotation applied per pointer pixel. */
			pointerPitchRadiansPerPixel: 0.005,
			/** Horizontal rotation applied per pointer pixel. */
			pointerYawRadiansPerPixel: 0.006,
			/** Free-fly movement multiplier while the precision modifier is active. */
			shiftSlowMultiplier: 0.05,
			/** Largest browser wheel delta consumed by one camera event. */
			wheelDeltaClamp: 900,
			/** Local-up movement applied per normalized browser wheel unit. */
			wheelLocalUpUnitsPerDelta: -0.025,
		},
		/** Explorer gesture and initial-framing choices sent to the host-owned boom. */
		boom: {
			/** Interdependent operator reach bounds, validated and enforced by the host. */
			distance: {
				initial: 4.5,
				maximum: 32,
				minimum: 1.2,
			},
			/** Continuous translation before the possession camera returns behind the entity. */
			recenterDelayMs: 1_000,
			/** Desired rear-facing transition duration; zero would produce an instantaneous snap. */
			recenterDurationMs: 200,
			/** Multiplier from the normalized free-camera wheel distance to boom zoom distance. */
			zoomDistanceMultiplier: 0.25,
		},
		/** Projection shared by Explorer-controlled primary views. */
		framing: { fov: 75, near: 0.1, far: 2_000 },
		/** Initial orientation before automatic scene focus or manual input. */
		initialOrientation: { pitchRadians: -0.45, yawRadians: 0 },
		outdoorFocus: {
			/** Height above sampled terrain used for automatic outdoor placement. */
			clearance: 48,
			/** Horizontal offset from the focused landblock center. */
			offset: 48,
		},
	},
	environment: {
		/** Default day group index in Explorer (day group 0 / "Clear"). */
		defaultDayGroupOverride: 0 as number | null,
		defaultDayIndex: 0,
		defaultTimeOfDay: 0.5,
	},
	residency: {
		/** Initial outdoor scene-interest radii exposed by Explorer controls. */
		defaultRadii: {
			buildingRadius: 8,
			envCellRadius: 2,
			explicitObjectRadius: 2,
			generatedObjectRadius: 2,
			terrainRadius: 8,
		},
		/** Largest outdoor scene-interest radius selectable in Explorer. */
		maximumRadius: 8,
		/** Smallest outdoor scene-interest radius selectable in Explorer. */
		minimumRadius: 0,
	},
	/** Explorer's authored grading look; the client may choose a different initial grade. */
	colorGrade: {
		enabledByDefault:
			SHARED_FRONTEND_TUNING.rendering.colorGrade.enabledByDefault,
		parameters: SHARED_FRONTEND_TUNING.rendering.colorGrade.parameters,
	},
} as const satisfies ExplorerTuningOverrides;

const EXPLORER_FRAME_SETTINGS = {
	...SHARED_FRAME_SETTINGS,
	/** Explorer is a content-inspection surface, so authored debug/collision meshes remain visible. */
	showRetailHiddenGeometry: true,
	colorGrade: {
		...SHARED_FRAME_SETTINGS.colorGrade,
		enabled: EXPLORER_TUNING_OVERRIDES.colorGrade.enabledByDefault,
		parameters: EXPLORER_TUNING_OVERRIDES.colorGrade.parameters,
	},
} as const satisfies FrameSettings;

export const EXPLORER_TUNING = {
	...EXPLORER_TUNING_OVERRIDES,
	/** Explorer's initial display policy, composed from shared defaults and its authored grade. */
	frameSettings: EXPLORER_FRAME_SETTINGS,
} as const satisfies ExplorerTuning;
