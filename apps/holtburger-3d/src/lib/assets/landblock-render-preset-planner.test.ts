import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import {
	createLandblockRenderPresetWorkerJob,
	type DesiredLandblockRenderPreset,
	type LandblockRenderPresetWorkerResult,
} from "../world-display/landblock-render-preset";
import { planDesiredLandblockRenderPresets } from "./landblock-render-preset-planner";

describe("landblock render preset planner", () => {
	it("collapses outdoor radii to one monotonic preset per landblock", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const presets = planDesiredLandblockRenderPresets({
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

		expect(presets).toHaveLength(9);
		expect(presets[0]).toEqual({
			landblockId: 0xda55ffff,
			preset: "outdoor-with-env-cells",
			priority: "resident-now",
			requestId: "request:1",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		});
		expect(
			presets.filter((preset) => preset.preset === "outdoor-with-env-cells"),
		).toHaveLength(1);
		expect(
			presets.filter((preset) => preset.preset === "outdoor"),
		).toHaveLength(8);
		expect(new Set(presets.map((preset) => preset.landblockId)).size).toBe(9);
	});

	it("does not require topology, env-cell roots, or source revisions to schedule detailed presets", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const presets = planDesiredLandblockRenderPresets({
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

		expect(presets).toEqual([
			{
				landblockId: 0xda55ffff,
				preset: "outdoor-with-env-cells",
				priority: "resident-now",
				requestId: "request:detail",
				buildPolicyRevision: "build:v2",
				texturePagePolicyRevision: "texture-pages:v2",
				buildPolicy: createBuildPolicy(),
			},
		]);
		expect(Object.keys(presets[0] ?? {})).not.toContain("rootAssetIds");
		expect(Object.keys(presets[0] ?? {})).not.toContain("sourceRevision");
	});

	it("creates worker jobs from preset identity without legacy layer scheduling fields", () => {
		const desired: DesiredLandblockRenderPreset = {
			landblockId: 0xda55ffff,
			preset: "outdoor",
			priority: "resident-now",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		};

		const job = createLandblockRenderPresetWorkerJob(desired);

		expect(job).toEqual({
			type: "build-landblock-render-preset",
			jobId: "landblock-render-preset:3663069183:outdoor:request:outdoor",
			landblockId: 0xda55ffff,
			preset: "outdoor",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			buildPolicy: createBuildPolicy(),
		});
		expect(Object.keys(job)).not.toContain("rootAssetIds");
		expect(Object.keys(job)).not.toContain("sourceRevision");
	});

	it("defines preset worker results as sibling terrain and static object artifacts", () => {
		const result = {
			type: "landblock-render-preset-built",
			jobId: "job:outdoor",
			landblockId: 0xda55ffff,
			preset: "outdoor",
			requestId: "request:outdoor",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
			terrainArtifact: null,
			staticBundleLayers: [],
			diagnostics: {
				status: "partial",
				messages: ["terrain artifact pending"],
			},
		} satisfies LandblockRenderPresetWorkerResult;

		expect(result.terrainArtifact).toBeNull();
		expect(result.staticBundleLayers).toEqual([]);
		expect(Object.keys(result)).not.toContain("rootAssetIds");
		expect(Object.keys(result)).not.toContain("sourceRevision");
	});

	it("does not invent a summary preset for distant terrain-only interest", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const presets = planDesiredLandblockRenderPresets({
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

		expect(presets.map((preset) => preset.preset)).toEqual(["outdoor"]);
	});

	it("does not plan outdoor landblock presets while focused indoors", () => {
		const destination = parseBrowserLocationInput(
			"da550155",
			"manual",
			"indoor",
		);
		expect(destination).not.toBeNull();

		expect(
			planDesiredLandblockRenderPresets({
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
