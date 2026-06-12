import { describe, expect, it } from "vitest";
import type {
	OutdoorStaticObjectsScopePayload,
	StaticObjectMaterialSourceFacts,
	StaticObjectTextureRefFacts,
} from "../../contracts";
import {
	classifyStaticObjectMaterial,
	planStaticObjectMaterials,
} from "./static-object-material-planner";

describe("V2 static object material planner", () => {
	it("classifies solid-color materials without texture roles", () => {
		const plan = classifyStaticObjectMaterial({
			material: createMaterial({
				source: {
					argb: 0xff336699,
					kind: "solid-color",
				},
			}),
			paletteSources: [],
			textureRefs: [],
		});

		expect(plan).toMatchObject({
			alphaPolicy: {
				alphaTest: 0,
				mode: "opaque",
				opacity: 1,
			},
			family: "flat-color",
			pass: "opaque",
			renderCoverage: "classified-render-candidate",
			textureRoles: [],
		});
		expect(plan.color).toEqual([
			0x33 / 255,
			0x66 / 255,
			0x99 / 255,
			1,
		]);
		expect(plan.emissiveColor).toEqual([0, 0, 0]);
	});

	it("maps diffuse and luminosity flags into material color constants", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial({
				diffuse: 0.5,
				luminosity: 0.75,
				surfaceType: 0x20 | 0x40,
			}),
			paletteSources: [],
			textureRefs: createTextureRefs({ formatRaw: 1, paletteId: null }),
		});

		expect(plan.color).toEqual([0.5, 0.5, 0.5, 1]);
		expect(plan.emissiveColor).toEqual([0.75, 0.75, 0.75]);
	});

	it("plans non-indexed texture materials as filterable rgba base-color roles", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial(),
			paletteSources: [],
			textureRefs: createTextureRefs({ formatRaw: 1, paletteId: null }),
		});

		expect(plan).toMatchObject({
			alphaPolicy: {
				mode: "opaque",
			},
			family: "texture-rgba",
			pass: "opaque",
			renderCoverage: "classified-render-candidate",
			textureRoles: [
				{
					dataUse: {
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000010,
						},
						usage: "rgba-color",
					},
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "base-color",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000010,
					},
				},
			],
		});
	});

	it("plans indexed P8 materials as index and palette data uses", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial({
				paletteId: 0x04000020,
			}),
			paletteSources: createPaletteSources({ paletteId: 0x04000020 }),
			textureRefs: createTextureRefs({ formatRaw: 0x29, paletteId: 0x04000010 }),
		});

		expect(plan).toMatchObject({
			family: "indexed-paletted",
			pass: "opaque",
			renderCoverage: "classified-render-candidate",
			textureRoles: [
				{
					dataUse: {
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000010,
						},
						usage: "index8",
					},
					height: 32,
					indexedFormat: "p8",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "base-index",
					width: 64,
				},
				{
					dataUse: {
						firstIndex: 0,
						indexCount: 256,
						kind: "palette-texture-use",
						palette: {
							kind: "palette",
							paletteId: 0x04000020,
						},
						usage: "palette-rgba",
					},
					palette: {
						kind: "palette",
						paletteId: 0x04000020,
					},
					role: "palette-rgba",
				},
			],
		});
	});

	it("uses authored palette views as derived palette replacement ranges", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial({
				paletteId: 0x04000020,
			}),
			paletteSources: createPaletteSources({
				paletteId: 0x04000020,
				colorCount: 258,
			}),
			paletteViews: [
				{
					firstIndex: 16,
					indexCount: 32,
					palette: {
						kind: "palette",
						paletteId: 0x04000030,
					},
				},
			],
			textureRefs: createTextureRefs({ formatRaw: 0x29, paletteId: 0x04000010 }),
		});

		expect(plan.materialUseKey).toContain("04000030:16-32");
		expect(plan.textureRoles).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					dataUse: {
						firstIndex: 0,
						indexCount: 258,
						kind: "palette-texture-use",
						palette: {
							kind: "palette",
							paletteId: 0x04000020,
						},
						subPalettes: [
							{
								firstIndex: 16,
								indexCount: 32,
								palette: {
									kind: "palette",
									paletteId: 0x04000030,
								},
							},
						],
						usage: "palette-rgba",
					},
					role: "palette-rgba",
				}),
			]),
		);
	});

	it("plans indexed Index16 materials as index16 data uses", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial(),
			paletteSources: createPaletteSources({ paletteId: 0x04000010 }),
			textureRefs: createTextureRefs({ formatRaw: 0x65, paletteId: 0x04000010 }),
		});

		expect(plan).toMatchObject({
			family: "indexed-paletted",
			renderCoverage: "classified-render-candidate",
			textureRoles: [
				{
					dataUse: {
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000010,
						},
						usage: "index16",
					},
					indexedFormat: "index16",
					role: "base-index",
				},
				{
					dataUse: {
						kind: "palette-texture-use",
						palette: {
							kind: "palette",
							paletteId: 0x04000010,
						},
						usage: "palette-rgba",
					},
					role: "palette-rgba",
				},
			],
		});
	});

	it("rejects indexed materials when texel indices exceed palette width", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial(),
			paletteSources: createPaletteSources({
				colorCount: 256,
				paletteId: 0x04000010,
			}),
			textureRefs: createTextureRefs({
				formatRaw: 0x65,
				indexedMaxIndex: 257,
				paletteId: 0x04000010,
			}),
		});

		expect(plan).toMatchObject({
			family: "unsupported",
			renderCoverage: "unsupported",
			textureRoles: [],
		});
		expect(plan.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "palette-index-out-of-range",
			}),
		]);
	});

	it("rejects indexed materials without a material or render-surface palette", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial(),
			paletteSources: [],
			textureRefs: createTextureRefs({ formatRaw: 0x29, paletteId: null }),
		});

		expect(plan).toMatchObject({
			family: "unsupported",
			renderCoverage: "unsupported",
			textureRoles: [],
		});
		expect(plan.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "missing-palette",
			}),
		]);
	});

	it("marks translucent texture materials render-deferred without losing roles", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial({
				surfaceType: 0x100,
			}),
			paletteSources: [],
			textureRefs: createTextureRefs({ formatRaw: 1, paletteId: null }),
		});

		expect(plan).toMatchObject({
			family: "texture-rgba",
			pass: "transparent",
			renderCoverage: "classified-render-deferred",
			textureRoles: [
				expect.objectContaining({
					role: "base-color",
				}),
			],
		});
		expect(plan.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "translucent-render-deferred",
			}),
		]);
	});

	it("reports unsupported detail surface flags explicitly", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial({
				surfaceType: 0x20000,
			}),
			paletteSources: [],
			textureRefs: createTextureRefs({ formatRaw: 1, paletteId: null }),
		});

		expect(plan).toMatchObject({
			family: "unsupported",
			renderCoverage: "unsupported",
		});
		expect(plan.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "unsupported-surface-flag",
			}),
		]);
	});

	it("keeps unresolved building detail roles diagnostic", () => {
		const plan = planStaticObjectMaterials(createPayload());

		expect(plan.detailRoles).toEqual([
			{
				dataUse: null,
				fadeFar: 256,
				fadeNear: 128,
				fallbackReasons: [
					expect.objectContaining({
						code: "missing-detail-render-surface",
					}),
				],
				renderCoverage: "classified-render-deferred",
				renderSurface: null,
				role: "building",
				texture: {
					kind: "surface-texture",
					surfaceTextureId: 0x05000020,
				},
				tiling: 8,
			},
		]);
		expect(plan.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "missing-detail-render-surface",
			}),
		]);
	});

	it("composes resolved building detail roles onto renderable static materials", () => {
		const payload = {
			...createPayload(),
			textureRefs: [
				...createTextureRefs({ formatRaw: 1, paletteId: null }),
				...createDetailTextureRefs(),
			],
		} satisfies OutdoorStaticObjectsScopePayload;

		const plan = planStaticObjectMaterials(payload);

		expect(plan.detailRoles).toEqual([
			expect.objectContaining({
				dataUse: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000020,
					},
					usage: "rgba-detail",
				},
				fallbackReasons: [],
				renderCoverage: "classified-render-candidate",
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x06000020,
				},
			}),
		]);
		expect(plan.materialPlans[0]?.textureRoles).toEqual([
			expect.objectContaining({
				role: "base-color",
			}),
			expect.objectContaining({
				dataUse: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000020,
					},
					usage: "rgba-detail",
				},
				role: "detail-overlay",
				tiling: 8,
			}),
		]);
		expect(plan.fallbackReasons).toEqual([]);
	});

	it("rejects textured materials whose selected render surface was not resolved", () => {
		const plan = classifyStaticObjectMaterial({
			material: createTexturedMaterial(),
			paletteSources: [],
			textureRefs: [
				{
					palette: null,
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					role: "surface-texture",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000010,
					},
				},
			],
		});

		expect(plan).toMatchObject({
			family: "unsupported",
			renderCoverage: "unsupported",
		});
		expect(plan.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "missing-render-surface",
			}),
		]);
	});
});

