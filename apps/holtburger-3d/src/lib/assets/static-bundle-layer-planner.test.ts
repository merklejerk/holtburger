import { describe, expect, it } from "vitest";

import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import { parseBrowserLocationInput } from "../../app/browser-mode";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
} from "../landblocks";
import type { PreparedAssetRecord } from "./types";
import { planDesiredStaticBundleLayers } from "./static-bundle-layer-planner";
import { formatStaticObjectBundleScopeKey } from "../world-display/static-bundle-layer";

describe("static bundle layer planner", () => {
	it("plans additive outdoor building and detail layers with separate closures", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const preparedAssets = createTestPreparedAssetResolver([
			createPreparedOutdoorLandblock({
				landblockId: 0xda55ffff,
				regionNumber: 1,
				statics: [
					createOutdoorStaticMember(
						"building-0",
						"building",
						"setup-model/02000010",
					),
					createOutdoorStaticMember(
						"scenery-0",
						"explicit-object",
						"gfx-obj/01000020",
					),
				],
			}),
			createPreparedRegionRenderProfile(1),
			createPreparedSetupModel("setup-model/02000010", ["gfx-obj/01000011"]),
			createPreparedGfxObj("gfx-obj/01000011", ["material/08000011"]),
			createPreparedGfxObj("gfx-obj/01000020", ["material/08000020"]),
			createPreparedMaterialRecipe("material/08000011", [
				"render-surface/06000011",
			]),
			createPreparedMaterialRecipe("material/08000020", [
				"render-surface/06000020",
			]),
			createPreparedRenderSurface("render-surface/06000011"),
			createPreparedRenderSurface("render-surface/06000020"),
		]);

		const layers = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets,
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(
			layers.map((layer) => formatStaticObjectBundleScopeKey(layer.scope)),
		).toEqual([
			"landblock:3663069183:outdoor-buildings",
			"landblock:3663069183:outdoor-detail",
		]);
		expect(layers[0]?.priority).toBe("resident-now");
		expect(layers[0]?.rootAssetIds).toEqual([
			formatLandblockOutdoorAssetId(0xda55ffff),
		]);
		expect(layers[0]?.diagnostics.knownClosureAssetIds).toEqual([
			"gfx-obj/01000011",
			formatLandblockOutdoorAssetId(0xda55ffff),
			"material/08000011",
			formatRegionRenderProfileAssetId(1),
			"render-surface/06000011",
			"setup-appearance/02000010",
			"setup-model/02000010",
		]);
		expect(layers[0]?.diagnostics.knownMissingAssetIds).toEqual([
			"setup-appearance/02000010",
		]);
		expect(layers[1]?.rootAssetIds).toEqual([
			formatLandblockOutdoorAssetId(0xda55ffff),
		]);
		expect(layers[1]?.diagnostics.knownClosureAssetIds).toEqual([
			"gfx-obj/01000020",
			formatLandblockOutdoorAssetId(0xda55ffff),
			"material/08000020",
			formatRegionRenderProfileAssetId(1),
			"render-surface/06000020",
		]);
		expect(layers[1]?.diagnostics.knownMissingAssetIds).toEqual([]);
	});

	it("schedules from roots and reports shallow diagnostics when the outdoor root is not prepared yet", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const layers = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets: createTestPreparedAssetResolver(),
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(layers.map((layer) => layer.rootAssetIds)).toEqual([
			[formatLandblockOutdoorAssetId(0xda55ffff)],
			[formatLandblockOutdoorAssetId(0xda55ffff)],
		]);
		expect(
			layers.map((layer) => layer.diagnostics.knownMissingAssetIds),
		).toEqual([
			[formatLandblockOutdoorAssetId(0xda55ffff)],
			[formatLandblockOutdoorAssetId(0xda55ffff)],
		]);
	});

	it("plans env-cell static layers from topology and cell payload closures", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const preparedAssets = createTestPreparedAssetResolver([
			createPreparedTopology(0xda55ffff, [0xda550155]),
			createPreparedEnvCell(
				0xda550155,
				["gfx-obj/01000030"],
				["material/08000030"],
			),
			createPreparedRegionRenderProfile(2),
			createPreparedGfxObj("gfx-obj/01000030", ["material/08000030"]),
			createPreparedMaterialRecipe("material/08000030", [
				"render-surface/06000030",
			]),
			createPreparedRenderSurface("render-surface/06000030"),
		]);

		const layers = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets,
			options: {
				terrainRadius: 0,
				buildingRadius: -1,
				detailRadius: -1,
				envCellRadius: 0,
			},
		});

		const envCellLayer = layers.find(
			(layer) => layer.scope.kind === "env-cell",
		);

		expect(envCellLayer).toBeDefined();
		expect(formatStaticObjectBundleScopeKey(envCellLayer!.scope)).toBe(
			"env-cell:3663069183:3663003989:env-cell-static",
		);
		expect(envCellLayer?.rootAssetIds).toEqual([
			formatEnvCellAssetId(0xda550155),
			formatLandblockTopologyAssetId(0xda55ffff),
		]);
		expect(envCellLayer?.diagnostics.knownClosureAssetIds).toEqual([
			formatEnvCellAssetId(0xda550155),
			"gfx-obj/01000030",
			formatLandblockTopologyAssetId(0xda55ffff),
			"material/08000030",
			formatRegionRenderProfileAssetId(2),
			"render-surface/06000030",
		]);
		expect(envCellLayer?.diagnostics.knownMissingAssetIds).toEqual([]);
	});

	it("keeps source revisions stable across prepared record insertion order and closure diagnostics", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const assets = [
			createPreparedOutdoorLandblock({
				landblockId: 0xda55ffff,
				regionNumber: 1,
				statics: [
					createOutdoorStaticMember(
						"scenery-0",
						"explicit-object",
						"gfx-obj/01000020",
					),
				],
			}),
			createPreparedRegionRenderProfile(1),
			createPreparedGfxObj("gfx-obj/01000020", ["material/08000020"]),
			createPreparedMaterialRecipe("material/08000020", [
				"render-surface/06000020",
			]),
			createPreparedRenderSurface("render-surface/06000020"),
		];

		const first = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets: createTestPreparedAssetResolver(assets),
			options: {
				terrainRadius: 0,
				buildingRadius: -1,
				detailRadius: 0,
				envCellRadius: -1,
			},
		});
		const second = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets: createTestPreparedAssetResolver([...assets].reverse()),
			options: {
				terrainRadius: 0,
				buildingRadius: -1,
				detailRadius: 0,
				envCellRadius: -1,
			},
		});

		expect(first[0]?.sourceRevision).toBe(second[0]?.sourceRevision);
		expect(first[0]?.rootAssetIds).toEqual(second[0]?.rootAssetIds);
		expect(first[0]?.diagnostics.knownClosureAssetIds).toEqual(
			second[0]?.diagnostics.knownClosureAssetIds,
		);
	});

	it("does not change source revision when only diagnostic closure assets change", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const root = createPreparedOutdoorLandblock({
			landblockId: 0xda55ffff,
			regionNumber: 1,
			statics: [
				createOutdoorStaticMember(
					"scenery-0",
					"explicit-object",
					"gfx-obj/01000020",
				),
			],
		});

		const withoutClosure = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets: createTestPreparedAssetResolver([root]),
			options: {
				terrainRadius: 0,
				buildingRadius: -1,
				detailRadius: 0,
				envCellRadius: -1,
			},
		});
		const withClosure = planDesiredStaticBundleLayers({
			browserDestination: destination,
			preparedAssets: createTestPreparedAssetResolver([
				root,
				createPreparedGfxObj("gfx-obj/01000020", ["material/08000020"]),
				createPreparedMaterialRecipe("material/08000020", [
					"render-surface/06000020",
				]),
			]),
			options: {
				terrainRadius: 0,
				buildingRadius: -1,
				detailRadius: 0,
				envCellRadius: -1,
			},
		});

		const withoutClosureDetail = withoutClosure.find(
			(layer) =>
				layer.scope.kind === "landblock" &&
				layer.scope.bundleKind === "outdoor-detail",
		);
		const withClosureDetail = withClosure.find(
			(layer) =>
				layer.scope.kind === "landblock" &&
				layer.scope.bundleKind === "outdoor-detail",
		);

		expect(withoutClosureDetail?.rootAssetIds).toEqual([
			formatLandblockOutdoorAssetId(0xda55ffff),
		]);
		expect(withoutClosureDetail?.sourceRevision).toBe(
			withClosureDetail?.sourceRevision,
		);
		expect(withoutClosureDetail?.diagnostics.knownClosureAssetIds).not.toEqual(
			withClosureDetail?.diagnostics.knownClosureAssetIds,
		);
		expect(withClosureDetail?.diagnostics.knownClosureAssetIds).toContain(
			"render-surface/06000020",
		);
	});
});

