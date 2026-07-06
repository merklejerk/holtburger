import type { TextureBindingId } from "../../../../textures/identity";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../../../../textures/sampling-policy";
import type { OpenWorldTexturePageReservationToken } from "../claims/texture-claim-registry";

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
	readonly bindingId: TextureBindingId;
	readonly readiness: OpenWorldStreamingTextureBindingReadiness;
}

/** Replacement-native readiness states; these are not legacy placement snapshots. */
export type OpenWorldStreamingTextureBindingReadiness =
	| {
			readonly kind: "resident";
			readonly pageVersion: {
				readonly placementRevision: number;
				readonly textureRefId: string;
			};
			readonly rect: readonly [number, number, number, number];
			readonly textureHeight: number;
			readonly textureRefId: string;
			readonly textureWidth: number;
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
	/** Renderer sampler anisotropy value. */
	readonly anisotropy: number;
	/** Runtime texture filtering mode. */
	readonly filteringMode: TextureFilteringMode;
	/** Renderer texture page pixel format. */
	readonly format: "rgba8" | "r8" | "rg8";
	/** Runtime page height in pixels. */
	readonly height: number;
	/** Whether the renderer should generate mipmaps. */
	readonly mipmapsGenerated: boolean;
	/** Replacement virtual page id. */
	readonly pageId: string;
	/** Complete page pixels to upload on the main loop. */
	readonly pixels: Uint8Array;
	/** Reservation token that was accepted before this commit was emitted. */
	readonly reservationToken: OpenWorldTexturePageReservationToken;
	/** Renderer sample class for shader interpretation. */
	readonly sampleClass: TexturePageSampleClass;
	/** Stable sampler policy key. */
	readonly samplerPolicyKey: string;
	/** Renderer texture ref updated by this page. */
	readonly textureRefId: string;
	/** Renderer adapter wart: current renderer upload DTO still requires a binding id. */
	readonly uploadBindingId: TextureBindingId;
	/** Runtime page width in pixels. */
	readonly width: number;
	/** Horizontal wrap mode. */
	readonly wrapS: TextureWrapMode;
	/** Vertical wrap mode. */
	readonly wrapT: TextureWrapMode;
}

/** Concrete page removal accepted by the main-loop texture applier. */
interface OpenWorldStreamingTexturePageRemoval {
	readonly pageId: string;
	readonly reason: "reclaimed" | "repacked";
	readonly textureRefId: string;
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
