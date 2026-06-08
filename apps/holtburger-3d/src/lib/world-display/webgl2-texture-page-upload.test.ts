import { describe, expect, it } from "vitest";

import type { TexturePageAtlasPlan } from "./texture-pages/texture-page-atlas-planner";
import {
	createTexturePageCpuSet,
	createWebgl2TexturePageTextureResourceFromCpu,
} from "./webgl2/resources/texture-page-upload";
import type { TextureFilteringMode } from "./texture-pages/texture-sampling-policy";

describe("webgl2 texture page upload", () => {
	it("packs rgba and detail atlas bytes without creating WebGL textures", () => {
		const pageSet = createTexturePageCpuSet({
			plan: createPlan(),
		});

		expect(pageSet?.key).toBe(
			"texture-page-atlas/test;filter=anisotropic-4x;aniso=1",
		);
		expect(pageSet?.textures).toHaveLength(1);
		expect(pageSet?.detailTextures).toHaveLength(1);
		expect(pageSet?.textures[0]?.key).toBe(
			"texture-page-atlas/test/static-rgba/texture/0",
		);
		expect([...(pageSet?.textures[0]?.pixels.slice(0, 16) ?? [])]).toEqual([
			1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255,
		]);
		expect(pageSet?.detailTextures[0]?.key).toBe(
			"texture-page-atlas/test/static-rgba/detail-texture/0",
		);
		expect([
			...(pageSet?.detailTextures[0]?.pixels.slice(0, 16) ?? []),
		]).toEqual([
			11, 12, 13, 14, 11, 12, 13, 14, 15, 16, 17, 18, 15, 16, 17, 18,
		]);
	});

	it("packs atlas entries with gutter extrusion and uploads mipmapped rgba8 textures", () => {
		const gl = new FakeWebgl2();
		const pageSet = createTexturePageCpuSet({
			plan: createPlan(),
		});
		expect(pageSet).not.toBeNull();
		const resources = uploadTexturePageCpuSet({
			gl: gl.asContext(),
			pageSet: pageSet!,
		});

		expect(pageSet?.key).toBe(
			"texture-page-atlas/test;filter=anisotropic-4x;aniso=1",
		);
		expect(resources.textures).toHaveLength(1);
		expect(resources.detailTextures).toHaveLength(1);
		expect(resources.textures[0]).toMatchObject({
			usageBucket: "static-rgba",
			sampleClass: "rgba-color",
			pageKind: "packed-atlas",
			indexedFormat: null,
			mipmapsGenerated: true,
			entries: [
				{
					virtualRefKey: "entry-a",
					sourceAssetId: "prepared-texture/entry-a",
					rect: [1, 1, 2, 2],
				},
			],
		});
		expect(pageSet?.placements).toEqual([
			{
				family: "static-rgba",
				atlasEntryKey: "entry-a",
				textureIndex: 0,
				rect: [1, 1, 2, 2],
				width: 4,
				height: 4,
			},
		]);
		expect(pageSet?.textures[0]?.entries).toEqual([
			{
				virtualRefKey: "entry-a",
				sourceAssetId: "prepared-texture/entry-a",
				rect: [1, 1, 2, 2],
			},
		]);
		expect(pageSet?.detailPlacements).toEqual([
			{
				family: "static-rgba",
				atlasEntryKey: "detail-a",
				textureIndex: 0,
				rect: [1, 1, 2, 2],
				width: 4,
				height: 4,
			},
		]);
		expect(pageSet?.detailTextures[0]?.entries).toEqual([
			{
				virtualRefKey: "detail-a",
				sourceAssetId: "detail-a",
				rect: [1, 1, 2, 2],
			},
		]);
		expect(gl.textureUploads).toHaveLength(2);
		expect(gl.textureUploads[0]).toMatchObject({
			level: 0,
			width: 4,
			height: 4,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
		});
		expect(gl.textureUploads[1]).toMatchObject({
			level: 0,
			width: 4,
			height: 4,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
		});
		expect(gl.generatedMipmapCount).toBe(2);
		expect(gl.textureParameters.slice(0, 4)).toEqual([
			{ pname: gl.TEXTURE_WRAP_S, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_WRAP_T, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_MIN_FILTER, param: gl.LINEAR_MIPMAP_LINEAR },
			{ pname: gl.TEXTURE_MAG_FILTER, param: gl.LINEAR },
		]);
		expect(gl.textureParameters.slice(4)).toEqual(
			gl.textureParameters.slice(0, 4),
		);
		const pixels = gl.textureUploads[0]?.data;
		expect(pixels).toBeInstanceOf(Uint8Array);
		expect([
			...((pixels as Uint8Array) ?? new Uint8Array()).slice(0, 64),
		]).toEqual([
			1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255, 1, 2, 3, 255, 1,
			2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255, 7, 8, 9, 255, 7, 8, 9, 255, 10, 11,
			12, 255, 10, 11, 12, 255, 7, 8, 9, 255, 7, 8, 9, 255, 10, 11, 12, 255, 10,
			11, 12, 255,
		]);

		disposeTexturePageResources(resources);
		expect(gl.deletedTextures).toHaveLength(2);
	});

	it("returns no page set for an empty compaction plan", () => {
		const gl = new FakeWebgl2();
		const plan = createPlan();

		expect(
			createTexturePageCpuSet({
				plan: {
					...plan,
					rgbaAtlasReadyCandidateIds: [],
					atlasEntryRecords: [],
					atlasTextures: [],
					detailAtlasEntryRecords: [],
					detailAtlasTextures: [],
					families: [],
				},
			}),
		).toBeNull();
		expect(gl.textureUploads).toHaveLength(0);
	});

	it("recreates atlas resources for nearest filtering without mipmaps", () => {
		const gl = new FakeWebgl2();
		const pageSet = createTexturePageCpuSet({
			plan: createPlan(),
			textureFilteringMode: "nearest",
			maxAnisotropy: 8,
		});
		expect(pageSet).not.toBeNull();
		const resources = uploadTexturePageCpuSet({
			gl: gl.asContext(),
			pageSet: pageSet!,
			textureFilteringMode: "nearest",
			maxAnisotropy: 8,
		});

		expect(pageSet?.key).toBe(
			"texture-page-atlas/test;filter=nearest;aniso=1",
		);
		expect(gl.generatedMipmapCount).toBe(0);
		expect(gl.textureParameters.slice(0, 4)).toEqual([
			{ pname: gl.TEXTURE_WRAP_S, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_WRAP_T, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_MIN_FILTER, param: gl.NEAREST },
			{ pname: gl.TEXTURE_MAG_FILTER, param: gl.NEAREST },
		]);

		disposeTexturePageResources(resources);
	});

	it("extrudes terrain color atlas gutters with repeat semantics", () => {
		const gl = new FakeWebgl2();
		const pageSet = createTexturePageCpuSet({
			plan: createPlan({ family: "terrain-color" }),
		});
		expect(pageSet).not.toBeNull();
		const resources = uploadTexturePageCpuSet({
			gl: gl.asContext(),
			pageSet: pageSet!,
		});

		const pixels = gl.textureUploads[0]?.data;
		expect(pixels).toBeInstanceOf(Uint8Array);
		expect([
			...((pixels as Uint8Array) ?? new Uint8Array()).slice(0, 16),
		]).toEqual([10, 11, 12, 255, 7, 8, 9, 255, 10, 11, 12, 255, 7, 8, 9, 255]);

		disposeTexturePageResources(resources);
	});

	it("extrudes terrain detail atlas gutters with repeat semantics", () => {
		const gl = new FakeWebgl2();
		const pageSet = createTexturePageCpuSet({
			plan: createPlan({ family: "terrain-detail" }),
		});
		expect(pageSet).not.toBeNull();
		const resources = uploadTexturePageCpuSet({
			gl: gl.asContext(),
			pageSet: pageSet!,
		});

		const pixels = gl.textureUploads[1]?.data;
		expect(pixels).toBeInstanceOf(Uint8Array);
		expect([
			...((pixels as Uint8Array) ?? new Uint8Array()).slice(0, 16),
		]).toEqual([
			23, 24, 25, 26, 19, 20, 21, 22, 23, 24, 25, 26, 19, 20, 21, 22,
		]);

		disposeTexturePageResources(resources);
	});

	it("fills unused terrain color atlas pixels with neutral gray", () => {
		const gl = new FakeWebgl2();
		const pageSet = createTexturePageCpuSet({
			plan: createPlan({
				family: "terrain-color",
				atlasTexture: {
					width: 8,
					height: 8,
					placement: {
						x: 3,
						y: 3,
						width: 2,
						height: 2,
						gutterPixels: 1,
					},
				},
			}),
		});
		expect(pageSet).not.toBeNull();
		const resources = uploadTexturePageCpuSet({
			gl: gl.asContext(),
			pageSet: pageSet!,
		});

		const pixels = gl.textureUploads[0]?.data;
		expect(pixels).toBeInstanceOf(Uint8Array);
		expect([
			...((pixels as Uint8Array) ?? new Uint8Array()).slice(0, 4),
		]).toEqual([128, 128, 128, 255]);

		disposeTexturePageResources(resources);
	});
});