function createPayload(): OutdoorStaticObjectsScopePayload {
	const material = createTexturedMaterial();
	return {
		domain: "outdoor-buildings",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		materialSlots: [],
		materialSources: [material],
		missingRefs: [],
		objects: [],
		paletteSources: [],
		regionRenderProfile: {
			detailRoles: [
				{
					fadeFar: 256,
					fadeNear: 128,
					role: "building",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000020,
					},
					tiling: 8,
				},
			],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [],
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			outdoorBvhItemCount: 0,
			outdoorBvhNodeCount: 0,
		},
		textureRefs: createTextureRefs({ formatRaw: 1, paletteId: null }),
	};
}

function createTexturedMaterial(
	overrides: {
		readonly diffuse?: number;
		readonly luminosity?: number;
		readonly surfaceType?: number;
		readonly paletteId?: number | null;
	} = {},
): StaticObjectMaterialSourceFacts {
	return createMaterial({
		diffuse: overrides.diffuse ?? 1,
		luminosity: overrides.luminosity ?? 0,
		source: {
			kind: "texture",
			palette:
				overrides.paletteId === undefined || overrides.paletteId === null
					? null
					: {
							kind: "palette",
							paletteId: overrides.paletteId,
						},
			renderSurfaceDefaultPalettes: [],
			selectedRenderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
		surfaceType: overrides.surfaceType,
	});
}

function createMaterial(
	overrides: Partial<StaticObjectMaterialSourceFacts> = {},
): StaticObjectMaterialSourceFacts {
	return {
		diffuse: 1,
		identity: {
			kind: "static-material-source",
			materialId: 0x08000010,
		},
		luminosity: 0,
		source: {
			argb: 0xffffffff,
			kind: "solid-color",
		},
		surfaceId: 0x08000010,
		surfaceType: 0,
		translucency: 0,
		...overrides,
	};
}

function createTextureRefs(options: {
	readonly formatRaw: number;
	readonly indexedMaxIndex?: number;
	readonly paletteId: number | null;
}): StaticObjectTextureRefFacts[] {
	const palette =
		options.paletteId === null
			? null
			: {
					kind: "palette" as const,
					paletteId: options.paletteId,
				};
	return [
		{
			palette,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
		{
			format:
				options.formatRaw === 0x29
					? "p8"
					: options.formatRaw === 0x65
						? "index16"
						: "rgba",
			formatRaw: options.formatRaw,
			height: 32,
			indexedMaxIndex:
				options.indexedMaxIndex ??
				(options.formatRaw === 0x29 || options.formatRaw === 0x65 ? 42 : null),
			palette,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "render-surface",
			width: 64,
		},
	];
}

function createDetailTextureRefs(): StaticObjectTextureRefFacts[] {
	return [
		{
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000020,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000020,
			},
		},
		{
			format: "rgba",
			formatRaw: 1,
			height: 16,
			indexedMaxIndex: null,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000020,
			},
			role: "render-surface",
			width: 16,
		},
	];
}

function createPaletteSources(options: {
	readonly paletteId: number;
	readonly colorCount?: number;
}) {
	return [
		{
			colorCount: options.colorCount ?? 256,
			palette: {
				kind: "palette" as const,
				paletteId: options.paletteId,
			},
		},
	];
}
