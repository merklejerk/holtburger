import type { SceneCameraFrame, SceneBoundsFrame } from "./camera";

export interface WorldRenderMetrics {
	bounds: SceneBoundsFrame | null;
	cameraFrame: SceneCameraFrame | null;
	geometry: {
		terrainTileCount: number;
		terrainVertexCount: number;
		terrainTriangleCount: number;
		staticRenderablePartCount: number;
		staticRenderableGeometryCount: number;
		structuredInteriorCellCount: number;
		structuredInteriorVertexCount: number;
		structuredInteriorTriangleCount: number;
	};
}

export type WorldRenderMetricsChangeHandler = (
	metrics: WorldRenderMetrics,
) => void;

export type WorldRenderCameraFrameChangeHandler = (
	cameraFrame: SceneCameraFrame,
) => void;