function uploadTexturePageCpuSet({
	gl,
	pageSet,
	textureFilteringMode = "anisotropic-4x",
	maxAnisotropy = 1,
}: {
	gl: WebGL2RenderingContext;
	pageSet: NonNullable<ReturnType<typeof createTexturePageCpuSet>>;
	textureFilteringMode?: TextureFilteringMode;
	maxAnisotropy?: number;
}) {
	return {
		textures: pageSet.textures.map((cpuTexture) =>
			createWebgl2TexturePageTextureResourceFromCpu({
				gl,
				cpuTexture,
				textureFilteringMode,
				maxAnisotropy,
			}),
		),
		detailTextures: pageSet.detailTextures.map((cpuTexture) =>
			createWebgl2TexturePageTextureResourceFromCpu({
				gl,
				cpuTexture,
				textureFilteringMode,
				maxAnisotropy,
			}),
		),
	};
}

function disposeTexturePageResources({
	textures,
	detailTextures,
}: ReturnType<typeof uploadTexturePageCpuSet>): void {
	for (const texture of textures) {
		texture.texture.dispose();
	}
	for (const texture of detailTextures) {
		texture.texture.dispose();
	}
}

function createPlan({
	family = "static-rgba",
	atlasTexture = {
		width: 4,
		height: 4,
		placement: {
			x: 1,
			y: 1,
			width: 2,
			height: 2,
			gutterPixels: 1,
		},
	},
}: {
	family?: TexturePageAtlasPlan["families"][number]["family"];
	atlasTexture?: {
		width: number;
		height: number;
		placement: {
			x: number;
			y: number;
			width: number;
			height: number;
			gutterPixels: number;
		};
	};
} = {}): TexturePageAtlasPlan {
	const levelBytes = Uint8Array.from([
		1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
	]);
	return {
		key: "texture-page-atlas/test",
		rgbaAtlasReadyCandidateIds: ["draw-a"],
		detailAtlasReadyCandidateIds: [],
		failures: [],
		atlasEntryRecords: [
			{
				key: "entry-a",
				entry: {
					renderSurfaceId: 0x0600_0001,
					preparedTextureAssetId: "prepared-texture/entry-a",
					sourceHash: "hash-a",
					sourceFormatRaw: 0x3154_5844,
					level: {
						level: 0,
						width: 2,
						height: 2,
						formatRaw: 0x15,
						format: "A8R8G8B8",
						byteLength: levelBytes.byteLength,
						bytes: levelBytes,
					},
				},
			},
		],
		atlasTextures: [
			{
				textureIndex: 0,
				width: atlasTexture.width,
				height: atlasTexture.height,
				placements: [
					{
						atlasEntryKey: "entry-a",
						textureIndex: 0,
						...atlasTexture.placement,
					},
				],
			},
		],
		detailAtlasEntryRecords: [
			{
				key: "detail-a",
				renderSurfaceId: 0x0600_0002,
				sourceFormatRaw: 0x15,
				width: 2,
				height: 2,
				bytes: Uint8Array.from([
					11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
				]),
				format: "rgba8",
				tiling: 12,
				blendMode: "dst-color",
			},
		],
		detailAtlasTextures: [
			{
				textureIndex: 0,
				width: 4,
				height: 4,
				placements: [
					{
						atlasEntryKey: "detail-a",
						textureIndex: 0,
						x: 1,
						y: 1,
						width: 2,
						height: 2,
						gutterPixels: 1,
					},
				],
			},
		],
		families: [
			{
				family,
				atlasEntryRecords: [
					{
						key: "entry-a",
						entry: {
							renderSurfaceId: 0x0600_0001,
							preparedTextureAssetId: "prepared-texture/entry-a",
							sourceHash: "hash-a",
							sourceFormatRaw: 0x3154_5844,
							level: {
								level: 0,
								width: 2,
								height: 2,
								formatRaw: 0x15,
								format: "A8R8G8B8",
								byteLength: levelBytes.byteLength,
								bytes: levelBytes,
							},
						},
					},
				],
				atlasTextures: [
					{
						textureIndex: 0,
						width: atlasTexture.width,
						height: atlasTexture.height,
						placements: [
							{
								atlasEntryKey: "entry-a",
								textureIndex: 0,
								...atlasTexture.placement,
							},
						],
					},
				],
				detailAtlasEntryRecords: [
					{
						key: "detail-a",
						renderSurfaceId: 0x0600_0002,
						sourceFormatRaw: 0x15,
						width: 2,
						height: 2,
						bytes: Uint8Array.from([
							11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
						]),
						format: "rgba8",
						tiling: 12,
						blendMode: "dst-color",
					},
				],
				detailAtlasTextures: [
					{
						textureIndex: 0,
						width: 4,
						height: 4,
						placements: [
							{
								atlasEntryKey: "detail-a",
								textureIndex: 0,
								x: 1,
								y: 1,
								width: 2,
								height: 2,
								gutterPixels: 1,
							},
						],
					},
				],
			},
		],
		preparedTextureAssetIds: ["prepared-texture/entry-a"],
	};
}

