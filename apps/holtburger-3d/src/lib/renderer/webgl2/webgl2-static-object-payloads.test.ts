import { describe, expect, it } from "vitest";
import type {
	StaticMaterialTableEntry,
	StaticObjectRenderState,
} from "../../static/contracts";
import type { StaticTextureBinding } from "../types";
import {
	createStaticObjectPreparedDrawPayload,
	createStaticObjectPreparedDrawPayloadState,
	markStaticObjectPreparedDrawPayloadDirty,
	prepareStaticObjectDrawPayload,
	prepareStaticObjectDrawPayloadState,
	type StaticObjectMaterialPayloadResource,
} from "./webgl2-static-object-payloads";

const opaqueRenderState: StaticObjectRenderState = {
	blend: {
		dstFactor: null,
		enabled: false,
		mode: "opaque",
		srcFactor: null,
	},
	depthTest: true,
	depthWrite: true,
};

describe("WebGL2 static object payload builder", () => {
	it("fills material defaults and fallback modes without resident textures", () => {
		const scratch = createStaticObjectPreparedDrawPayload();
		const resource = createStaticResource({
			materialEntries: [
				createMaterialEntry({
					alphaTest: 0.25,
					indexedClipThreshold: 0.5,
					materialColor: [1, 2, 3, 4],
					materialEmissiveColor: [5, 6, 7],
					primaryTextureUseId: "missing-base",
					slot: 1,
				}),
			],
			materialFamily: "texture-rgba",
		});

		prepareStaticObjectDrawPayload(scratch, resource, new Map(), new Map());

		expect(scratch.materialUniforms.materialModes[1]).toBe(2);
		expect(
			Array.from(scratch.materialUniforms.baseColorRects.slice(4, 8)),
		).toEqual([0, 0, 1, 1]);
		expect(scratch.materialUniforms.alphaTests[1]).toBeCloseTo(0.25);
		expect(scratch.materialUniforms.indexedClipThresholds[1]).toBeCloseTo(0.5);
		expect(Array.from(scratch.materialUniforms.colors.slice(4, 8))).toEqual([
			1, 2, 3, 4,
		]);
		expect(
			Array.from(scratch.materialUniforms.emissiveColors.slice(3, 6)),
		).toEqual([5, 6, 7]);
		expect(scratch.rolePages.baseColor.textures).toEqual([
			null,
			null,
			null,
			null,
		]);
		expect(Array.from(scratch.rolePages.baseColor.sizes)).toEqual([
			1, 1, 1, 1, 1, 1, 1, 1,
		]);
	});

	it("prepares resident role pages and indexed material uniforms", () => {
		const scratch = createStaticObjectPreparedDrawPayload();
		const indexTexture = createTexture();
		const paletteTexture = createTexture();
		const detailTexture = createTexture();
		const resource = createStaticResource({
			materialEntries: [
				createMaterialEntry({
					detailTextureTiling: 3,
					detailTextureUseId: "detail-use",
					indexTextureUseId: "index-use",
					indexedTextureFormat: "index16",
					paletteFirstIndex: 24,
					paletteTextureUseId: "palette-use",
					primaryTextureWrapMode: "repeat",
					slot: 2,
				}),
			],
			materialFamily: "indexed-paletted",
		});
		const bindings = new Map<string, StaticTextureBinding>([
			[
				"index-use",
				createBinding({
					height: 64,
					kind: "static-index",
					rect: [10, 11, 12, 13],
					slot: 1,
					textureRefId: "index-ref",
					textureUseId: "index-use",
					width: 32,
				}),
			],
			[
				"palette-use",
				createBinding({
					height: 16,
					kind: "static-palette",
					rect: [20, 21, 22, 23],
					slot: 2,
					textureRefId: "palette-ref",
					textureUseId: "palette-use",
					width: 256,
				}),
			],
			[
				"detail-use",
				createBinding({
					height: 128,
					kind: "static-detail",
					rect: [30, 31, 32, 33],
					slot: 3,
					textureRefId: "detail-ref",
					textureUseId: "detail-use",
					width: 128,
				}),
			],
		]);
		const textures = new Map<string, WebGLTexture>([
			["index-ref", indexTexture],
			["palette-ref", paletteTexture],
			["detail-ref", detailTexture],
		]);

		prepareStaticObjectDrawPayload(scratch, resource, bindings, textures);

		expect(scratch.materialUniforms.materialModes[2]).toBe(3);
		expect(scratch.materialUniforms.indexedTextureFormats[2]).toBe(1);
		expect(scratch.materialUniforms.indexPages[2]).toBe(1);
		expect(
			Array.from(scratch.materialUniforms.indexRects.slice(8, 12)),
		).toEqual([10, 11, 12, 13]);
		expect(scratch.materialUniforms.palettePages[2]).toBe(2);
		expect(
			Array.from(scratch.materialUniforms.paletteRects.slice(8, 12)),
		).toEqual([20, 21, 22, 23]);
		expect(scratch.materialUniforms.paletteFirstIndices[2]).toBe(24);
		expect(scratch.materialUniforms.detailPages[2]).toBe(3);
		expect(
			Array.from(scratch.materialUniforms.detailRects.slice(8, 12)),
		).toEqual([30, 31, 32, 33]);
		expect(scratch.materialUniforms.detailEnabled[2]).toBe(1);
		expect(scratch.materialUniforms.detailTilings[2]).toBe(3);
		expect(scratch.materialUniforms.wrapModes[2]).toBe(1);
		expect(scratch.rolePages.index.textures[1]).toBe(indexTexture);
		expect(Array.from(scratch.rolePages.index.sizes.slice(2, 4))).toEqual([
			32, 64,
		]);
		expect(scratch.rolePages.palette.textures[2]).toBe(paletteTexture);
		expect(Array.from(scratch.rolePages.palette.sizes.slice(4, 6))).toEqual([
			256, 16,
		]);
		expect(scratch.rolePages.detail.textures[3]).toBe(detailTexture);
		expect(Array.from(scratch.rolePages.detail.sizes.slice(6, 8))).toEqual([
			128, 128,
		]);
	});

	it("resets stale scratch values between preparations", () => {
		const scratch = createStaticObjectPreparedDrawPayload();
		const texture = createTexture();
		const residentResource = createStaticResource({
			materialEntries: [
				createMaterialEntry({
					primaryTextureUseId: "base-use",
					slot: 0,
				}),
			],
			materialFamily: "texture-rgba",
		});
		const fallbackResource = createStaticResource({
			materialEntries: [createMaterialEntry({ slot: 0 })],
			materialFamily: "texture-rgba",
		});

		prepareStaticObjectDrawPayload(
			scratch,
			residentResource,
			new Map([
				[
					"base-use",
					createBinding({
						height: 8,
						kind: "static-base-color",
						rect: [4, 5, 6, 7],
						slot: 0,
						textureRefId: "base-ref",
						textureUseId: "base-use",
						width: 8,
					}),
				],
			]),
			new Map([["base-ref", texture]]),
		);
		prepareStaticObjectDrawPayload(
			scratch,
			fallbackResource,
			new Map(),
			new Map(),
		);

		expect(scratch.materialUniforms.materialModes[0]).toBe(2);
		expect(
			Array.from(scratch.materialUniforms.baseColorRects.slice(0, 4)),
		).toEqual([0, 0, 1, 1]);
		expect(scratch.rolePages.baseColor.textures[0]).toBeNull();
		expect(Array.from(scratch.rolePages.baseColor.sizes.slice(0, 2))).toEqual([
			1, 1,
		]);
		expect(scratch.materialUniforms.indexedClipThresholds[0]).toBe(-1);
	});

	it("throws when a static resource has no material table entries", () => {
		const scratch = createStaticObjectPreparedDrawPayload();
		const resource = createStaticResource({
			materialEntries: [],
			materialFamily: "flat-color",
		});

		expect(() =>
			prepareStaticObjectDrawPayload(scratch, resource, new Map(), new Map()),
		).toThrow(
			"Static object resource test-draw-unit has no material table entries.",
		);
	});

	it("rebuilds resource-owned payload state only when marked dirty", () => {
		const state = createStaticObjectPreparedDrawPayloadState();
		const texture = createTexture();
		const resource = createStaticResource({
			materialEntries: [
				createMaterialEntry({
					primaryTextureUseId: "base-use",
					slot: 0,
				}),
			],
			materialFamily: "texture-rgba",
		});
		const bindings = new Map<string, StaticTextureBinding>([
			[
				"base-use",
				createBinding({
					height: 8,
					kind: "static-base-color",
					rect: [1, 2, 3, 4],
					slot: 0,
					textureRefId: "base-ref",
					textureUseId: "base-use",
					width: 8,
				}),
			],
		]);
		const textures = new Map<string, WebGLTexture>([["base-ref", texture]]);

		const firstPayload = prepareStaticObjectDrawPayloadState(
			state,
			resource,
			bindings,
			textures,
		);
		expect(state.isDirty).toBe(false);
		expect(firstPayload.materialUniforms.materialModes[0]).toBe(1);

		textures.delete("base-ref");
		const unchangedPayload = prepareStaticObjectDrawPayloadState(
			state,
			resource,
			bindings,
			textures,
		);
		expect(unchangedPayload).toBe(firstPayload);
		expect(unchangedPayload.materialUniforms.materialModes[0]).toBe(1);

		markStaticObjectPreparedDrawPayloadDirty(state);
		const rebuiltPayload = prepareStaticObjectDrawPayloadState(
			state,
			resource,
			bindings,
			textures,
		);
		expect(rebuiltPayload).toBe(firstPayload);
		expect(state.isDirty).toBe(false);
		expect(rebuiltPayload.materialUniforms.materialModes[0]).toBe(2);
		expect(rebuiltPayload.rolePages.baseColor.textures[0]).toBeNull();
	});
});

