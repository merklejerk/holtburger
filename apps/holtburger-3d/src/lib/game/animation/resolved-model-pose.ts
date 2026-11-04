/** One resolved authored animation window, independent of a motion table or host body. */
interface ResolvedModelClip {
	/** Animation DAT identity supplied by the resolved visual source. */
	readonly animationId: number;
	/** Inclusive first authored frame. */
	readonly lowFrame: number;
	/** Inclusive last authored frame. */
	readonly highFrame: number;
	/** Signed authored playback rate; zero holds the entry frame. */
	readonly framerate: number;
}

/** Complete visual playback policy resolved before asset preparation begins. */
export type ResolvedModelPose =
	| {
			/** Captured or UI-authored idle, with its prefix and cyclic tail preserved. */
			readonly kind: "default-idle";
			/** Exact authored traversal order, including repeated asset windows. */
			readonly clips: readonly ResolvedModelClip[];
			/** First window repeated after the one-time prefix. */
			readonly firstCyclicClip: number;
	  }
	| { readonly kind: "setup-pose" };
