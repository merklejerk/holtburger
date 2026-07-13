import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";
import type { FrameViewScene } from "./render-scene";

/** Renderer-facing content selected for one camera or portal view. */
export interface FrameViewInput {
	readonly kind: "primary";
	/** Camera pose and projection used for this view. */
	readonly camera: Camera;
	readonly scene: FrameViewScene;
}

/** Immutable renderer input assembled from visible scene and render state. */
export interface FrameInput {
	/** Landblock whose origin is the floating render-world origin. */
	readonly anchorLandblockId: LandblockId;
	readonly timeSeconds: number;
	readonly views: readonly FrameViewInput[];
}

export interface Renderer {
	drawFrame(input: FrameInput): void;
	destroy(): Promise<void>;
}