function createStaticResource(
	options: Pick<
		StaticObjectMaterialPayloadResource,
		"materialEntries" | "materialFamily"
	>,
): StaticObjectMaterialPayloadResource {
	return {
		drawUnitId: "test-draw-unit",
		materialEntries: options.materialEntries,
		materialFamily: options.materialFamily,
	};
}

function createMaterialEntry(
	options: Partial<StaticMaterialTableEntry> & { readonly slot: number },
): StaticMaterialTableEntry {
	return {
		alphaTest: options.alphaTest ?? 0,
		detailTextureTiling: options.detailTextureTiling ?? 1,
		detailTextureUseId: options.detailTextureUseId ?? null,
		indexTextureUseId: options.indexTextureUseId ?? null,
		indexedClipThreshold: options.indexedClipThreshold ?? -1,
		indexedTextureFormat: options.indexedTextureFormat ?? null,
		materialColor: options.materialColor ?? [1, 1, 1, 1],
		materialEmissiveColor: options.materialEmissiveColor ?? [0, 0, 0],
		materialIds: options.materialIds ?? [],
		paletteFirstIndex: options.paletteFirstIndex ?? 0,
		paletteTextureUseId: options.paletteTextureUseId ?? null,
		primaryTextureUseId: options.primaryTextureUseId ?? null,
		primaryTextureWrapMode: options.primaryTextureWrapMode ?? "clamp",
		renderState: options.renderState ?? opaqueRenderState,
		slot: options.slot,
	};
}

function createBinding(options: {
	readonly height: number;
	readonly kind: StaticTextureBinding["rolePage"]["kind"];
	readonly rect: readonly [number, number, number, number];
	readonly slot: number;
	readonly textureRefId: string;
	readonly textureUseId: string;
	readonly width: number;
}): StaticTextureBinding {
	return {
		owner: { drawUnitId: "test-draw-unit", kind: "draw-unit" },
		rect: options.rect,
		rolePage: {
			kind: options.kind,
			slot: options.slot,
		},
		textureHeight: options.height,
		textureRefId: options.textureRefId,
		textureUseId: options.textureUseId,
		textureWidth: options.width,
	};
}

function createTexture(): WebGLTexture {
	return {} as WebGLTexture;
}
