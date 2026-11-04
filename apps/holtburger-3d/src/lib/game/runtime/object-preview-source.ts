import type { SetupVisualAppearance } from "../../assets/setup-visual-source";
import type { ParentLocation } from "../resolution/presentation";
import type { ResolvedModelPose } from "../animation/resolved-model-pose";

/** Captured visual source facts independent of entity residency and inspector layout. */
export interface ObjectPreviewVisual {
	readonly setupDid: number;
	readonly appearance: SetupVisualAppearance;
	readonly scale: number;
	/** Captured whole-object translucency in the inclusive unit interval. */
	readonly translucency: number;
	readonly pose: ResolvedModelPose;
}

/** One independently scaled visual attached directly to the preview subject. */
interface ObjectPreviewAttachment {
	/** Captured item visual; pose is independent from its parent's animation. */
	readonly visual: ObjectPreviewVisual;
	/** Named holding location on the subject setup. */
	readonly parentLocation: ParentLocation;
	/** Authored child placement key, resolved with the existing retail fallback. */
	readonly placement: number;
}

/** Bounded pre-game/inspection composition; no world placement or arbitrary hierarchy. */
export interface ObjectPreviewSource {
	/** The only subject participating in heading and character framing. */
	readonly body: ObjectPreviewVisual;
	/** Flat, separately rendered equipment; body-painted clothing is already in appearance. */
	readonly attachments: readonly ObjectPreviewAttachment[];
	/** Optional independent backdrop, excluded from subject framing. */
	readonly background: ObjectPreviewVisual | null;
}
