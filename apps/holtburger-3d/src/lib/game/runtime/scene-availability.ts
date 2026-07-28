import type { LandblockId } from "../game-types";
import type { SceneResidency } from "../scene";
import type { LandblockLayerKind } from "./scene-interest";

/** Opaque sequence identifying one frontend replacement of scene interest. */
export type SceneInterestRevision = number & {
	readonly __sceneInterestRevision: unique symbol;
};

/** Receipt returned immediately when frontend scene interest has been accepted. */
export interface SceneInterestReceipt {
	readonly revision: SceneInterestRevision;
}

/** Runtime content transition useful to a frontend without exposing runtime-owned resources. */
export type SceneAvailabilityEvent =
	| {
			/** Canonical outdoor heights are available for placement before GPU realization completes. */
			readonly kind: "outdoor-terrain-source-available";
			readonly landblockId: LandblockId;
			readonly revision: SceneInterestRevision;
	  }
	| {
			/** One landblock's complete environment-cell topology was atomically published. */
			readonly kind: "env-cell-topology-available";
			readonly landblockId: LandblockId;
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
