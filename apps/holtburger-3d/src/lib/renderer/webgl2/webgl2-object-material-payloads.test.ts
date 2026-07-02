import { describe, expect, it } from "vitest";
import type {
	StaticMaterialTableEntry,
	StaticObjectRenderState,
} from "../../static/contracts";
import type { StaticTextureBinding } from "../types";
import {
	createObjectMaterialPreparedDrawPayload,
	createObjectMaterialPreparedDrawPayloadState,
	markObjectMaterialPreparedDrawPayloadDirty,
	prepareObjectMaterialDrawPayload,
	prepareObjectMaterialDrawPayloadState,
	type ObjectMaterialPayloadResource,
} from "./webgl2-object-material-payloads";

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
	it("fills flat-color material defaults without resident textures", () => {
		const scratch = createObjectMaterialPreparedDrawPayload();
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
			materialFamily: "flat-color",
		});

		prepareObjectMaterialDrawPayload(scratch, resource, new Map(), new Map());

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
		expect(scratch.textures.baseColor).toBeNull();
		expect(scratch.textures.detail).toBeNull();
		expect(scratch.textures.index).toBeNull();
		expect(scratch.textures.palette).toBeNull();
	});

	it("prepares resident role pages and indexed material uniforms", () => {
		const scratch = createObjectMaterialPreparedDrawPayload();
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
					kind: "object-index",
					rect: [10, 11, 12, 13],
					slot: 0,
					textureRefId: "index-ref",
					textureUseId: "index-use",
					width: 32,
				}),
			],
			[
				"palette-use",
				createBinding({
					height: 16,
					kind: "object-palette",
					rect: [20, 21, 22, 23],
					slot: 0,
					textureRefId: "palette-ref",
					textureUseId: "palette-use",
					width: 256,
				}),
			],
			[
				"detail-use",
				createBinding({
					height: 128,
					kind: "object-detail",
					rect: [30, 31, 32, 33],
					slot: 0,
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

		prepareObjectMaterialDrawPayload(scratch, resource, bindings, textures);

		expect(scratch.materialUniforms.indexedTextureFormats[2]).toBe(1);
		expect(
			Array.from(scratch.materialUniforms.indexRects.slice(8, 12)),
		).toEqual([10, 11, 12, 13]);
		expect(
			Array.from(scratch.materialUniforms.paletteRects.slice(8, 12)),
		).toEqual([20, 21, 22, 23]);
		expect(
			Array.from(scratch.materialUniforms.detailRects.slice(8, 12)),
		).toEqual([30, 31, 32, 33]);
		expect(scratch.materialUniforms.detailEnabled[2]).toBe(1);
		expect(scratch.materialUniforms.detailTilings[2]).toBe(3);
		expect(scratch.materialUniforms.wrapModes[2]).toBe(1);
		expect(scratch.textures.index).toEqual({
			height: 64,
			texture: indexTexture,
			width: 32,
		});
		expect(scratch.textures.palette).toEqual({
			height: 16,
			texture: paletteTexture,
			width: 256,
		});
		expect(scratch.textures.detail).toEqual({
			height: 128,
			texture: detailTexture,
			width: 128,
		});
	});

	it("resets stale scratch values between preparations", () => {
		const scratch = createObjectMaterialPreparedDrawPayload();
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
			materialFamily: "flat-color",
		});

		prepareObjectMaterialDrawPayload(
			scratch,
			residentResource,
			new Map([
				[
					"base-use",
					createBinding({
						height: 8,
						kind: "object-base-color",
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
		prepareObjectMaterialDrawPayload(
			scratch,
			fallbackResource,
			new Map(),
			new Map(),
		);

		expect(
			Array.from(scratch.materialUniforms.baseColorRects.slice(0, 4)),
		).toEqual([0, 0, 1, 1]);
		expect(scratch.textures.baseColor).toBeNull();
		expect(scratch.materialUniforms.indexedClipThresholds[0]).toBe(-1);
	});

	it("throws when a static resource has no material table entries", () => {
		const scratch = createObjectMaterialPreparedDrawPayload();
		const resource = createStaticResource({
			materialEntries: [],
			materialFamily: "flat-color",
		});

		expect(() =>
			prepareObjectMaterialDrawPayload(scratch, resource, new Map(), new Map()),
		).toThrow(
			"Object material resource test-draw-unit has no material table entries.",
		);
	});

	it("rebuilds resource-owned payload state only when marked dirty", () => {
		const state = createObjectMaterialPreparedDrawPayloadState();
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
					kind: "object-base-color",
					rect: [1, 2, 3, 4],
					slot: 0,
					textureRefId: "base-ref",
					textureUseId: "base-use",
					width: 8,
				}),
			],
		]);
		const textures = new Map<string, WebGLTexture>([["base-ref", texture]]);

		const firstPayload = prepareObjectMaterialDrawPayloadState(
			state,
			resource,
			bindings,
			textures,
		);
		expect(state.isDirty).toBe(false);
		expect(firstPayload.textures.baseColor?.texture).toBe(texture);

		textures.delete("base-ref");
		const unchangedPayload = prepareObjectMaterialDrawPayloadState(
			state,
			resource,
			bindings,
			textures,
		);
		expect(unchangedPayload).toBe(firstPayload);
		expect(unchangedPayload.textures.baseColor?.texture).toBe(texture);

		markObjectMaterialPreparedDrawPayloadDirty(state);
		expect(() =>
			prepareObjectMaterialDrawPayloadState(
				state,
				resource,
				bindings,
				textures,
			),
		).toThrow(
			"Object material resource test-draw-unit is missing resident base-color texture binding.",
		);
	});
});

function createStaticResource(
	options: Pick<
		ObjectMaterialPayloadResource,
		"materialEntries" | "materialFamily"
	>,
): ObjectMaterialPayloadResource {
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
		paletteTextureUseId: options.paletteTextureUseId ?? null,
		primaryTextureUseId: options.primaryTextureUseId ?? null,
		primaryTextureWrapMode: options.primaryTextureWrapMode ?? "clamp",
		renderState: options.renderState ?? opaqueRenderState,
		slot: options.slot,
	};
}

function createBinding(options: {
	readonly height: number;
	readonly kind: StaticTextureBinding["pageSlot"]["kind"];
	readonly rect: readonly [number, number, number, number];
	readonly slot: number;
	readonly textureRefId: string;
	readonly textureUseId: string;
	readonly width: number;
}): StaticTextureBinding {
	return {
		bindingKey: options.textureUseId,
		owner: { drawUnitId: "test-draw-unit", kind: "draw-unit" },
		rect: options.rect,
		pageSlot: {
			kind: options.kind,
			slot: options.slot,
		},
		textureHeight: options.height,
		textureRefId: options.textureRefId,
		textureWidth: options.width,
	};
}

function createTexture(): WebGLTexture {
	return {} as WebGLTexture;
}
