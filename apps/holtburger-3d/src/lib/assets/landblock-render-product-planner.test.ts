import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import {
	createLandblockRenderProductWorkerJob,
	type DesiredLandblockRenderProduct,
	type LandblockRenderProductWorkerResult,
} from "../world-display/landblock-render-product";
import { planDesiredLandblockRenderProducts } from "./landblock-render-product-planner";

describe("landblock render product planner", () => {
	it("plans additive outdoor and env-cell products by route boundary", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			browserDestination: destination,
			requestId: "request:1",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
			options: {
				terrainRadius: 1,
				buildingRadius: 1,
				detailRadius: 1,
				envCellRadius: 0,
			},
		});

		expect(products).toHaveLength(10);
		expect(products[0]).toEqual({
			landblockId: 0xda55ffff,
			product: "outdoor",
			priority: "resident-now",
			requestId: "request:1",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		});
		expect(products[1]).toEqual({
			landblockId: 0xda55ffff,
			product: "outdoor-env-cells",
			priority: "resident-now",
			requestId: "request:1",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		});
		expect(
			products.filter((product) => product.product === "outdoor-env-cells"),
		).toHaveLength(1);
		expect(
			products.filter((product) => product.product === "outdoor"),
		).toHaveLength(9);
		expect(new Set(products.map((product) => product.landblockId)).size).toBe(
			9,
		);
	});

	it("does not require topology, env-cell roots, or source revisions to schedule topology products", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			browserDestination: destination,
			requestId: "request:detail",
			buildPolicyRevision: "build:v2",
			texturePagePolicyRevision: "texture-pages:v2",
			buildPolicy: createBuildPolicy(),
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(products).toEqual([
			{
				landblockId: 0xda55ffff,
				product: "outdoor",
				priority: "resident-now",
				requestId: "request:detail",
				buildPolicyRevision: "build:v2",
				texturePagePolicyRevision: "texture-pages:v2",
				buildPolicy: createBuildPolicy(),
			},
			{
				landblockId: 0xda55ffff,
				product: "outdoor-env-cells",
				priority: "resident-now",
				requestId: "request:detail",
				buildPolicyRevision: "build:v2",
				texturePagePolicyRevision: "texture-pages:v2",
				buildPolicy: createBuildPolicy(),
			},
		]);
		for (const product of products) {
			expect(Object.keys(product)).not.toContain("rootAssetIds");
			expect(Object.keys(product)).not.toContain("sourceRevision");
		}
	});

	it("creates worker jobs from product identity without legacy layer scheduling fields", () => {
		const desired: DesiredLandblockRenderProduct = {
			landblockId: 0xda55ffff,
			product: "outdoor",
			priority: "resident-now",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		};

		const job = createLandblockRenderProductWorkerJob(desired);

		expect(job).toEqual({
			type: "build-landblock-render-product",
			jobId: "landblock-render-product:3663069183:outdoor:request:outdoor",
			landblockId: 0xda55ffff,
			product: "outdoor",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		});
		expect(Object.keys(job)).not.toContain("rootAssetIds");
		expect(Object.keys(job)).not.toContain("sourceRevision");
	});

	it("defines product worker results as sibling terrain and static object artifacts", () => {
		const result = {
			type: "landblock-render-product-built",
			jobId: "job:outdoor",
			landblockId: 0xda55ffff,
			product: "outdoor",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			terrainArtifact: null,
			staticBundleLayers: [],
			diagnostics: {
				status: "partial",
				messages: ["terrain artifact pending"],
			},
		} satisfies LandblockRenderProductWorkerResult;

		expect(result.terrainArtifact).toBeNull();
		expect(result.staticBundleLayers).toEqual([]);
		expect(Object.keys(result)).not.toContain("rootAssetIds");
		expect(Object.keys(result)).not.toContain("sourceRevision");
	});

	it("does not invent a summary product for distant terrain-only interest", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			browserDestination: destination,
			requestId: "request:terrain",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
			options: {
				terrainRadius: 0,
				buildingRadius: -1,
				detailRadius: -1,
				envCellRadius: -1,
			},
		});

		expect(products.map((product) => product.product)).toEqual(["outdoor"]);
	});

	it("does not plan outdoor landblock products while focused indoors", () => {
		const destination = parseBrowserLocationInput(
			"da550155",
			"manual",
			"indoor",
		);
		expect(destination).not.toBeNull();

		expect(
			planDesiredLandblockRenderProducts({
				browserDestination: destination,
				requestId: "request:indoor",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			}),
		).toEqual([]);
	});
});

function createBuildPolicy() {
	return {
		atlasLayout: {
			maxTextureSize: 64,
			maxTextureCount: 4,
			gutterPixels: 0,
		},
		terrainMaxLayerEntries: 8,
	};
}
