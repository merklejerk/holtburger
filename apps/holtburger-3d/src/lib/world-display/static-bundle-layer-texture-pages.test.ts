import { describe, expect, it } from "vitest";

import type { VirtualTexturePageRef } from "./static-bundle-layer";
import {
	buildStaticBundleLayerTexturePages,
	createStaticBundleTexturePageDescriptor,
} from "./static-bundle-layer-texture-pages";

describe("static bundle layer texture pages", () => {
	it("packs refs by usage/sample bucket and leaves oversized refs as single-entry pages", () => {
		const pages = buildStaticBundleLayerTexturePages({
			scopeKey: "landblock:da55ffff:outdoor-detail",
			texturePageRefs: [
				createRef("base-a", "base-color", "rgba-color", 1, 1),
				createRef("base-b", "base-color", "rgba-color", 1, 1),
				createRef("detail-a", "detail", "rgba-color", 8, 8),
			],
			policy: {
				maxTextureSize: 4,
				maxTextureCount: 2,
				gutterPixels: 0,
			},
		});

		expect(pages.map((page) => page.pageKind).sort()).toEqual([
			"packed-atlas",
			"single-entry",
		]);
		expect(
			pages.find((page) => page.pageKind === "packed-atlas")?.entries,
		).toHaveLength(2);
		expect(
			pages
				.find((page) => page.pageKind === "packed-atlas")
				?.entries.map((entry) => entry.rect),
		).toEqual([
			[0, 0, 1, 1],
			[1, 0, 1, 1],
		]);
		expect(
			pages.find((page) => page.pageKind === "single-entry")?.usageBucket,
		).toBe("detail");
		expect(
			pages.find((page) => page.pageKind === "single-entry")?.entries[0]
				?.rect,
		).toEqual([0, 0, 8, 8]);
	});

	it("describes color, detail, data, and control virtual refs for material eligibility", () => {
		expect(
			createStaticBundleTexturePageDescriptor(
				createRef("base", "base-color", "rgba-color", 2, 2),
			),
		).toMatchObject({
			usageBucket: "base-color",
			sampleClass: "rgba-color",
			rect: [0, 0, 2, 2],
			source: "standalone-direct-texture",
			sampling: {
				minFilter: "linear",
				magFilter: "linear",
				samplingDomain: "color",
				lookup: "color-filtered",
			},
		});
		expect(
			createStaticBundleTexturePageDescriptor(
				createRef("detail", "detail", "rgba-color", 2, 2),
			).source,
		).toBe("detail-overlay");
		expect(
			createStaticBundleTexturePageDescriptor(
				createRef(
					"indexed",
					"indexed-texels",
					"indexed-data",
					2,
					2,
					"data",
					"exact",
				),
			).sampling,
		).toMatchObject({
			minFilter: "nearest",
			magFilter: "nearest",
			samplingDomain: "data",
			lookup: "exact",
		});
		expect(
			createStaticBundleTexturePageDescriptor(
				createRef(
					"mask",
					"alpha-control",
					"control-data",
					2,
					2,
					"control",
					"control-filtered",
				),
			).sampling,
		).toMatchObject({
			samplingDomain: "control",
			lookup: "control-filtered",
		});
	});
});

function createRef(
	key: string,
	usageBucket: VirtualTexturePageRef["usageBucket"],
	sampleClass: VirtualTexturePageRef["sampleClass"],
	width: number,
	height: number,
	samplingDomain: VirtualTexturePageRef["samplingDomain"] = "color",
	lookup: VirtualTexturePageRef["lookup"] = "color-filtered",
): VirtualTexturePageRef {
	return {
		key,
		sourceAssetId: `prepared-texture/${key}`,
		usageBucket,
		sampleClass,
		width,
		height,
		wrapS: "clamp",
		wrapT: "clamp",
		samplingDomain,
		lookup,
		bytes: new Uint8Array(width * height * 4).fill(255),
	};
}
