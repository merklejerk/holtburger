import { describe, expect, it } from "vitest";

import {
	planIndexedResourceAtlas,
	type IndexedResourceAtlasPlan,
} from "./texture-pages/indexed-resource-atlas-planner";
import {
	createIndexedResourceAtlasCpuGeneration,
	createWebgl2IndexedResourceAtlasGenerationResource,
} from "./webgl2/resources/indexed-resource-atlas-generation";

describe("webgl2 indexed resource atlas generation", () => {
	it("packs indexed and palette atlas bytes without creating WebGL textures", () => {
		const plan = createIndexedPlan();
		const generation = createIndexedResourceAtlasCpuGeneration(plan);

		expect(generation?.key).toBe(`${plan.key};indexed-webgl2`);
		expect(generation?.indexTextures).toHaveLength(2);
		expect(generation?.paletteTextures).toHaveLength(1);
		expect([
			...(generation?.indexTextures[0]?.pixels.slice(0, 4) ?? []),
		]).toEqual([1, 2, 0, 0]);
		expect([
			...(generation?.indexTextures[1]?.pixels.slice(0, 4) ?? []),
		]).toEqual([5, 6, 7, 8]);
		expect([...(generation?.paletteTextures[0]?.pixels ?? [])]).toEqual([
			9, 10, 11, 12, 13, 14, 15, 16,
		]);
	});

	it("uploads P8, Index16, and palette atlas pages as exact data textures", () => {
		const gl = new FakeWebgl2();
		const plan = createIndexedPlan();
		const generation = createWebgl2IndexedResourceAtlasGenerationResource({
			gl: gl.asContext(),
			plan,
		});

		expect(generation?.indexTextures).toHaveLength(2);
		expect(generation?.paletteTextures).toHaveLength(1);
		expect(gl.textureUploads).toMatchObject([
			{
				width: 8,
				height: 8,
				internalFormat: gl.R8,
				format: gl.RED,
				type: gl.UNSIGNED_BYTE,
			},
			{
				width: 8,
				height: 8,
				internalFormat: gl.RG8,
				format: gl.RG,
				type: gl.UNSIGNED_BYTE,
			},
			{
				width: 2,
				height: 1,
				internalFormat: gl.RGBA8,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
			},
		]);
		expect(gl.textureUploads[0]?.data).toBeInstanceOf(Uint8Array);
		expect([...(gl.textureUploads[0]?.data as Uint8Array).slice(0, 4)]).toEqual(
			[1, 2, 0, 0],
		);
		expect([...(gl.textureUploads[1]?.data as Uint8Array).slice(0, 4)]).toEqual(
			[5, 6, 7, 8],
		);
		expect([...(gl.textureUploads[2]?.data as Uint8Array)]).toEqual([
			9, 10, 11, 12, 13, 14, 15, 16,
		]);
		expect(gl.generatedMipmapCount).toBe(0);
		expect(gl.textureParameters).toEqual([
			{ pname: gl.TEXTURE_WRAP_S, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_WRAP_T, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_MIN_FILTER, param: gl.NEAREST },
			{ pname: gl.TEXTURE_MAG_FILTER, param: gl.NEAREST },
			{ pname: gl.TEXTURE_WRAP_S, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_WRAP_T, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_MIN_FILTER, param: gl.NEAREST },
			{ pname: gl.TEXTURE_MAG_FILTER, param: gl.NEAREST },
			{ pname: gl.TEXTURE_WRAP_S, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_WRAP_T, param: gl.CLAMP_TO_EDGE },
			{ pname: gl.TEXTURE_MIN_FILTER, param: gl.NEAREST },
			{ pname: gl.TEXTURE_MAG_FILTER, param: gl.NEAREST },
		]);

		generation?.dispose();
		expect(gl.deletedTextures).toHaveLength(3);
	});

	it("returns no generation for an empty indexed atlas plan", () => {
		const gl = new FakeWebgl2();
		const plan = planIndexedResourceAtlas({
			indexCandidates: [],
			paletteCandidates: [],
			policy: { maxTextureSize: 8, maxTextureCount: 4 },
		});

		expect(
			createWebgl2IndexedResourceAtlasGenerationResource({
				gl: gl.asContext(),
				plan,
			}),
		).toBeNull();
		expect(gl.textureUploads).toHaveLength(0);
	});
});

function createIndexedPlan(): IndexedResourceAtlasPlan {
	return planIndexedResourceAtlas({
		indexCandidates: [
			{
				drawUnitId: "p8-draw",
				indexTextureKey: "index/p8",
				format: "p8",
				width: 2,
				height: 2,
				sourceBytes: Uint8Array.from([1, 2, 3, 4]),
			},
			{
				drawUnitId: "p16-draw",
				indexTextureKey: "index/p16",
				format: "index16",
				width: 2,
				height: 1,
				sourceBytes: Uint8Array.from([5, 6, 7, 8]),
			},
		],
		paletteCandidates: [
			{
				drawUnitId: "palette-draw",
				paletteTextureKey: "palette/a",
				colorCount: 2,
				rgbaBytes: Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16]),
			},
		],
		policy: { maxTextureSize: 8, maxTextureCount: 4 },
	});
}

class FakeWebgl2 {
	readonly TEXTURE_2D = 1;
	readonly RGBA = 2;
	readonly RGBA8 = 3;
	readonly UNSIGNED_BYTE = 4;
	readonly CLAMP_TO_EDGE = 5;
	readonly RED = 6;
	readonly R8 = 7;
	readonly RG = 8;
	readonly RG8 = 9;
	readonly NEAREST = 10;
	readonly TEXTURE_WRAP_S = 11;
	readonly TEXTURE_WRAP_T = 12;
	readonly TEXTURE_MIN_FILTER = 13;
	readonly TEXTURE_MAG_FILTER = 14;
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

	deleteTexture(texture: WebGLTexture): void {
		this.deletedTextures.push(texture);
	}
}
