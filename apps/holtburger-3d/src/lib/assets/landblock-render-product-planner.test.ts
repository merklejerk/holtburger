import { describe, expect, it } from "vitest";

import {
	parseBrowserLocationInput,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import { createSceneResourceInterestFromBrowserDestination } from "../../app/browser-scene-resource-interest";
import {
	createLandblockRenderProductWorkerJob,
	type DesiredLandblockRenderProduct,
	type LandblockRenderProductWorkerResult,
} from "../world-display/landblock-render-product";
import { planDesiredLandblockRenderProducts } from "./landblock-render-product-planner";

describe("landblock render product planner", () => {
	it("plans split outdoor products by independent LoD domain", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			sceneInterest: createProductSceneInterest(destination),
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

		expect(products).toHaveLength(16);
		expect(products.slice(0, 4)).toEqual([
			{
				landblockId: 0xda55ffff,
				product: "outdoor-terrain",
				priority: "resident-now",
				requestId: "request:1",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			},
			{
				landblockId: 0xda55ffff,
				product: "outdoor-buildings",
				priority: "resident-now",
				requestId: "request:1",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			},
			{
				landblockId: 0xda55ffff,
				product: "outdoor-detail",
				priority: "resident-now",
				requestId: "request:1",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			},
			{
				landblockId: 0xda55ffff,
				product: "outdoor-env-cells",
				priority: "resident-now",
				requestId: "request:1",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			},
		]);
		expect(
			products.filter((product) => product.product === "outdoor-env-cells"),
		).toHaveLength(1);
		expect(
			products.filter((product) => product.product === "outdoor-terrain"),
		).toHaveLength(5);
		expect(
			products.filter((product) => product.product === "outdoor-buildings"),
		).toHaveLength(5);
		expect(
			products.filter((product) => product.product === "outdoor-detail"),
		).toHaveLength(5);
		expect(new Set(products.map((product) => product.landblockId)).size).toBe(5);
	});

	it("keeps default outdoor coverage split by terrain, static, and env-cell radii", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			sceneInterest: createProductSceneInterest(destination),
			requestId: "request:default",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		});

		expect(
			products.filter((product) => product.product === "outdoor-terrain"),
		).toHaveLength(13);
		expect(
			products.filter((product) => product.product === "outdoor-buildings"),
		).toHaveLength(5);
		expect(
			products.filter((product) => product.product === "outdoor-detail"),
		).toHaveLength(5);
		expect(
			products.filter((product) => product.product === "outdoor-env-cells"),
		).toHaveLength(5);
	});

	it("does not require topology, env-cell roots, or source revisions to schedule topology products", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			sceneInterest: createProductSceneInterest(destination),
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
				product: "outdoor-terrain",
				priority: "resident-now",
				requestId: "request:detail",
				buildPolicyRevision: "build:v2",
				texturePagePolicyRevision: "texture-pages:v2",
				buildPolicy: createBuildPolicy(),
			},
			{
				landblockId: 0xda55ffff,
				product: "outdoor-buildings",
				priority: "resident-now",
				requestId: "request:detail",
				buildPolicyRevision: "build:v2",
				texturePagePolicyRevision: "texture-pages:v2",
				buildPolicy: createBuildPolicy(),
			},
			{
				landblockId: 0xda55ffff,
				product: "outdoor-detail",
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
			product: "outdoor-terrain",
			priority: "resident-now",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		};

		const job = createLandblockRenderProductWorkerJob(desired);

		expect(job).toEqual({
			type: "build-landblock-render-product",
			jobId:
				"landblock-render-product:3663069183:outdoor-terrain:build:v1:texture-pages:v1:artifacts:all",
			landblockId: 0xda55ffff,
			product: "outdoor-terrain",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
			artifactFilter: null,
		});
		expect(Object.keys(job)).not.toContain("rootAssetIds");
		expect(Object.keys(job)).not.toContain("sourceRevision");
	});

	it("defines product worker results as product artifact collections", () => {
		const result = {
			type: "landblock-render-product-built",
			jobId: "job:outdoor",
			landblockId: 0xda55ffff,
			product: "outdoor-terrain",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			artifacts: [],
			diagnostics: {
				status: "partial",
				messages: ["terrain artifact pending"],
			},
		} satisfies LandblockRenderProductWorkerResult;

		expect(result.artifacts).toEqual([]);
		expect(Object.keys(result)).not.toContain("rootAssetIds");
		expect(Object.keys(result)).not.toContain("sourceRevision");
		expect(Object.keys(result)).not.toContain("terrainArtifact");
		expect(Object.keys(result)).not.toContain("staticBundleLayers");
	});

	it("keeps focus-landblock outdoor domains split instead of inventing a summary product", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const products = planDesiredLandblockRenderProducts({
			sceneInterest: createProductSceneInterest(destination),
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

		expect(products.map((product) => product.product)).toEqual([
			"outdoor-terrain",
			"outdoor-buildings",
			"outdoor-detail",
		]);
	});

	it("plans dungeon env-cell products while focused indoors", () => {
		const destination = parseBrowserLocationInput(
			"da550155",
			"manual",
			"dungeon",
		);
		expect(destination).not.toBeNull();

		expect(
			planDesiredLandblockRenderProducts({
				sceneInterest: createProductSceneInterest(destination),
				requestId: "request:indoor",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			}),
		).toEqual([
			{
				landblockId: 0xda55ffff,
				product: "dungeon-env-cells",
				priority: "resident-now",
				requestId: "request:indoor",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "texture-pages:v1",
				buildPolicy: createBuildPolicy(),
			},
		]);
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

function createProductSceneInterest(destination: BrowserLocationSelection) {
	return createSceneResourceInterestFromBrowserDestination({
		destination,
		terrainLodRadius: 2,
		buildingLodRadius: 1,
		detailLodRadius: 1,
		envCellLodRadius: 1,
	});
}
