import type { SetupVisualAppearance } from "../../assets/setup-visual-source";

/** One already-authority-resolved animation traversal for an isolated model preview. */
interface ObjectPreviewSourceClip {
	readonly animationId: number;
	readonly lowFrame: number;
	readonly highFrame: number;
	readonly framerate: number;
}

/** Pose policy resolved before renderer preparation begins. */
type ObjectPreviewSourcePose =
	| {
			readonly kind: "default-idle";
			readonly clips: readonly ObjectPreviewSourceClip[];
			readonly firstCyclicClip: number;
	  }
	| { readonly kind: "setup-pose" };

/** Captured visual source facts independent of entity residency and inspector layout. */
export interface ObjectPreviewSource {
	readonly guid: number;
	readonly setupDid: number;
	readonly appearance: SetupVisualAppearance;
	readonly scale: number;
	/** Captured whole-object translucency in the inclusive unit interval. */
	readonly translucency: number;
	readonly pose: ObjectPreviewSourcePose;
}
