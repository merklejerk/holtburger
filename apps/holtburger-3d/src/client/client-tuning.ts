import {
	SHARED_FRONTEND_TUNING,
	type FrontendUiDiagnosticsTuning,
} from "../lib/frontend-tuning";
import { SHARED_FRAME_SETTINGS } from "../lib/frontend-frame-settings";
import type { FrameSettings } from "../lib/game/renderer/renderer";

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
} as const satisfies FrameSettings;

/** Client-owned camera, scene-interest, diagnostics, and initial presentation policy. */
export const CLIENT_TUNING = {
	/** Shared audio policy selected explicitly by the client composition root. */
	audio: SHARED_FRONTEND_TUNING.audio,
	diagnostics: CLIENT_DIAGNOSTICS,
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
	sceneInterest: {
		buildingRadius: 2,
		envCellRadius: 1,
		explicitObjectRadius: 2,
		generatedObjectRadius: 2,
		terrainRadius: 3,
	},
	/** Client-owned starting display policy. */
	frameSettings: CLIENT_FRAME_SETTINGS,
} as const;
