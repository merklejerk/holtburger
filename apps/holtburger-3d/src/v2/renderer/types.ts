import type { StaticDrawUnit } from "../static/contracts";

export interface FrameState {
	readonly camera: {
		readonly position: readonly [number, number, number];
		readonly yawRadians: number;
		readonly pitchRadians: number;
	};
	readonly timeSeconds: number;
}

export interface StaticResidencyDelta {
	readonly addedDrawUnitPlacements: readonly StaticDrawUnitPlacement[];
	readonly removedDrawUnitIds: readonly string[];
	readonly revision: number;
}

export interface StaticDrawUnitPlacement {
	readonly drawUnit: StaticDrawUnit;
	readonly translation: readonly [number, number, number];
}

export interface DynamicResidencyDelta {
	readonly addedInstanceIds: readonly string[];
	readonly removedInstanceIds: readonly string[];
	readonly revision: number;
}

export interface TexturePlacementUpdate {
	readonly textureRefIds: readonly string[];
	readonly revision: number;
}

export interface SamplerPolicyUpdate {
	readonly policyId: string;
	readonly revision: number;
}

export interface RendererSnapshot {
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly frameCount: number;
	readonly isRunning: boolean;
	readonly backend: "webgl2";
	readonly error: string | null;
	readonly staticDrawUnits: number;
	readonly terrainDrawUnits: number;
	readonly renderedTriangles: number;
}

export type RendererSnapshotListener = (snapshot: RendererSnapshot) => void;

export interface Renderer {
	applyStaticDelta(delta: StaticResidencyDelta): void;
	applyDynamicDelta(delta: DynamicResidencyDelta): void;
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void;
	updateFrameState(state: FrameState): void;
	subscribe(listener: RendererSnapshotListener): () => void;
	dispose(): void;
}
