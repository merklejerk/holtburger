import { describe, expect, it } from "vitest";
import type {
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import type { StaticTextureBinding } from "../types";
import {
	createTerrainPreparedLayeredPayload,
	createTerrainPreparedLayeredPayloadState,
	markTerrainPreparedLayeredPayloadDirty,
	prepareTerrainLayeredPayload,
	prepareTerrainLayeredPayloadState,
} from "./webgl2-terrain-payloads";

describe("WebGL2 terrain layered payload builder", () => {
	it("prepares layered page, rect, road, and detail payload arrays", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const base = createRole("terrain-base", "base-use", 2);
		const overlayTerrain = createRole("terrain-base", "overlay-use", 4);
		const overlayAlpha = createRole("terrain-alpha", "overlay-alpha-use", 1);
		const road = createRole("road", "road-use", 6);
		const roadAlpha = createRole("road-alpha", "road-alpha-use", 1);
		const detail = createRole("detail", "detail-use", 12);
		const plan = createPlan({
			detail,
			layer: {
				base,
				overlays: [
					{
						alpha: overlayAlpha,
						rotation: 3,
						terrain: overlayTerrain,
					},
				],
				roads: [
					{
						alpha: roadAlpha,
						road,
						rotation: 2,
					},
				],
			},
		});
		const baseTexture = createTexture();
		const overlayTexture = createTexture();
		const overlayMaskTexture = createTexture();
		const roadTexture = createTexture();
		const roadMaskTexture = createTexture();
		const detailTexture = createTexture();
		const bindings = new Map<string, StaticTextureBinding>([
			[
				"base-use",
				createBinding("base-use", "base-ref", "color", 1, [10, 11, 12, 13]),
			],
			[
				"overlay-use",
				createBinding(
					"overlay-use",
					"overlay-ref",
					"color",
					2,
					[20, 21, 22, 23],
				),
			],
			[
				"overlay-alpha-use",
				createBinding(
					"overlay-alpha-use",
					"overlay-alpha-ref",
					"mask",
					0,
					[30, 31, 32, 33],
				),
			],
			[
				"road-use",
				createBinding("road-use", "road-ref", "color", 3, [40, 41, 42, 43]),
			],
			[
				"road-alpha-use",
				createBinding(
					"road-alpha-use",
					"road-alpha-ref",
					"mask",
					1,
					[50, 51, 52, 53],
				),
			],
			[
				"detail-use",
				createBinding(
					"detail-use",
					"detail-ref",
					"detail",
					0,
					[60, 61, 62, 63],
				),
			],
		]);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", baseTexture],
			["overlay-ref", overlayTexture],
			["overlay-alpha-ref", overlayMaskTexture],
			["road-ref", roadTexture],
			["road-alpha-ref", roadMaskTexture],
			["detail-ref", detailTexture],
		]);

		expect(
			prepareTerrainLayeredPayload(scratch, plan, bindings, textures),
		).toBe(true);

		expect(scratch.colorPages.textures[1]).toBe(baseTexture);
		expect(Array.from(scratch.colorPages.sizes.slice(2, 4))).toEqual([
			128, 256,
		]);
		expect(scratch.maskPages.textures[0]).toBe(overlayMaskTexture);
		expect(scratch.maskPages.textures[1]).toBe(roadMaskTexture);
		expect(Array.from(scratch.layerRects.baseColorRects.slice(4, 8))).toEqual([
			10, 11, 12, 13,
		]);
		expect(scratch.layerRects.baseColorPages[1]).toBe(1);
		expect(scratch.layerRects.baseTilings[1]).toBe(2);
		expect(scratch.layerRects.overlayCounts[1]).toBe(1);
		expect(
			Array.from(scratch.layerRects.overlayColorRects.slice(12, 16)),
		).toEqual([20, 21, 22, 23]);
		expect(scratch.layerRects.overlayColorPages[3]).toBe(2);
		expect(
			Array.from(scratch.layerRects.overlayMaskRects.slice(12, 16)),
		).toEqual([30, 31, 32, 33]);
		expect(scratch.layerRects.overlayMaskPages[3]).toBe(0);
		expect(scratch.layerRects.overlayTilings[3]).toBe(4);
		expect(scratch.layerRects.overlayRotations[3]).toBe(3);
		expect(scratch.layerRects.roadCounts[1]).toBe(1);
		expect(Array.from(scratch.layerRects.roadColorRects.slice(4, 8))).toEqual([
			40, 41, 42, 43,
		]);
		expect(scratch.layerRects.roadColorPages[1]).toBe(3);
		expect(scratch.layerRects.roadTilings[1]).toBe(6);
		expect(Array.from(scratch.layerRects.roadMaskRects.slice(8, 12))).toEqual([
			50, 51, 52, 53,
		]);
		expect(scratch.layerRects.roadMaskPages[2]).toBe(1);
		expect(scratch.layerRects.roadRotations[2]).toBe(2);
		expect(scratch.detail.isEnabled).toBe(true);
		expect(scratch.detail.texture).toBe(detailTexture);
		expect(Array.from(scratch.detail.atlasRect)).toEqual([60, 61, 62, 63]);
		expect(Array.from(scratch.detail.atlasSize)).toEqual([128, 256]);
		expect(scratch.detail.tiling).toBe(12);
		expect(scratch.detail.fadeNear).toBe(30);
		expect(scratch.detail.fadeFar).toBe(90);
	});

	it("returns false when a required terrain binding is missing", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const plan = createPlan({
			layer: {
				base: createRole("terrain-base", "missing-use", 1),
				overlays: [],
				roads: [],
			},
		});

		expect(
			prepareTerrainLayeredPayload(scratch, plan, new Map(), new Map()),
		).toBe(false);
	});

	it("returns false when different terrain textures collide in one page slot", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const base = createRole("terrain-base", "base-use", 1);
		const overlayTerrain = createRole("terrain-base", "overlay-use", 1);
		const overlayAlpha = createRole("terrain-alpha", "overlay-alpha-use", 1);
		const plan = createPlan({
			layer: {
				base,
				overlays: [
					{
						alpha: overlayAlpha,
						rotation: 0,
						terrain: overlayTerrain,
					},
				],
				roads: [],
			},
		});
		const bindings = new Map<string, StaticTextureBinding>([
			[
				"base-use",
				createBinding("base-use", "base-ref", "color", 0, [0, 0, 4, 4]),
			],
			[
				"overlay-use",
				createBinding("overlay-use", "overlay-ref", "color", 0, [4, 0, 4, 4]),
			],
			[
				"overlay-alpha-use",
				createBinding(
					"overlay-alpha-use",
					"overlay-alpha-ref",
					"mask",
					0,
					[0, 4, 4, 4],
				),
			],
		]);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", createTexture()],
			["overlay-ref", createTexture()],
			["overlay-alpha-ref", createTexture()],
		]);

		expect(
			prepareTerrainLayeredPayload(scratch, plan, bindings, textures),
		).toBe(false);
	});

	it("returns false when detail roles disagree on texture residency", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const base = createRole("terrain-base", "base-use", 1);
		const plan = createPlan({
			detail: createRole("detail", "detail-a-use", 1),
			extraDetail: createRole("detail", "detail-b-use", 1),
			layer: {
				base,
				overlays: [],
				roads: [],
			},
		});
		const bindings = new Map<string, StaticTextureBinding>([
			[
				"base-use",
				createBinding("base-use", "base-ref", "color", 0, [0, 0, 4, 4]),
			],
			[
				"detail-a-use",
				createBinding(
					"detail-a-use",
					"detail-a-ref",
					"detail",
					0,
					[0, 0, 8, 8],
				),
			],
			[
				"detail-b-use",
				createBinding(
					"detail-b-use",
					"detail-b-ref",
					"detail",
					0,
					[0, 0, 8, 8],
				),
			],
		]);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", createTexture()],
			["detail-a-ref", createTexture()],
			["detail-b-ref", createTexture()],
		]);

		expect(
			prepareTerrainLayeredPayload(scratch, plan, bindings, textures),
		).toBe(false);
	});

	it("keeps resource-owned payload state dirty when rebuild fails", () => {
		const state = createTerrainPreparedLayeredPayloadState();
		const base = createRole("terrain-base", "base-use", 1);
		const plan = createPlan({
			layer: {
				base,
				overlays: [],
				roads: [],
			},
		});
		const bindings = new Map<string, StaticTextureBinding>([
			[
				"base-use",
				createBinding("base-use", "base-ref", "color", 0, [1, 2, 3, 4]),
			],
		]);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", createTexture()],
		]);

		const firstPayload = prepareTerrainLayeredPayloadState(
			state,
			plan,
			bindings,
			textures,
		);
		expect(firstPayload).not.toBeNull();
		expect(state.isDirty).toBe(false);
		expect(firstPayload?.layerRects.baseColorPages[1]).toBe(0);

		textures.delete("base-ref");
		const unchangedPayload = prepareTerrainLayeredPayloadState(
			state,
			plan,
			bindings,
			textures,
		);
		expect(unchangedPayload).toBe(firstPayload);
		expect(state.isDirty).toBe(false);

		markTerrainPreparedLayeredPayloadDirty(state);
		const failedPayload = prepareTerrainLayeredPayloadState(
			state,
			plan,
			bindings,
			textures,
		);
		expect(failedPayload).toBeNull();
		expect(state.isDirty).toBe(true);
	});
});