class FakeWebgl2 {
	readonly TEXTURE_2D = 1;
	readonly RGBA = 2;
	readonly RGBA8 = 3;
	readonly UNSIGNED_BYTE = 4;
	readonly CLAMP_TO_EDGE = 5;
	readonly LINEAR = 6;
	readonly LINEAR_MIPMAP_LINEAR = 7;
	readonly NEAREST = 14;
	readonly RED = 12;
	readonly R8 = 13;
	readonly TEXTURE_WRAP_S = 8;
	readonly TEXTURE_WRAP_T = 9;
	readonly TEXTURE_MIN_FILTER = 10;
	readonly TEXTURE_MAG_FILTER = 11;
	readonly createdTextures: object[] = [];
	readonly deletedTextures: object[] = [];
	readonly textureUploads: {
		level: number;
		width: number;
		height: number;
		internalFormat: GLenum;
		format: GLenum;
		type: GLenum;
		data: TexImageSource | ArrayBufferView | null;
	}[] = [];
	readonly textureParameters: { pname: GLenum; param: GLenum }[] = [];
	generatedMipmapCount = 0;

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	createTexture(): WebGLTexture {
		const texture = {};
		this.createdTextures.push(texture);
		return texture as WebGLTexture;
	}

	bindTexture(): void {
		return;
	}

	texImage2D(
		_target: GLenum,
		level: number,
		internalFormat: GLenum,
		width: GLenum,
		height: GLenum,
		_border: GLenum,
		format: GLenum,
		type: GLenum,
		data: TexImageSource | ArrayBufferView | null,
	): void {
		this.textureUploads.push({
			level,
			width,
			height,
			internalFormat,
			format,
			type,
			data,
		});
	}

	texParameteri(_target: GLenum, pname: GLenum, param: GLenum): void {
		this.textureParameters.push({ pname, param });
	}

	generateMipmap(): void {
		this.generatedMipmapCount += 1;
	}

	getExtension(): null {
		return null;
	}

	deleteTexture(texture: WebGLTexture): void {
		this.deletedTextures.push(texture);
	}
}
