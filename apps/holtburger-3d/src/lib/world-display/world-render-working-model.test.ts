import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import { WORLD_RENDER_DOMAIN } from "./render-domains";
import type {
	StaticRenderablePart,
	StaticRenderableSceneModel,
} from "./static-renderables";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import {
	deriveWorldRenderWorkingModel,
	type WorldRenderWorkingModelInput,
} from "./world-render-working-model";

describe("world render working model", () => {
	it("derives broad exterior and interior render sets from renderer mesh maps", () => {
		const terrainMesh = createMesh("terrain");
		const exteriorStaticMesh = createInstancedMesh("exterior-static");
		const interiorStaticMesh = createInstancedMesh("interior-static");
		const interiorShellMesh = createMesh("interior-shell");
		const input = createWorkingModelInput({
			terrainMeshes: new Map([["terrain/1", terrainMesh]]),
			staticRenderableGroupMeshes: new Map([
				["exterior-static|chunk/a|gfx-obj/1", exteriorStaticMesh],
				["interior-static|chunk/a|gfx-obj/1", interiorStaticMesh],
			]),
			structuredInteriorMeshes: new Map([
				["interior-cell-shell/env-cell/1", interiorShellMesh],
			]),
			staticRenderableScene: createStaticRenderableSceneModel([
				[
					"exterior-static|chunk/a|gfx-obj/1",
					WORLD_RENDER_DOMAIN.exteriorStatic,
				],
				[
					"interior-static|chunk/a|gfx-obj/1",
					WORLD_RENDER_DOMAIN.interiorStatic,
				],
			]),
			structuredInteriorScene: createStructuredInteriorSceneModel([
				createStructuredInteriorCell(
					0x01020304,
					"interior-cell-shell/env-cell/1",
				),
			]),
		});

		const model = deriveWorldRenderWorkingModel(input);

		expect(model.exterior.terrainMeshes).toEqual([terrainMesh]);
		expect(model.exterior.staticRenderableMeshes).toEqual([exteriorStaticMesh]);
		expect(model.interior.cellShellMeshes).toEqual([interiorShellMesh]);
		expect(model.interior.staticRenderableMeshes).toEqual([interiorStaticMesh]);
		expect(
			model.interior.envCellIdByCellShellRenderKey.get(
				"interior-cell-shell/env-cell/1",
			),
		).toBe(0x01020304);
		expect(model.interior.cellShellMeshByEnvCellId.get(0x01020304)).toBe(
			interiorShellMesh,
		);
	});

	it("does not create interior shell identity entries for meshes that are not loaded", () => {
		const input = createWorkingModelInput({
			structuredInteriorScene: createStructuredInteriorSceneModel([
				createStructuredInteriorCell(
					0x01020304,
					"interior-cell-shell/env-cell/1",
				),
			]),
		});

		const model = deriveWorldRenderWorkingModel(input);

		expect(model.interior.cellShellMeshes).toEqual([]);
		expect(model.interior.envCellIdByCellShellRenderKey.size).toBe(0);
		expect(model.interior.cellShellMeshByEnvCellId.size).toBe(0);
	});
});

function createWorkingModelInput(
	overrides: Partial<WorldRenderWorkingModelInput> = {},
): WorldRenderWorkingModelInput {
	return {
		terrainMeshes: new Map(),
		staticRenderableGroupMeshes: new Map(),
		structuredInteriorMeshes: new Map(),
		staticRenderableScene: createStaticRenderableSceneModel([]),
		structuredInteriorScene: createStructuredInteriorSceneModel([]),
		...overrides,
	};
}

function createStaticRenderableSceneModel(
	groups: [string, StaticRenderablePart["renderDomain"]][],
): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances: [],
		parts: [],
		partsByRenderDomainChunkAndGfxAssetId: new Map(
			groups.map(([groupKey, renderDomain]) => [
				groupKey,
				[createStaticRenderablePart(renderDomain)],
			]),
		),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
	};
}

function createStaticRenderablePart(
	renderDomain: StaticRenderablePart["renderDomain"],
): StaticRenderablePart {
	return {
		renderKey: `${renderDomain}/renderable`,
		renderDomain,
		instanceId: "instance/1",
		sourceAssetId: "source/1",
		sourceDid: 1,
		owningLandblockId: 0x0102ffff,
		owningEnvCellId:
			renderDomain === WORLD_RENDER_DOMAIN.interiorStatic ? 0x01020304 : null,
		renderChunk: {
			chunkKey: "landblock/0102ffff",
			chunkLandblockId: 0x0102ffff,
		},
		kind:
			renderDomain === WORLD_RENDER_DOMAIN.interiorStatic
				? "indoor-static"
				: "scenery",
		partIndex: 0,
		gfxObjId: 1,
		gfxObjAssetId: "gfx-obj/1",
		parentPlacements: [],
		chunkLocalInstancePlacement: createIdentityPlacement(),
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: "debug",
	};
}

function createStructuredInteriorSceneModel(
	cells: StructuredInteriorCell[],
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: cells.map((cell) => cell.envCellId),
		cells,
		missingEnvCellAssetIds: [],
		missingEnvironmentAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "ready",
		cacheText: "ready",
	};
}

function createStructuredInteriorCell(
	envCellId: number,
	renderKey: string,
): StructuredInteriorCell {
	return {
		renderKey,
		envCellId,
		renderChunk: {
			chunkKey: "landblock/0102ffff",
			chunkLandblockId: 0x0102ffff,
		},
		environmentId: 1,
		cellStructureId: 2,
		isFocus: false,
		chunkLocalPlacement: createIdentityPlacement(),
		surfaceIds: [],
		portalCount: 0,
		portals: [],
		portalApertures: [],
		staticObjectCount: 0,
		cellStructure: null,
		renderGeometry: {
			sourceId: 2,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			bounds: null,
			vertexCount: 0,
			triangleCount: 0,
		},
		debugColorKey: "debug",
	};
}

function createIdentityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function createMesh(name: string): Mesh {
	const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
	mesh.name = name;
	return mesh;
}

function createInstancedMesh(name: string): InstancedMesh {
	const mesh = new InstancedMesh(
		new BoxGeometry(1, 1, 1),
		new MeshBasicMaterial(),
		1,
	);
	mesh.name = name;
	return mesh;
}