function createPlan(options: {
	readonly detail?: TerrainMaterialTextureRoleBinding;
	readonly extraDetail?: TerrainMaterialTextureRoleBinding;
	readonly layer: {
		readonly base: TerrainMaterialTextureRoleBinding;
		readonly overlays: TerrainMaterialLayerPlan["layerEntries"][number]["overlays"];
		readonly roads: TerrainMaterialLayerPlan["layerEntries"][number]["roads"];
	};
}): TerrainMaterialLayerPlan {
	return {
		detailRoles: [
			...(options.detail
				? [
						{
							fadeFar: 90,
							fadeNear: 30,
							role: "landscape" as const,
							texture: options.detail,
						},
					]
				: []),
			...(options.extraDetail
				? [
						{
							fadeFar: 100,
							fadeNear: 40,
							role: "object" as const,
							texture: options.extraDetail,
						},
					]
				: []),
		],
		drawSlices: [],
		fallbackReasons: [],
		layerEntries: [
			{
				allRoad: false,
				base: options.layer.base,
				colorRefCount: 1,
				maskRefCount: 0,
				overlays: options.layer.overlays,
				pcode: 1,
				roads: options.layer.roads,
				slot: 1,
			},
		],
		signature: "test-plan",
	};
}

function createRole(
	role: TerrainMaterialTextureRoleBinding["role"],
	textureUseId: string,
	tiling: number,
): TerrainMaterialTextureRoleBinding {
	return {
		role,
		texture: {
			kind: "surface-texture",
			surfaceTextureId: tiling,
		},
		textureUseId,
		tiling,
		wrap: "repeat",
	};
}

function createBinding(
	textureUseId: string,
	textureRefId: string,
	kind: StaticTextureBinding["rolePage"]["kind"],
	slot: number,
	rect: readonly [number, number, number, number],
): StaticTextureBinding {
	return {
		owner: { drawUnitId: "terrain-test", kind: "draw-unit" },
		rect,
		rolePage: {
			kind,
			slot,
		},
		textureHeight: 256,
		textureRefId,
		textureUseId,
		textureWidth: 128,
	};
}

function createTexture(): WebGLTexture {
	return {} as WebGLTexture;
}
