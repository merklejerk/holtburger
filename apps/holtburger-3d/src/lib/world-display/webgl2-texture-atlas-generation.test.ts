import { describe, expect, it } from "vitest";

import type { AtlasBackedCompactionPlan } from "./atlas-backed-compaction-planner";
import { createWebgl2TextureAtlasGenerationResource } from "./webgl2-texture-atlas-generation";

describe("webgl2 texture atlas generation", () => {
	it("packs atlas entries with gutter extrusion and uploads mipmapped rgba8 textures", () => {
		const gl = new FakeWebgl2();
		const generation = createWebgl2TextureAtlasGenerationResource({
			gl: gl.asContext(),
			plan: createPlan(),
		});

		expect(generation?.key).toBe("atlas-backed-compaction/test");
		expect(generation?.textures).toHaveLength(1);
		expect(gl.textureUploads).toHaveLength(1);
		expect(gl.textureUploads[0]).toMatchObject({
			width: 4,
			height: 4,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
		});
		expect(gl.generatedMipmapCount).toBe(1);
		expect(gl.textureParameters).toEqual([
			{ pname: gl.TEXTURE_WRAP_S, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_WRAP_T, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_MIN_FILTER, param: gl.LINEAR_MIPMAP_LINEAR },
			{ pname: gl.TEXTURE_MAG_FILTER, param: gl.LINEAR },
		]);
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

		generation?.dispose();
		expect(gl.deletedTextures).toHaveLength(1);
	});

	it("returns no generation for an empty compaction plan", () => {
		const gl = new FakeWebgl2();

		expect(
			createWebgl2TextureAtlasGenerationResource({
				gl: gl.asContext(),
				plan: {
					...createPlan(),
					compactableDrawUnitIds: [],
				},
			}),
		).toBeNull();
		expect(gl.textureUploads).toHaveLength(0);
	});
});

function createPlan(): AtlasBackedCompactionPlan {
	const levelBytes = Uint8Array.from([
		1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
	]);
	return {
		key: "atlas-backed-compaction/test",
		compactableDrawUnitIds: ["draw-a"],
		bypasses: [],
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
		atlasEntries: [],
		atlasTextures: [
			{
				textureIndex: 0,
				width: 4,
				height: 4,
				placements: [
					{
						atlasEntryKey: "entry-a",
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
		materialSlots: [],
		drawSlices: [],
		staticObjectKeys: ["object-a"],
		staticPartCount: 1,
		triangleCount: 2,
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
	readonly TEXTURE_WRAP_S = 8;
	readonly TEXTURE_WRAP_T = 9;
	readonly TEXTURE_MIN_FILTER = 10;
	readonly TEXTURE_MAG_FILTER = 11;
	readonly createdTextures: object[] = [];
	readonly deletedTextures: object[] = [];
	readonly textureUploads: {
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
		_level: number,
		internalFormat: GLenum,
		width: GLenum,
		height: GLenum,
		_border: GLenum,
		format: GLenum,
		type: GLenum,
		data: TexImageSource | ArrayBufferView | null,
	): void {
		this.textureUploads.push({
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
