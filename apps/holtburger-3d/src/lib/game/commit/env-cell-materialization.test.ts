import { describe, expect, it } from "vitest";
import { residentKey } from "../resolution/landblock-layer";
import type { EnvCellId, LandblockId } from "../game-types";
import { transformPoint3 } from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type {
	ResolvedEnvCellLayerSource,
	ResolvedEnvCellPresentation,
} from "../resolution/landblock-layer";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectPresentation,
} from "../resolution/presentation";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { EnvCellGeometryPreparer } from "../runtime/env-cell-realization";
import { prepareStaticObjectGeometry } from "./static-object-geometry-worker";
import { assembleStaticObjectArtifact } from "./static-object-artifact";
import { planEnvCellMaterialization } from "./env-cell-materialization";

const LANDBLOCK_ID = "0x0001ffff" as LandblockId;
const SHARED_GEOMETRY = geometry();
const SHARED_MATERIAL = material();
const STATIC_PRESENTATION = presentation(null);

describe("planEnvCellMaterialization", () => {
	it("moves structures independently while preserving authored landblock resident placements", () => {
		const structure = cell("0x00010100", cellTransform(10), [
			resident("shared", "0x00010100", STATIC_PRESENTATION),
		]);
		const overlapping = cell("0x00010101", cellTransform(20), [
			resident("shared", "0x00010101", STATIC_PRESENTATION),
		]);
		const plan = planEnvCellMaterialization(layer([structure, overlapping]));

		expect(plan.shellGeometries).toHaveLength(1);
		expect(plan.shells).toHaveLength(2);
		expect(plan.residentJobs).toHaveLength(2);
		expect(
			plan.residentJobs.map((job) => ({
				cell: job.source.envCellId,
				residents: job.source.staticResidents.map((entry) =>
					residentKey(entry.identity),
				),
			})),
		).toEqual([
			{ cell: "0x00010100", residents: ["shared"] },
			{ cell: "0x00010101", residents: ["shared"] },
		]);

		const firstPlacement =
			plan.residentJobs[0]!.source.staticResidents[0]!.placement;
		const secondPlacement =
			plan.residentJobs[1]!.source.staticResidents[0]!.placement;
		expect(firstPlacement.envCellId).toBe("0x00010100");
		expect(secondPlacement.envCellId).toBe("0x00010101");
		expect(
			transformPoint3(firstPlacement.localTransform, Vec3.zero(), Vec3.zero()),
		).toEqual(new Vec3(2, 0, 0));
		expect(
			transformPoint3(secondPlacement.localTransform, Vec3.zero(), Vec3.zero()),
		).toEqual(new Vec3(2, 0, 0));
		expect(
			transformPoint3(
				plan.shells[0]!.placement.localTransform,
				Vec3.zero(),
				Vec3.zero(),
			),
		).toEqual(new Vec3(10, 0, 0));
		expect(
			transformPoint3(
				plan.shells[1]!.placement.localTransform,
				Vec3.zero(),
				Vec3.zero(),
			),
		).toEqual(new Vec3(20, 0, 0));

		const outputs = plan.residentJobs.map((job, index) =>
			prepareStaticObjectGeometry({
				layer: LandblockLayerKind.EnvCells,
				resourceNamespace:
					`static-install:${index}` as import("../systems/static-resources").StaticInstallResourceNamespace,
				source: job.source,
			}),
		);
		expect(
			outputs.every((output) => output?.metrics.sourceResidentCount === 1),
		).toBe(true);
		expect(outputs[0]?.geometry[0]?.key).toBe(outputs[1]?.geometry[0]?.key);
	});

	it("keeps default-animated authored residents on the explicit deferral branch", () => {
		const animated = presentation("0x03000001");
		const plan = planEnvCellMaterialization(
			layer([
				cell("0x00010100", Mat4.identity(), [
					resident("static", "0x00010100", STATIC_PRESENTATION),
					resident("animated", "0x00010100", animated),
				]),
			]),
		);

		expect(
			plan.residentJobs[0]?.source.staticResidents.map(({ identity }) =>
				residentKey(identity),
			),
		).toEqual(["static"]);
		expect(
			plan.deferredResidents.map(({ identity }) => residentKey(identity)),
		).toEqual(["animated"]);
		expect(plan.diagnostics).toMatchObject({
			defaultAnimatedResidentCount: 1,
			expectedResidentCount: 2,
			plannedStaticResidentCount: 1,
			unsupportedResidentCount: 0,
		});
	});

	it("realizes scoped resident streams over one shared immutable geometry source", async () => {
		const plan = planEnvCellMaterialization(
			layer([
				cell("0x00010100", cellTransform(10), [
					resident("first", "0x00010100", STATIC_PRESENTATION),
				]),
				cell("0x00010101", cellTransform(20), [
					resident("second", "0x00010101", STATIC_PRESENTATION),
				]),
			]),
		);
		const preparer = new EnvCellGeometryPreparer({
			prepare: async (options) => {
				const resourceNamespace =
					`static-install:test/${options.partition}` as import("../systems/static-resources").StaticInstallResourceNamespace;
				return assembleStaticObjectArtifact({
					geometry: prepareStaticObjectGeometry({
						layer: options.layer,
						resourceNamespace,
						source: options.source,
					}),
					resourceNamespace,
					source: options.source,
					textureRequirements: options.textureRequirements,
				});
			},
		});

		const realized = await preparer.prepare({
			layer: LandblockLayerKind.EnvCells,
			owner: "landblock-layer:0x0001ffff/env-cells",
			revision:
				1 as import("../runtime/scene-availability").SceneInterestRevision,
			source: plan,
			textureRequirements: [],
		});

		expect(realized.residents?.geometry).toHaveLength(1);
		expect(realized.residents?.instanceStreams).toHaveLength(2);
		expect(realized.residents?.objects).toHaveLength(2);
		expect(
			realized.residents?.objects.map(({ placement }) => placement.envCellId),
		).toEqual(["0x00010100", "0x00010101"]);
	});

	it("fails the closed shell plan when a required material is missing", () => {
		const sourceCell = cell("0x00010100", Mat4.identity(), []);

		expect(() =>
			planEnvCellMaterialization(layer([{ ...sourceCell, materials: [] }])),
		).toThrow(/material count does not match/);
	});

	it("omits retail no-texture surfaces from EnvCell shell draw ranges", () => {
		const sourceCell = cell("0x00010100", Mat4.identity(), []);
		const shellGeometry = twoTriangleGeometry();
		const plan = planEnvCellMaterialization(
			layer([
				{
					...sourceCell,
					structure: {
						...sourceCell.structure,
						geometry: shellGeometry,
						surfaceSlotCount: 2,
					},
					materials: [solidColorMaterial(), SHARED_MATERIAL],
				},
			]),
		);

		expect(plan.shellGeometries[0]?.geometry.indices).toBe(
			shellGeometry.indices,
		);
		expect(plan.shells[0]?.materialRanges).toMatchObject([
			{
				indexStart: 3,
				indexCount: 3,
				material: { source: { id: SHARED_MATERIAL.id } },
			},
		]);
		expect(plan.diagnostics).toMatchObject({
			shellMaterialRangeCount: 1,
			uniqueShellMaterialCount: 1,
		});
	});

	it("rejects a resident placement that claims another EnvCell", () => {
		const sourceCell = cell("0x00010100", Mat4.identity(), [
			resident("misowned", "0x00010101", STATIC_PRESENTATION),
		]);

		expect(() => planEnvCellMaterialization(layer([sourceCell]))).toThrow(
			/placement with another residency/,
		);
	});
});

