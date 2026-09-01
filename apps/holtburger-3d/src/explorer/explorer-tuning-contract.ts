import type { PortalTransitionPolicy } from "../lib/client/portal-transition-controller";
import type { HostKinematicBoomDistancePolicy } from "../lib/game/camera/host-kinematic-boom-session";
import type { FrameSettings } from "../lib/game/renderer/renderer";
import type { Camera, SceneInterestRadii } from "../lib/game/runtime/types";
import type {
	FrontendAudioTuning,
	FrontendColorGradeTuning,
	FrontendPortalTransitionTuning,
	FrontendUiDiagnosticsTuning,
} from "../lib/frontend-tuning-contract";

/** Explorer free-camera input rates and bounded browser-event policy. */
interface ExplorerCameraControlTuning {
	/** Time for held keyboard movement to reach full speed. */
	readonly keyboardAccelerationSeconds: number;
	/** Starting fraction of full keyboard movement speed. */
	readonly keyboardInitialSpeedMultiplier: number;
	/** Free-fly keyboard yaw rate. */
	readonly keyboardYawRadiansPerSecond: number;
	/** Largest admitted simulation step after a frame pause. */
	readonly maximumFrameDeltaSeconds: number;
	/** Vertical rotation limit below the camera singularity. */
	readonly maximumPitchRadians: number;
	/** Full-speed keyboard translation rate. */
	readonly moveSpeed: number;
	/** World-space pan distance applied per pointer pixel. */
	readonly panUnitsPerPixel: number;
	/** Vertical rotation applied per pointer pixel. */
	readonly pointerPitchRadiansPerPixel: number;
	/** Horizontal rotation applied per pointer pixel. */
	readonly pointerYawRadiansPerPixel: number;
	/** Movement multiplier while the precision modifier is active. */
	readonly shiftSlowMultiplier: number;
	/** Largest browser wheel delta consumed by one event. */
	readonly wheelDeltaClamp: number;
	/** Local-up movement applied per normalized wheel unit. */
	readonly wheelLocalUpUnitsPerDelta: number;
}

/** Explorer camera projection, initial pose, focus, and possession-boom policy. */
interface ExplorerCameraTuning {
	/** Free-camera keyboard, pointer, and wheel behavior. */
	readonly controls: ExplorerCameraControlTuning;
	/** Explorer possession camera choices sent to the host-owned boom. */
	readonly boom: {
		/** Host-validated third-person boom distance bounds. */
		readonly distance: HostKinematicBoomDistancePolicy;
		/** Continuous movement before the camera returns behind its target. */
		readonly recenterDelayMs: number;
		/** Desired duration of the rear-facing transition. */
		readonly recenterDurationMs: number;
		/** Scale from normalized free-camera wheel travel to boom zoom. */
		readonly zoomDistanceMultiplier: number;
	};
	/** Projection shared by Explorer-controlled primary views. */
	readonly framing: Pick<Camera, "far" | "fov" | "near">;
	/** Initial free-camera orientation before focus or input. */
	readonly initialOrientation: {
		/** Initial vertical view angle. */
		readonly pitchRadians: number;
		/** Initial horizontal view angle. */
		readonly yawRadians: number;
	};
	/** Automatic outdoor camera offset from sampled terrain. */
	readonly outdoorFocus: {
		/** Height retained above sampled terrain. */
		readonly clearance: number;
		/** Horizontal displacement from the focused landblock center. */
		readonly offset: number;
	};
}

/** Explorer transition timing paired with the shared renderer-owned appearance. */
interface ExplorerPortalTransitionTuning extends FrontendPortalTransitionTuning {
	/** Explorer lifecycle durations for entering and leaving portal space. */
	readonly timing: PortalTransitionPolicy;
}

/** Mode-owned Explorer knobs before the complete frame policy is composed. */
export interface ExplorerTuningOverrides {
	/** Shared audio policy selected by the Explorer composition. */
	readonly audio: FrontendAudioTuning;
	/** Explorer diagnostic publication and display policy. */
	readonly diagnostics: FrontendUiDiagnosticsTuning;
	/** Explorer portal lifecycle timing and visual policy. */
	readonly portalTransition: ExplorerPortalTransitionTuning;
	/** Explorer camera and interaction behavior. */
	readonly camera: ExplorerCameraTuning;
	/** Initial authored environment selection. */
	readonly environment: {
		/** Selected day group, or null to follow the region default. */
		readonly defaultDayGroupOverride: number | null;
		/** Initial day index within the effective group. */
		readonly defaultDayIndex: number;
		/** Initial normalized time within the selected day. */
		readonly defaultTimeOfDay: number;
	};
	/** Initial and selectable static-content demand bounds. */
	readonly residency: {
		/** Initial radius selected independently for every static layer. */
		readonly defaultRadii: SceneInterestRadii;
		/** Largest radius selectable in Explorer controls. */
		readonly maximumRadius: number;
		/** Smallest radius selectable in Explorer controls. */
		readonly minimumRadius: number;
	};
	/** Explorer's initial color-grade enablement and parameters. */
	readonly colorGrade: FrontendColorGradeTuning;
}

/** Complete exported Explorer tuning after initial frame-policy composition. */
export interface ExplorerTuning extends ExplorerTuningOverrides {
	/** Complete starting renderer display policy. */
	readonly frameSettings: FrameSettings;
}