function createPreparedRecord(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	} as PreparedAssetRecord;
}

function createPreparedOutdoorLandblock(options: {
	landblockId: number;
	regionNumber: number;
	statics: PreparedAssetRecord["payload"] extends infer Payload
		? Payload extends { kind: "landblock-outdoor"; statics: infer Statics }
			? Statics
			: never
		: never;
}): PreparedAssetRecord {
	return createPreparedRecord(
		formatLandblockOutdoorAssetId(options.landblockId),
		{
			kind: "landblock-outdoor",
			sourceAssetKind: "landblock-outdoor",
			residencyKind: "outdoor-landblock",
			provenance: createProvenance("landblock-outdoor"),
			landblockId: options.landblockId,
			regionId: 0x13000000,
			regionNumber: options.regionNumber,
			classification: "outdoor",
			terrain: {
				gridSize: 0,
				tileSize: 24,
				vertices: [],
				triangles: [],
				quads: [],
				terrainBvh: {
					coordinateSpace: "landblock-outdoor-terrain-local",
					nodes: [],
					items: [],
				},
				minHeight: 0,
				maxHeight: 0,
				bounds: null,
			},
			statics: options.statics,
			outdoorBvh: null,
			diagnostics: { sourceRecords: [], errors: [], omissions: [] },
		},
	);
}

