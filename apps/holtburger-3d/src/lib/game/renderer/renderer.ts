import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";
import type { ResolvedScenePlacement } from "../scene";
import type { TerrainDrawResources } from "../terrain/types";
import type { FrameViewScene } from "./render-scene";
import type { TerrainProgramInput } from "./terrain-program-input";

/** One visible terrain root paired with the preselected resources for this frame. */
export interface TerrainFrameInput {
	readonly placement: ResolvedScenePlacement;
	readonly resources: TerrainDrawResources;
	/** Renderer-ready pcode, composition, and regional texture bindings. */
	readonly program: TerrainProgramInput;
}

/** Renderer-facing content selected for one camera or portal view. */
export interface FrameViewInput {
	/** Camera pose and projection used for this view. */
	readonly camera: Camera;
	/** Terrain submissions selected directly from TerrainService. */
	readonly terrain: readonly TerrainFrameInput[];
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
