import type { LandblockOwnerId } from "../game-types";
import type { SceneResidency } from "../scene";
import type {
	LandblockLayerKind,
	SceneInterestMap,
	SceneInterestRequest,
} from "./scene-interest";

/** Opaque sequence identifying one frontend replacement of scene interest. */
export type SceneInterestRevision = number & {
	readonly __sceneInterestRevision: unique symbol;
};

/** Receipt returned immediately when frontend scene interest has been accepted. */
export interface SceneInterestReceipt {
	readonly revision: SceneInterestRevision;
}

/** Source-neutral request for one discontinuous destination installation. */
export interface SceneActivationRequest {
	/** Authority-owned transition generation; this is not a runtime scene-interest revision. */
	readonly generation: number;
	/** Exact profile-resolved content demand for the destination. */
	readonly target: SceneInterestRequest;
}

/** Accepted destination demand plus the exact static products that must become resident. */
export interface SceneActivationReceipt {
	readonly generation: number;
	readonly revision: SceneInterestRevision;
	readonly requiredLayers: SceneInterestMap;
}

/** Pollable installation state; readiness never implies that controls or authority have resumed. */
export type SceneActivationStatus =
	| {
			readonly kind: "pending";
			readonly receipt: SceneActivationReceipt;
	  }
	| {
			readonly kind: "ready";
			readonly receipt: SceneActivationReceipt;
	  }
	| {
			readonly kind: "failed";
			readonly receipt: SceneActivationReceipt;
			readonly diagnostic: string;
	  };

/** Runtime content transition useful to a frontend without exposing runtime-owned resources. */
export type SceneAvailabilityEvent =
	| {
			/** Canonical outdoor heights are available for placement before GPU realization completes. */
			readonly kind: "outdoor-terrain-source-available";
			readonly landblockId: LandblockOwnerId;
			readonly revision: SceneInterestRevision;
	  }
	| {
			/** One landblock's complete environment-cell topology was atomically published. */
			readonly kind: "env-cell-topology-available";
			readonly landblockId: LandblockOwnerId;
			readonly revision: SceneInterestRevision;
	  }
	| {
			/** One requested static layer failed before it could become resident. */
			readonly kind: "scene-content-failed";
			readonly layer: LandblockLayerKind;
			readonly message: string;
			readonly residency: SceneResidency;
			readonly revision: SceneInterestRevision;
	  }
	| {
			/** One requested layer has no source content for this landblock. */
			readonly kind: "scene-content-unavailable";
			readonly layer: LandblockLayerKind;
			readonly residency: SceneResidency;
			readonly revision: SceneInterestRevision;
	  };

/** Listener released by the frontend during teardown. */
export type SceneAvailabilityListener = (event: SceneAvailabilityEvent) => void;