function createOutdoorStaticMember(
	instanceId: string,
	kind: "explicit-object" | "building" | "generated-scenery",
	sourceAssetId: string,
) {
	return {
		kind,
		instanceId,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: identityPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
		building:
			kind === "building"
				? {
						numLeaves: 0,
						portals: [],
					}
				: null,
		generated: null,
	};
}

function createPreparedTopology(
	landblockId: number,
	envCellIds: readonly number[],
): PreparedAssetRecord {
	return createPreparedRecord(formatLandblockTopologyAssetId(landblockId), {
		kind: "landblock-topology",
		sourceAssetKind: "landblock-topology",
		residencyKind: "landblock",
		provenance: createProvenance("landblock-topology"),
		landblockId,
		landblockInfoId: landblockId & 0xffff_fffe,
		classification: "outdoor",
		envCells: envCellIds.map((envCellId) => ({
			memberId: formatEnvCellAssetId(envCellId),
			envCellId,
			assetId: formatEnvCellAssetId(envCellId),
			localPlacement: identityPlacement(),
			visibleEnvCellIds: [],
			restrictionObjectId: null,
			seenOutside: null,
		})),
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-topology-residency",
			nodes: [],
			items: [],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	});
}

function createPreparedEnvCell(
	envCellId: number,
	sourceAssetIds: readonly string[],
	materialAssetIds: readonly string[],
): PreparedAssetRecord {
	return createPreparedRecord(formatEnvCellAssetId(envCellId), {
		kind: "env-cell",
		sourceAssetKind: "env-cell",
		residencyKind: "interior-cell",
		provenance: createProvenance("env-cell"),
		envCellId,
		regionId: 0x13000000,
		regionNumber: 2,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		localPlacement: identityPlacement(),
		surfaces: materialAssetIds.map((materialAssetId, index) => ({
			slotId: index,
			surfaceId: Number.parseInt(materialAssetId.slice("material/".length), 16),
			materialAssetId,
		})),
		portals: [],
		visibleEnvCellIds: [],
		portalApertures: [],
		statics: sourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `static-${index}`,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			localPlacement: identityPlacement(),
			sourceScale: { x: 1, y: 1, z: 1 },
			sourceBounds: null,
			instanceBounds: null,
		})),
		renderGeometry: emptyRenderGeometry(),
		cellBsp: {
			kind: "leaf",
			index: 0,
			solid: 0,
			sphere: null,
			polyIds: [],
		},
		localBvh: {
			coordinateSpace: "env-cell-local",
			nodes: [],
			items: [],
		},
	});
}

