import type { Camera } from "../runtime/types";
import type { FrameViewScene } from "./render-world";

/** Renderer-facing content selected for one camera or portal view. */
export interface FrameViewInput {
	readonly kind: "primary";
	readonly scene: FrameViewScene;
}

/** Immutable renderer input assembled from visible scene and render state. */
export interface FrameInput {
	readonly camera: Camera;
	readonly timeSeconds: number;
	readonly views: readonly FrameViewInput[];
}

export interface Renderer {
	drawFrame(input: FrameInput): void;
	destroy(): Promise<void>;
}
