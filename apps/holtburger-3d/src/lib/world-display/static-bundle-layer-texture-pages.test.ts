import { describe, expect, it } from "vitest";

import type { VirtualTexturePageRef } from "./static-bundle-layer";
import {
	buildStaticBundleLayerTexturePages,
	createStaticBundleTexturePageDescriptor,
	describeStaticBundleSourceTexturePagePlacementKey,
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
			pages.find((page) => page.pageKind === "single-entry")?.entries[0]?.role,
		).toBe("detail");
		expect(
			pages.find((page) => page.pageKind === "single-entry")?.entries[0]?.rect,
		).toEqual([0, 0, 8, 8]);
	});

	it("describes color, detail, data, and control virtual refs for material eligibility", () => {
		expect(
			createStaticBundleTexturePageDescriptor(
				createRef("base", "base-color", "rgba-color", 2, 2),
			),
		).toMatchObject({
			role: "base-color",
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

	it("packs same-source material refs once and preserves virtual aliases", () => {
		const sourceAssetId = "prepared-texture/060003a1";
		const pages = buildStaticBundleLayerTexturePages({
			scopeKey: "landblock:da55ffff:outdoor-buildings",
			texturePageRefs: [
				createRef(
					"texture:material:a:prepared-texture/060003a1",
					"base-color",
					"rgba-color",
					2,
					2,
					"color",
					"color-filtered",
					{
						sourceAssetId,
						bytes: new Uint8Array(16).fill(7),
					},
				),
				createRef(
					"texture:material:b:prepared-texture/060003a1",
					"base-color",
					"rgba-color",
					2,
					2,
					"color",
					"color-filtered",
					{
						sourceAssetId,
						bytes: new Uint8Array(16).fill(7),
					},
				),
			],
			policy: {
				maxTextureSize: 8,
				maxTextureCount: 1,
				gutterPixels: 0,
			},
		});

		expect(pages).toHaveLength(1);
		expect(pages[0]?.entries).toHaveLength(1);
		expect(pages[0]?.entries[0]?.virtualRefKeys).toEqual([
			"texture:material:a:prepared-texture/060003a1",
			"texture:material:b:prepared-texture/060003a1",
		]);
		expect(pages[0]?.entries[0]?.sourcePlacementKey).toBe(
			describeStaticBundleSourceTexturePagePlacementKey(
				createRef(
					"canonical",
					"base-color",
					"rgba-color",
					2,
					2,
					"color",
					"color-filtered",
					{
						sourceAssetId,
						bytes: new Uint8Array(16).fill(7),
					},
				),
			),
		);
	});

	it("aliases clamp and repeat refs for the same source placement", () => {
		const sourceAssetId = "prepared-texture/060003a1";
		const pages = buildStaticBundleLayerTexturePages({
			scopeKey: "landblock:da55ffff:outdoor-buildings",
			texturePageRefs: [
				createRef(
					"texture:material:a:variant:sampler=clamp",
					"base-color",
					"rgba-color",
					2,
					2,
					"color",
					"color-filtered",
					{
						sourceAssetId,
						wrapS: "clamp",
						wrapT: "clamp",
					},
				),
				createRef(
					"texture:material:a:variant:sampler=repeat",
					"base-color",
					"rgba-color",
					2,
					2,
					"color",
					"color-filtered",
					{
						sourceAssetId,
						wrapS: "repeat",
						wrapT: "repeat",
					},
				),
			],
			policy: {
				maxTextureSize: 8,
				maxTextureCount: 1,
				gutterPixels: 0,
			},
		});

		expect(pages).toHaveLength(1);
		expect(pages[0]?.entries).toHaveLength(1);
		expect(pages[0]?.entries[0]?.virtualRefKeys).toEqual([
			"texture:material:a:variant:sampler=clamp",
			"texture:material:a:variant:sampler=repeat",
		]);
	});

	it("keeps different lookup and sample domains in separate placements", () => {
		const sourceAssetId = "prepared-texture/060003a1";
		const pages = buildStaticBundleLayerTexturePages({
			scopeKey: "landblock:da55ffff:outdoor-buildings",
			texturePageRefs: [
				createRef(
					"color",
					"base-color",
					"rgba-color",
					1,
					1,
					"color",
					"color-filtered",
					{
						sourceAssetId,
					},
				),
				createRef("data", "base-color", "rgba-color", 1, 1, "data", "exact", {
					sourceAssetId,
				}),
			],
			policy: {
				maxTextureSize: 8,
				maxTextureCount: 1,
				gutterPixels: 0,
			},
		});

		expect(pages).toHaveLength(1);
		expect(pages[0]?.entries).toHaveLength(2);
		expect(pages[0]?.entries.map((entry) => entry.virtualRefKey)).toEqual([
			"color",
			"data",
		]);
	});

	it("aliases indexed refs only when format and payload identity match", () => {
		const sourceAssetId = "prepared-texture/060003a1";
		const pages = buildStaticBundleLayerTexturePages({
			scopeKey: "landblock:da55ffff:outdoor-detail",
			texturePageRefs: [
				createRef(
					"p8-a",
					"indexed-texels",
					"indexed-data",
					2,
					1,
					"data",
					"exact",
					{
						sourceAssetId,
						indexedFormat: "p8",
						bytes: new Uint8Array([1, 2]),
					},
				),
				createRef(
					"p8-b",
					"indexed-texels",
					"indexed-data",
					2,
					1,
					"data",
					"exact",
					{
						sourceAssetId,
						indexedFormat: "p8",
						bytes: new Uint8Array([1, 2]),
					},
				),
				createRef(
					"p8-c",
					"indexed-texels",
					"indexed-data",
					2,
					1,
					"data",
					"exact",
					{
						sourceAssetId,
						indexedFormat: "p8",
						bytes: new Uint8Array([2, 1]),
					},
				),
				createRef(
					"index16",
					"indexed-texels",
					"indexed-data",
					2,
					1,
					"data",
					"exact",
					{
						sourceAssetId,
						indexedFormat: "index16",
						bytes: new Uint8Array([1, 0, 2, 0]),
					},
				),
			],
			policy: {
				maxTextureSize: 8,
				maxTextureCount: 1,
				gutterPixels: 0,
			},
		});

		expect(pages).toHaveLength(2);
		const p8Page = pages.find((page) => page.indexedFormat === "p8");
		expect(p8Page?.entries).toHaveLength(2);
		expect(
			p8Page?.entries.find((entry) => entry.virtualRefKeys.includes("p8-a"))
				?.virtualRefKeys,
		).toEqual(["p8-a", "p8-b"]);
	});
});

function createRef(
	key: string,
	role: VirtualTexturePageRef["role"],
	sampleClass: VirtualTexturePageRef["sampleClass"],
	width: number,
	height: number,
	samplingDomain: VirtualTexturePageRef["samplingDomain"] = "color",
	lookup: VirtualTexturePageRef["lookup"] = "color-filtered",
	options: {
		sourceAssetId?: string;
		wrapS?: VirtualTexturePageRef["wrapS"];
		wrapT?: VirtualTexturePageRef["wrapT"];
		indexedFormat?: VirtualTexturePageRef["indexedFormat"];
		bytes?: Uint8Array;
	} = {},
): VirtualTexturePageRef {
	return {
		key,
		sourceAssetId: options.sourceAssetId ?? `prepared-texture/${key}`,
		role,
		sampleClass,
		indexedFormat: options.indexedFormat,
		width,
		height,
		wrapS: options.wrapS ?? "clamp",
		wrapT: options.wrapT ?? "clamp",
		samplingDomain,
		lookup,
		bytes: options.bytes ?? new Uint8Array(width * height * 4).fill(255),
	};
}