function createPreparedSetupModel(
	assetId: string,
	gfxObjAssetIds: readonly string[],
): PreparedAssetRecord {
	return createPreparedRecord(assetId, {
		kind: "setup-model",
		sourceAssetKind: "setup-model",
		residencyKind: "unknown",
		provenance: createProvenance("setup-model"),
		setupModelId: Number.parseInt(assetId.slice(-8), 16),
		flags: null,
		parts: gfxObjAssetIds.map((gfxObjAssetId, partIndex) => ({
			partIndex,
			gfxObjId: Number.parseInt(gfxObjAssetId.slice(-8), 16),
			gfxObjAssetId,
			parentIndex: null,
			scale: null,
		})),
		holdingLocations: [],
		connectionPoints: [],
		placementSets: [],
		collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
		height: null,
		radius: null,
		stepUp: null,
		stepDown: null,
		sortingSphere: null,
		selectionSphere: null,
		lights: [],
		defaultAnimation: null,
		defaultScript: null,
		defaultMotionTable: null,
		defaultSoundTable: null,
		defaultScriptTable: null,
		dependencies: {
			gfxObjAssetIds: [...gfxObjAssetIds],
		},
	});
}

function createPreparedGfxObj(
	assetId: string,
	materialAssetIds: readonly string[],
): PreparedAssetRecord {
	return createPreparedRecord(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: createProvenance("gfx-obj"),
		gfxObjId: Number.parseInt(assetId.slice(-8), 16),
		flags: null,
		surfaceIds: materialAssetIds.map((materialAssetId) =>
			Number.parseInt(materialAssetId.slice("material/".length), 16),
		),
		vertexArray: {
			vertexType: 0,
			vertexCount: 0,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		dependencies: {
			materialAssetIds: [...materialAssetIds],
		},
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
			rootKind: null,
		},
		renderGeometry: emptyRenderGeometry(),
		sortCenter: null,
		didDegrade: null,
	});
}

function createPreparedMaterialRecipe(
	assetId: string,
	renderSurfaceAssetIds: readonly string[],
): PreparedAssetRecord {
	return createPreparedRecord(assetId, {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: createProvenance("material-recipe"),
		surfaceId: Number.parseInt(assetId.slice("material/".length), 16),
		surfaceType: 2,
		source: { kind: "solid-color", argb: 0xffff_ffff },
		translucency: 1,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [...renderSurfaceAssetIds],
			paletteAssetIds: [],
		},
	});
}

function createPreparedRenderSurface(assetId: string): PreparedAssetRecord {
	return createPreparedRecord(assetId, {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: Number.parseInt(
			assetId.slice("render-surface/".length),
			16,
		),
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: 0,
		format: "rgba8",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([255, 255, 255, 255]),
		defaultPaletteId: null,
		dependencies: {
			paletteAssetIds: [],
		},
	});
}

function createPreparedRegionRenderProfile(
	regionNumber: number,
): PreparedAssetRecord {
	return createPreparedRecord(formatRegionRenderProfileAssetId(regionNumber), {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: createProvenance("region-render-profile"),
		regionId: 0x13000000,
		regionNumber,
		detailRoles: {
			landscape: null,
			building: null,
			environment: null,
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	});
}

function createProvenance(sourceAssetKind: string) {
	return {
		source: "repo-local-hba" as const,
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}

function identityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function emptyRenderGeometry() {
	return {
		sourceId: 0,
		vertexCount: 0,
		triangleCount: 0,
		positions: [],
		normals: [],
		uvs: [],
		triangles: [],
		surfaceIds: [],
		bounds: null,
	};
}
