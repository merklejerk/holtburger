import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";

/** Camera state for one camera or portal view. The renderer collects scene content itself. */
export interface FrameViewInput {
	/** Camera pose and projection used for this view. */
	readonly camera: Camera;
}

/** Immutable renderer input carrying frame state rather than preassembled draw submissions. */
export interface FrameInput {
	/** Landblock whose origin is the floating render-world origin. */
	readonly anchorLandblockId: LandblockId;
	readonly timeSeconds: number;
	/** Frontend-resolved regional presentation shared by all renderer passes. */
	readonly environment: ResolvedSceneEnvironment;
	readonly views: readonly FrameViewInput[];
}

export interface Renderer {
	drawFrame(input: FrameInput): void;
	destroy(): Promise<void>;
}