function layer(
	cells: readonly ResolvedEnvCellPresentation[],
): ResolvedEnvCellLayerSource {
	return {
		kind: LandblockLayerKind.EnvCells,
		landblockId: LANDBLOCK_ID,
		cells,
		portalApertures: [],
		portalCrossings: [],
		diagnostics: {
			unresolvedOutsideEndpoints: [],
			unresolvedVisibilityReciprocals: [],
			visibilityApertureCounts: {
				authoredSourceCrossings: 0,
				reciprocalIntersectionCrossings: 0,
				synthesizedIntersectionGeometries: 0,
			},
		},
	};
}

function cell(
	id: EnvCellId,
	transform: Mat4,
	residents: ResolvedEnvCellPresentation["residents"],
): ResolvedEnvCellPresentation {
	return {
		id,
		flags: 0,
		authoredCellId: 0x100,
		structure: {
			id: "shared-structure",
			geometry: SHARED_GEOMETRY,
			surfaceSlotCount: 1,
			containmentPlanes: new Float32Array([1, 0, 0, 0]),
			portalPolygons: [],
		},
		structureToLandblock: {
			landblockId: LANDBLOCK_ID,
			envCellId: id,
			localTransform: transform,
		},
		landblockBounds: bounds(),
		materials: [SHARED_MATERIAL],
		residents,
		potentiallyVisibleEnvCellIds: new Set(),
	};
}

