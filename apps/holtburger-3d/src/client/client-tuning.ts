import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
import { SHARED_FRAME_SETTINGS } from "../lib/frontend-frame-settings";
import { hexRgba, normalizedRgbaColor } from "../lib/frontend-color";
import type { FrameSettings } from "../lib/game/renderer/renderer";
import type { FrontendUiDiagnosticsTuning } from "../lib/frontend-tuning-contract";
import type {
	ClientPortalTransitionTuning,
	ClientTuning,
} from "./client-tuning-contract";

const CLIENT_DIAGNOSTICS = {
	/** Smoothing window used by the client frame-rate readout. */
	frameMetricsEmaWindowMs: 1_000,
	/** Client UI publication cadence for sampled frame-rate facts. */
	frameRateDisplayIntervalMs: 250,
	/** Largest numeric frame rate rendered by client diagnostics. */
	maximumDisplayedFramesPerSecond: 1_000,
} as const satisfies FrontendUiDiagnosticsTuning;

const CLIENT_FRAME_SETTINGS = {
	...SHARED_FRAME_SETTINGS,
	/** Match retail presentation until an explicitly enabled client diagnostic asks otherwise. */
	showRetailHiddenGeometry: false,
	entitySelectionOutline: {
		/** Golden depth-always edge shared visually with the offscreen arrow. */
		color: normalizedRgbaColor(hexRgba("#ffd129ff")),
		/** Authored in CSS pixels so render scale changes sampling rather than apparent thickness. */
		widthCssPixels: 2,
	},
} as const satisfies FrameSettings;

const CLIENT_PORTAL_TRANSITION = {
	/** Lifecycle timing consumed once by the client transition controller. */
	timing: {
		/** Time available for the captured origin to warp into portal space. */
		enterDurationMs: 1_000,
		/** Time available for portal space to reveal the settled destination. */
		exitDurationMs: 1_000,
	},
	/** Shared browser-frontend look selected explicitly by the client composition root. */
	visual: SHARED_FRONTEND_TUNING.portalTransition.visual,
} as const satisfies ClientPortalTransitionTuning;

/** Client-owned camera, scene-interest, diagnostics, and initial presentation policy. */
export const CLIENT_TUNING = {
	/** Shared audio policy selected explicitly by the client composition root. */
	audio: SHARED_FRONTEND_TUNING.audio,
	diagnostics: CLIENT_DIAGNOSTICS,
	portalTransition: CLIENT_PORTAL_TRANSITION,
	camera: {
		/** Projection used by the host-authored third-person camera. */
		far: 2_000,
		fov: 75,
		height: 2,
		near: 0.1,
		pitchRadians: -0.2,
		rearDistance: 4.5,
		distance: {
			initial: 4.5,
			minimum: 1.2,
			maximum: 50,
		},
		orbit: {
			maximumPitchRadians: 1.35,
			pitchRadiansPerPixel: 0.004,
			yawRadiansPerPixel: 0.004,
		},
		recenter: {
			delayMs: 350,
			durationMs: 180,
		},
	},
	preciseJump: {
		/** Maximum authority evaluation cadence; raw pointer samples are coalesced behind it. */
		aimEvaluationIntervalMs: 1_000 / 30,
		/** Finite camera-ray reach; static prediction may reject targets long before this limit. */
		maximumAimDistance: 120,
		/** World-space outer radius of the compact surface-aligned target ring. */
		markerRadius: 0.65,
	},
	entitySelection: {
		/** Modest staleness is sufficient for cursor feedback and selection range expiry. */
		sampleIntervalMs: 1_000 / 15,
		offscreenIndicator: {
			/** Includes half the arrow, its glow radius, and a small viewport-edge gutter. */
			safeInsetCssPixels: 64,
			sizeCssPixels: 64,
			fillColor: hexRgba("#e4a52d99"),
			outlineColor: hexRgba("#fff0b099"),
			outlineWidthCssPixels: 2,
			glowColor: hexRgba("#ffc332cc"),
			glowBlurCssPixels: 8,
		},
	},
	sceneInterest: {
		buildingRadius: 6,
		envCellRadius: 1,
		explicitObjectRadius: 1,
		generatedObjectRadius: 2,
		terrainRadius: 6,
	},
	/** Client-owned starting display policy. */
	frameSettings: CLIENT_FRAME_SETTINGS,
} as const satisfies ClientTuning;
