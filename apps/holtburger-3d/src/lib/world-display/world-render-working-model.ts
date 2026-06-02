import type { InstancedMesh, Mesh } from "three";

import { WORLD_RENDER_DOMAIN } from "./render-domains";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";

export interface WorldRenderWorkingModelInput {
	terrainMeshes: ReadonlyMap<string, Mesh>;
	staticRenderableGroupMeshes: ReadonlyMap<string, InstancedMesh>;
	structuredInteriorMeshes: ReadonlyMap<string, Mesh>;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
}

export interface WorldRenderWorkingModel {
	exterior: WorldRenderSceneSet;
	interior: WorldInteriorRenderSceneSet;
}

interface WorldRenderSceneSet {
	terrainMeshes: Mesh[];
	staticRenderableMeshes: InstancedMesh[];
}

interface WorldInteriorRenderSceneSet {
	cellShellMeshes: Mesh[];
	staticRenderableMeshes: InstancedMesh[];
	envCellIdByCellShellRenderKey: Map<string, number>;
	cellShellMeshByEnvCellId: Map<number, Mesh>;
}

export function deriveWorldRenderWorkingModel(
	input: WorldRenderWorkingModelInput,
): WorldRenderWorkingModel {
	const exteriorStaticRenderableMeshes: InstancedMesh[] = [];
	const interiorStaticRenderableMeshes: InstancedMesh[] = [];
	for (const [groupKey, mesh] of input.staticRenderableGroupMeshes.entries()) {
		const parts =
			input.staticRenderableScene.partsByRenderGroupKey.get(groupKey);
		const renderDomain = parts?.[0]?.renderDomain;
		if (renderDomain === WORLD_RENDER_DOMAIN.exteriorStatic) {
			exteriorStaticRenderableMeshes.push(mesh);
		} else if (renderDomain === WORLD_RENDER_DOMAIN.interiorStatic) {
			interiorStaticRenderableMeshes.push(mesh);
		}
	}

	const interiorCellShellMeshes: Mesh[] = [];
	const envCellIdByCellShellRenderKey = new Map<string, number>();
	const cellShellMeshByEnvCellId = new Map<number, Mesh>();
	for (const cell of input.structuredInteriorScene.cells) {
		const mesh = input.structuredInteriorMeshes.get(cell.renderKey);
		if (!mesh) {
			continue;
		}

		interiorCellShellMeshes.push(mesh);
		envCellIdByCellShellRenderKey.set(cell.renderKey, cell.envCellId);
		cellShellMeshByEnvCellId.set(cell.envCellId, mesh);
	}

	return {
		exterior: {
			terrainMeshes: [...input.terrainMeshes.values()],
			staticRenderableMeshes: exteriorStaticRenderableMeshes,
		},
		interior: {
			cellShellMeshes: interiorCellShellMeshes,
			staticRenderableMeshes: interiorStaticRenderableMeshes,
			envCellIdByCellShellRenderKey,
			cellShellMeshByEnvCellId,
		},
	};
}
