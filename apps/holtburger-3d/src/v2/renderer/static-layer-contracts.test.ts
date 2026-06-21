import { describe, expect, it } from "vitest";
import {
	DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY,
	createStaticLandblockLayerGenerationId,
	createStaticLandblockLayerKey,
	staticLayerKindForStaticDomain,
	type EnvCellSystemLayerPayload,
	type StaticLandblockLayerPayload,
	type TerrainLayerPayload,
} from "./types";

describe("static landblock layer contracts", () => {
	it("maps existing static domains to atomic layer kinds", () => {
		expect(staticLayerKindForStaticDomain("outdoor-terrain")).toBe("terrain");
		expect(staticLayerKindForStaticDomain("outdoor-buildings")).toBe(
			"outdoor-buildings",
		);
		expect(staticLayerKindForStaticDomain("outdoor-detail")).toBe(
			"outdoor-detail",
		);
		expect(staticLayerKindForStaticDomain("landblock-env-cells")).toBe(
			"env-cell-system",
		);
	});

	it("creates stable ownership and generation identities", () => {
		expect(
			createStaticLandblockLayerKey({
				kind: "env-cell-system",
				landblockId: 0x0007ffff,
			}),
		).toBe("env-cell-system:0x0007ffff");
		expect(
			createStaticLandblockLayerGenerationId({
				kind: "env-cell-system",
				landblockId: 0x0007ffff,
				sourceKey: "projection:root=0x00070100",
			}),
		).toBe("env-cell-system:0x0007ffff:projection:root=0x00070100");
	});

	it("keeps renderer visibility separate from layer residency", () => {
		const visibility = {
			...DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY,
			outdoorDetail: false,
		};

		expect(DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY).toEqual({
			envCellInteriors: true,
			outdoorBuildings: true,
			outdoorDetail: true,
			terrain: true,
		});
		expect(visibility).toEqual({
			envCellInteriors: true,
			outdoorBuildings: true,
			outdoorDetail: false,
			terrain: true,
		});
		expect(visibility).not.toHaveProperty("domains");
		expect(visibility).not.toHaveProperty("lod");
	});

	it("models terrain as a whole layer without public resource deltas", () => {
		const layer: TerrainLayerPayload = {
			drawUnits: [],
			generationId: createStaticLandblockLayerGenerationId({
				kind: "terrain",
				landblockId: 0xda55ffff,
				sourceKey: 12,
			}),
			kind: "terrain",
			landblockId: 0xda55ffff,
			materialCoverage: [],
			sourceMappingRecords: [],
			spatialRecords: [],
			textureUses: [],
		};

		expectLayerHasNoPublicDeltaLists(layer);
	});

	it("models env-cell systems as projection/aperture layers without portal-stack contracts", () => {
		const layer: EnvCellSystemLayerPayload = {
			authoredDynamicSeedRecords: [],
			envCellStaticObjectDrawUnits: [],
			generationId: createStaticLandblockLayerGenerationId({
				kind: "env-cell-system",
				landblockId: 0x0007ffff,
				sourceKey: "coherent-cut:42",
			}),
			kind: "env-cell-system",
			landblockId: 0x0007ffff,
			materialCoverage: [],
			portalApertureResources: [],
			portalGraphRecords: [],
			portalInteriorRecords: [],
			portalProjectionRecords: [],
			resourceMembership: [
				{
					envCellId: 0x00070100,
					envCellStaticObjectDrawUnitIds: ["static:chair"],
					structuredInteriorDrawUnitIds: ["interior:room"],
				},
			],
			sourceMappingRecords: [],
			spatialRecords: [],
			structuredInteriorDrawUnits: [],
			textureUses: [],
			visibilityRecords: [],
		};

		expect(layer.portalProjectionRecords).toEqual([]);
		expect(layer.portalApertureResources).toEqual([]);
		expect(layer.resourceMembership).toEqual([
			{
				envCellId: 0x00070100,
				envCellStaticObjectDrawUnitIds: ["static:chair"],
				structuredInteriorDrawUnitIds: ["interior:room"],
			},
		]);
		expectLayerHasNoPublicDeltaLists(layer);
		expect(layer).not.toHaveProperty("portalTraversalPlan");
		expect(layer).not.toHaveProperty("portalFrameGraph");
		expect(layer).not.toHaveProperty("transitionApertureBatches");
	});
});

function expectLayerHasNoPublicDeltaLists(
	layer: StaticLandblockLayerPayload,
): void {
	expect(layer).not.toHaveProperty("addedDrawUnits");
	expect(layer).not.toHaveProperty("removedDrawUnitIds");
	expect(layer).not.toHaveProperty("addedPortalApertureResources");
	expect(layer).not.toHaveProperty("removedPortalApertureResourceIds");
	expect(layer).not.toHaveProperty("addedTransitionApertureBatches");
	expect(layer).not.toHaveProperty("removedTransitionApertureBatchIds");
}