function resident(
	id: string,
	envCellId: EnvCellId,
	source: ResolvedObjectPresentation,
): ResolvedEnvCellPresentation["residents"][number] {
	return {
		id,
		sourceDid: "0x02000001",
		presentation: source,
		placement: {
			landblockId: LANDBLOCK_ID,
			envCellId,
			localTransform: translation(2, 0, 0),
		},
		scale: new Vec3(1, 1, 1),
		localBounds: bounds(),
		appearance: null,
	};
}

function presentation(animationId: string | null): ResolvedObjectPresentation {
	return {
		id: "presentation:test",
		sourceAssetId: "0x02000001",
		parts: [
			{
				partIndex: 0,
				geometry: SHARED_GEOMETRY,
				defaultScale: new Vec3(1, 1, 1),
				materials: [SHARED_MATERIAL],
			},
		],
		holdingLocations: new Map(),
		placementPoses: new Map([
			[0, { placementId: 0, partTransforms: [Mat4.identity()] }],
		]),
		motion: null,
		effects: {
			animationId,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		selectionBounds: null,
		sortingBounds: null,
	};
}

function geometry(): ResolvedGeometry {
	return {
		id: "geometry:shared",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1]),
		indices: new Uint32Array([0, 1, 2]),
		materialSlotIndices: new Uint16Array([0]),
		materialWrapModes: new Uint8Array([0]),
		materialSideKinds: new Uint8Array([0]),
		materialSideTypes: new Uint8Array([1]),
		materialStippling: new Uint8Array([0]),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		bounds: bounds(),
	};
}

function twoTriangleGeometry(): ResolvedGeometry {
	return {
		...geometry(),
		id: "geometry:two-triangles",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		textureCoordinates: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		materialSlotIndices: new Uint16Array([0, 1]),
		materialWrapModes: new Uint8Array([0, 0]),
		materialSideKinds: new Uint8Array([0, 0]),
		materialSideTypes: new Uint8Array([1, 1]),
		materialStippling: new Uint8Array([0, 0]),
	};
}

function material(): ResolvedMaterial {
	return {
		id: "material:test",
		kind: "texture",
		colorTextureId: "0x06000001",
		renderSurfaceId: "0x06000001",
		paletteTextureId: null,
		textureEncoding: "direct-color",
		rawSurfaceFlags: 0x20002,
		translucency: 0,
		luminosity: 0,
		diffuseScale: 1,
	};
}

function solidColorMaterial(): ResolvedMaterial {
	return {
		id: "material:portal-sentinel",
		kind: "solid-color",
		color: [1, 0, 0, 1],
		rawSurfaceFlags: 0x01,
		translucency: 0,
		luminosity: 0,
		diffuseScale: 1,
	};
}

function bounds(): AABB3 {
	return new AABB3(new Vec3(0, 0, 0), new Vec3(1, 1, 1));
}

function cellTransform(x: number): Mat4 {
	return new Mat4(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, x, 0, 0, 1);
}

function translation(x: number, y: number, z: number): Mat4 {
	return new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1);
}
