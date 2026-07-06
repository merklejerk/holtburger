/** Texture commit emitted independently from scene commits. */
export interface OpenWorldStreamingTextureCommit {
	readonly bindingRemovals: readonly string[];
	readonly bindingUpdates: readonly OpenWorldStreamingTextureBindingResolution[];
	readonly bucketKey: string;
	readonly kind: "texture-commit";
	readonly pageRemovals: readonly OpenWorldStreamingTexturePageRemoval[];
	readonly pageUpdates: readonly OpenWorldStreamingTexturePageUpdate[];
}

/** Renderer-facing binding readiness produced by texture residency. */
interface OpenWorldStreamingTextureBindingResolution {
	readonly bindingId: string;
	readonly readiness: OpenWorldStreamingTextureBindingReadiness;
}

/** Replacement-native readiness states; these are not legacy placement snapshots. */
export type OpenWorldStreamingTextureBindingReadiness =
	| {
			readonly kind: "resident";
			readonly pageId: string;
			readonly textureRefId: string;
	  }
	| {
			readonly kind: "pending";
			readonly reason: "page-building" | "placement-planned";
	  }
	| {
			readonly kind: "failed";
			readonly message: string;
	  };

/** Concrete page upload accepted by the main-loop texture applier. */
interface OpenWorldStreamingTexturePageUpdate {
	readonly pageId: string;
	readonly reservationToken: string;
}

/** Concrete page removal accepted by the main-loop texture applier. */
interface OpenWorldStreamingTexturePageRemoval {
	readonly pageId: string;
	readonly reason: "reclaimed" | "repacked";
}

export function summarizeOpenWorldStreamingTextureCommit(
	commit: OpenWorldStreamingTextureCommit,
): {
	readonly bindingRemovalCount: number;
	readonly bindingUpdateCount: number;
	readonly pageRemovalCount: number;
	readonly pageUpdateCount: number;
} {
	return {
		bindingRemovalCount: commit.bindingRemovals.length,
		bindingUpdateCount: commit.bindingUpdates.length,
		pageRemovalCount: commit.pageRemovals.length,
		pageUpdateCount: commit.pageUpdates.length,
	};
}
