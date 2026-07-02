import { describe, expect, it } from "vitest";

import { bakeObjectVisuals } from "../../../visual/object-visual-baker";
import {
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryTriangle,
} from "../../../visual/object-visual-recipe-bundle";
import { createObjectVisualStaticInstallSet } from "../../../visual/object-visual-static-publication-baker";
import type {
	EnvCellCellStructureGeometryAttachment,
	EnvCellSystemStaticScopePayload,
	LandblockEnvCellStaticFacts,
	StaticBakeTask,
	StaticObjectMaterialSourceFacts,
} from "../../contracts";
import { createEnvCellCellStructureGeometryIdentity } from "./env-cell-system-geometry-resources";
import { createStructuredInteriorVisualBundleExpansion } from "./structured-interior-visual-bundle-producer";

const TEST_LANDBLOCK_ID = 0xda55ffff;
const TEST_ENV_CELL_ID = 0xda550100;
const TEST_CELL_STRUCTURE_ID = 0x0d000001;
const TEST_ENVIRONMENT_ID = 0x0e000001;
const TEST_MATERIAL_ID = 0x08000010;

describe("structured interior visual bundle producer", () => {
	it("expands cell-structure geometry into a ready bundle and publication metadata", () => {
		const payload = createPayload();
		const envCell = payload.envCells[0];
		if (!envCell) {
			throw new Error("Missing fixture env cell.");
		}
		const expansion = createStructuredInteriorVisualBundleExpansion({
			attachments: {
				envCellCellStructureGeometry: [createGeometryAttachment(envCell)],
			},
			envCell,
			payload,
			task: createTask(),
		});

		expect(expansion.resolution.kind).toBe("ready");
		if (expansion.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		expect(expansion.geometryBuffers.size).toBe(1);
		expect(expansion.resolution.bundle.partInstances).toHaveLength(1);
		expect(expansion.resolution.bundle.partInstances[0]?.residency).toEqual({
			envCellId: TEST_ENV_CELL_ID,
			kind: "env-cell",
			landblockId: TEST_LANDBLOCK_ID,
		});
		expect(expansion.resolution.bundle.geometryBufferRefs.size).toBe(1);
		expect(expansion.resolution.bundle.partRecipes.size).toBe(1);
		expect(expansion.publicationMetadata).not.toBeNull();

		const bake = bakeObjectVisuals({
			bundle: expansion.resolution.bundle,
			geometryBuffers: expansion.geometryBuffers,
			renderPartIdPrefix: "structured-interior-fixture",
		});
		const installSet = createObjectVisualStaticInstallSet({
			bakeResult: bake,
			metadata: expansion.publicationMetadata!,
		});

		expect(installSet.directDrawUnits).toHaveLength(1);
		expect(installSet.directDrawUnits[0]).toMatchObject({
			cellStructure: {
				cellStructureId: TEST_CELL_STRUCTURE_ID,
				kind: "cell-structure",
			},
			envCellId: TEST_ENV_CELL_ID,
			environment: {
				environmentId: TEST_ENVIRONMENT_ID,
				kind: "environment",
			},
			kind: "structured-interior-geometry",
			landblockId: TEST_LANDBLOCK_ID,
			materialPlan: [
				expect.objectContaining({
					material: {
						kind: "static-material-source",
						materialId: TEST_MATERIAL_ID,
					},
					surfaceId: TEST_MATERIAL_ID,
				}),
			],
			memberId: "cell-0",
			sourceTriangleIds: ["polygon:1|surface:0|first:0|variant:none"],
			surfaceIds: [TEST_MATERIAL_ID],
		});
		expect(installSet.directDrawUnits[0]?.triangleCount).toBe(1);
		expect(installSet.visualResources).toEqual([]);
		expect(installSet.renderInstances).toEqual([]);
	});

	it("returns missing dependencies when the geometry sidecar is absent", () => {
		const payload = createPayload();
		const envCell = payload.envCells[0];
		if (!envCell) {
			throw new Error("Missing fixture env cell.");
		}

		const expansion = createStructuredInteriorVisualBundleExpansion({
			attachments: { envCellCellStructureGeometry: [] },
			envCell,
			payload,
			task: createTask(),
		});

		expect(expansion.geometryBuffers.size).toBe(0);
		expect(expansion.publicationMetadata).toBeNull();
		expect(expansion.resolution).toMatchObject({
			kind: "missing-dependencies",
			missingDependencies: [{ sourceKind: "env-cell-cell-structure-geometry" }],
		});
	});

	it("keeps empty render geometry as a ready empty visual bundle", () => {
		const payload = createPayload({ renderGeometry: "empty" });
		const envCell = payload.envCells[0];
		if (!envCell) {
			throw new Error("Missing fixture env cell.");
		}

		const expansion = createStructuredInteriorVisualBundleExpansion({
			attachments: { envCellCellStructureGeometry: [] },
			envCell,
			payload,
			task: createTask(),
		});

		expect(expansion.resolution.kind).toBe("ready");
		if (expansion.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		expect(expansion.geometryBuffers.size).toBe(0);
		expect(expansion.resolution.bundle.partInstances).toEqual([]);
		expect(expansion.publicationMetadata).toMatchObject({
			directStaticObjectDrawUnits: [],
			instancedRenderInstances: [],
			instancedResourceGroups: [],
			sidecarResidencies: [],
			structuredInteriorDrawUnits: [],
		});
	});
});

function createTask(): StaticBakeTask {
	return {
		domain: "env-cell-system",
		ownerId: "env-cell-system:0xda55ffff",
		ownerKey: {
			kind: "env-cell-system",
			landblockId: TEST_LANDBLOCK_ID,
		},
		revision: 7,
		scope: {
			kind: "landblock",
			landblockId: TEST_LANDBLOCK_ID,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "7:landblock:da55ffff:env-cell-system",
	};
}

function createPayload(
	options: {
		readonly renderGeometry?: "empty" | "single-triangle";
	} = {},
): EnvCellSystemStaticScopePayload {
	const envCell = createEnvCell({
		renderGeometry: options.renderGeometry ?? "single-triangle",
	});

	return {
		acceptedEnvCellIds: [TEST_ENV_CELL_ID],
		envCells: [envCell],
		kind: "env-cell-system",
		landblock: {
			kind: "landblock-source",
			landblockId: TEST_LANDBLOCK_ID,
			source: "env-cells",
		},
		materialSources: [createMaterialSource()],
		missingRefs: [],
		paletteSources: [],
		portalApertureResources: [],
		portalConnectivityGraph: {
			edges: [],
			nodes: [],
		},
		portalLinks: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		residencySpatial: {
			envCellSystemBvh: {
				items: [],
				nodes: [],
			},
			envCellSystemBvhItemCount: 0,
			envCellSystemBvhNodeCount: 0,
		},
		sourceAssets: [],
		textureRefs: [],
		visibilityDiagnostics: [],
	};
}

function createEnvCell(options: {
	readonly renderGeometry: "empty" | "single-triangle";
}): LandblockEnvCellStaticFacts {
	const hasGeometry = options.renderGeometry === "single-triangle";
	return {
		cellBsp: {
			kind: "leaf",
			polyIds: [],
			solid: 0,
			sphere: null,
		},
		cellStructure: {
			cellStructureId: TEST_CELL_STRUCTURE_ID,
			kind: "cell-structure",
		},
		environment: {
			environmentId: TEST_ENVIRONMENT_ID,
			kind: "environment",
		},
		identity: {
			envCellId: TEST_ENV_CELL_ID,
			kind: "env-cell-source",
		},
		landblockId: TEST_LANDBLOCK_ID,
		localPlacement: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: 1, y: 2, z: 3 },
		},
		memberId: "cell-0",
		portalApertures: [],
		portals: [],
		renderGeometry: {
			bounds: {
				max: { x: 1, y: 1, z: 0 },
				min: { x: 0, y: 0, z: 0 },
			},
			invalidPolygons: [],
			normals: hasGeometry ? new Float32Array(9) : new Float32Array(),
			positions: hasGeometry
				? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
				: new Float32Array(),
			skippedPolygonCount: 0,
			sourceId: TEST_ENV_CELL_ID,
			surfaceIds: hasGeometry ? [0] : [],
			triangleCount: hasGeometry ? 1 : 0,
			triangles: hasGeometry
				? [
						{
							firstVertex: 0,
							materialVariantSignature: null,
							polygonId: 1,
							surfaceId: 0,
						},
					]
				: [],
			uvs: hasGeometry
				? new Float32Array([0, 0, 1, 0, 0, 1])
				: new Float32Array(),
			vertexCount: hasGeometry ? 3 : 0,
		},
		restrictionObjectId: null,
		seenOutside: null,
		staticObjectPlacements: [],
		surfaces: [
			{
				material: {
					kind: "static-material-source",
					materialId: TEST_MATERIAL_ID,
				},
				slotId: 0,
				surfaceId: TEST_MATERIAL_ID,
			},
		],
		visibleEnvCellIds: [],
	};
}

function createMaterialSource(): StaticObjectMaterialSourceFacts {
	return {
		diffuse: 0,
		identity: {
			kind: "static-material-source",
			materialId: TEST_MATERIAL_ID,
		},
		luminosity: 0,
		source: {
			argb: 0xff336699,
			kind: "solid-color",
		},
		surfaceId: TEST_MATERIAL_ID,
		surfaceType: 0,
		translucency: 0,
	};
}

function createGeometryAttachment(
	envCell: LandblockEnvCellStaticFacts,
): EnvCellCellStructureGeometryAttachment {
	const triangles: readonly ObjectVisualGeometryTriangle[] = [
		{
			firstVertex: 0,
			materialVariantSignature: null,
			polygonId: 1,
			surfaceId: 0,
		},
	];
	return {
		buffer: {
			bounds: envCell.renderGeometry.bounds,
			bufferId: objectVisualGeometryBufferId(0),
			coordinateSpace: "source-local",
			normals: new Float32Array(9),
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
			triangleCount: triangles.length,
			triangles,
			vertexCount: 3,
		},
		identity: createEnvCellCellStructureGeometryIdentity({ envCell }),
		invalidPolygons: [],
		skippedPolygonCount: 0,
		sourceId: envCell.renderGeometry.sourceId,
		surfaceIds: [0],
	};
}
