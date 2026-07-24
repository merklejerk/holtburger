import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";

/** Dynamic display choices applied to a frame without changing world data or GPU setup. */
export interface FrameSettings {
	/** Whether render passes apply the effective region-authored distance fog. */
	readonly distanceFogEnabled: boolean;
}

/** Default dynamic display choices matching the region-authored presentation. */
export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
	distanceFogEnabled: true,
};

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
	/** Effective regional presentation shared by all renderer passes. */
	readonly environment: ResolvedSceneEnvironment;
	/** Dynamic display choices applied to this frame. */
	readonly frameSettings: FrameSettings;
	readonly views: readonly FrameViewInput[];
}

export interface Renderer {
	drawFrame(input: FrameInput): void;
	destroy(): Promise<void>;
}
