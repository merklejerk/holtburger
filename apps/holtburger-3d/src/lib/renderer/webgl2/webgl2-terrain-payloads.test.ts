import { describe, expect, it } from "vitest";
import type {
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import type { TextureBindingId } from "../../textures/identity";
import type { ResolvedTexturePlacement } from "../types";
import {
	createTerrainPreparedLayeredPayload,
	hasDeferredTerrainLayeredTextureReadiness,
	prepareTerrainLayeredPayload,
	type TerrainTextureBindingLookup,
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
		const placements = new Map<string, ResolvedTexturePlacement>([
			["base-use", createPlacement("base-use", "base-ref", [10, 11, 12, 13])],
			[
				"overlay-use",
				createPlacement("overlay-use", "overlay-ref", [20, 21, 22, 23]),
			],
			[
				"overlay-alpha-use",
				createPlacement(
					"overlay-alpha-use",
					"overlay-alpha-ref",
					[30, 31, 32, 33],
				),
			],
			["road-use", createPlacement("road-use", "road-ref", [40, 41, 42, 43])],
			[
				"road-alpha-use",
				createPlacement("road-alpha-use", "road-alpha-ref", [50, 51, 52, 53]),
			],
			[
				"detail-use",
				createPlacement("detail-use", "detail-ref", [60, 61, 62, 63]),
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
			prepareTerrainLayeredPayload(
				scratch,
				plan,
				createTextureBindingLookup(placements, textures),
			),
		).toBe(true);

		expect(scratch.colorPages.textures[0]).toBe(baseTexture);
		expect(Array.from(scratch.colorPages.sizes.slice(0, 2))).toEqual([
			128, 256,
		]);
		expect(scratch.maskPages.textures[0]).toBe(overlayMaskTexture);
		expect(scratch.maskPages.textures[1]).toBe(roadMaskTexture);
		expect(Array.from(scratch.layerRects.baseColorRects.slice(4, 8))).toEqual([
			10, 11, 12, 13,
		]);
		expect(scratch.layerRects.baseColorPages[1]).toBe(0);
		expect(scratch.layerRects.baseTilings[1]).toBe(2);
		expect(scratch.layerRects.overlayCounts[1]).toBe(1);
		expect(
			Array.from(scratch.layerRects.overlayColorRects.slice(12, 16)),
		).toEqual([20, 21, 22, 23]);
		expect(scratch.layerRects.overlayColorPages[3]).toBe(1);
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
		expect(scratch.layerRects.roadColorPages[1]).toBe(2);
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
			prepareTerrainLayeredPayload(scratch, plan, createTextureBindingLookup()),
		).toBe(false);
		expect(
			hasDeferredTerrainLayeredTextureReadiness(
				plan,
				createTextureBindingLookup(),
			),
		).toBe(true);
	});

	it("identifies failed terrain bindings as deferred readiness", () => {
		const plan = createPlan({
			layer: {
				base: createRole("terrain-base", "base-use", 1),
				overlays: [],
				roads: [],
			},
		});

		expect(
			hasDeferredTerrainLayeredTextureReadiness(
				plan,
				createTextureBindingLookup(
					new Map(),
					new Map(),
					new Map([
						["base-use", { kind: "failed", reason: "fixture failure" }],
					]),
				),
			),
		).toBe(true);
	});

	it("does not classify missing-not-in-flight terrain bindings as deferred readiness", () => {
		const plan = createPlan({
			layer: {
				base: createRole("terrain-base", "base-use", 1),
				overlays: [],
				roads: [],
			},
		});

		expect(
			hasDeferredTerrainLayeredTextureReadiness(
				plan,
				createTextureBindingLookup(
					new Map(),
					new Map(),
					new Map([
						[
							"base-use",
							{
								kind: "missing-not-in-flight",
								reason: "fixture missing",
							},
						],
					]),
				),
			),
		).toBe(false);
	});

	it("throws when a terrain plan exceeds color page capacity", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const base = createRole("terrain-base", "base-use", 1);
		const plan = createPlan({
			layer: {
				base,
				overlays: [
					{
						alpha: createRole("terrain-alpha", "overlay-alpha-use", 1),
						rotation: 0,
						terrain: createRole("terrain-base", "overlay-use-a", 1),
					},
					{
						alpha: createRole("terrain-alpha", "overlay-alpha-use", 1),
						rotation: 0,
						terrain: createRole("terrain-base", "overlay-use-b", 1),
					},
					{
						alpha: createRole("terrain-alpha", "overlay-alpha-use", 1),
						rotation: 0,
						terrain: createRole("terrain-base", "overlay-use-c", 1),
					},
				],
				roads: [
					{
						alpha: createRole("road-alpha", "road-alpha-use", 1),
						road: createRole("road", "road-use", 1),
						rotation: 0,
					},
				],
			},
		});
		const placements = new Map<string, ResolvedTexturePlacement>(
			[
				["base-use", "base-ref"],
				["overlay-use-a", "overlay-ref-a"],
				["overlay-use-b", "overlay-ref-b"],
				["overlay-use-c", "overlay-ref-c"],
				["road-use", "road-ref"],
				["overlay-alpha-use", "overlay-alpha-ref"],
				["road-alpha-use", "road-alpha-ref"],
			].map(([textureBindingId, textureRefId]) => [
				textureBindingId,
				createPlacement(textureBindingId, textureRefId, [0, 0, 4, 4]),
			]),
		);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", createTexture()],
			["overlay-ref-a", createTexture()],
			["overlay-ref-b", createTexture()],
			["overlay-ref-c", createTexture()],
			["road-ref", createTexture()],
			["overlay-alpha-ref", createTexture()],
			["road-alpha-ref", createTexture()],
		]);

		expect(() =>
			prepareTerrainLayeredPayload(
				scratch,
				plan,
				createTextureBindingLookup(placements, textures),
			),
		).toThrow("exceeded color texture page capacity 4");
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
		const placements = new Map<string, ResolvedTexturePlacement>([
			["base-use", createPlacement("base-use", "base-ref", [0, 0, 4, 4])],
			[
				"detail-a-use",
				createPlacement("detail-a-use", "detail-a-ref", [0, 0, 8, 8]),
			],
			[
				"detail-b-use",
				createPlacement("detail-b-use", "detail-b-ref", [0, 0, 8, 8]),
			],
		]);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", createTexture()],
			["detail-a-ref", createTexture()],
			["detail-b-ref", createTexture()],
		]);

		expect(
			prepareTerrainLayeredPayload(
				scratch,
				plan,
				createTextureBindingLookup(placements, textures),
			),
		).toBe(false);
	});

	it("reuses scratch while reflecting current texture residency", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const base = createRole("terrain-base", "base-use", 1);
		const plan = createPlan({
			layer: {
				base,
				overlays: [],
				roads: [],
			},
		});
		const placements = new Map<string, ResolvedTexturePlacement>([
			["base-use", createPlacement("base-use", "base-ref", [1, 2, 3, 4])],
		]);
		const textures = new Map<string, WebGLTexture>([
			["base-ref", createTexture()],
		]);

		const firstPrepared = prepareTerrainLayeredPayload(
			scratch,
			plan,
			createTextureBindingLookup(placements, textures),
		);
		expect(firstPrepared).toBe(true);
		expect(scratch.layerRects.baseColorPages[1]).toBe(0);

		textures.delete("base-ref");
		const failedPrepared = prepareTerrainLayeredPayload(
			scratch,
			plan,
			createTextureBindingLookup(placements, textures),
		);
		expect(failedPrepared).toBe(false);
	});

	it("late-binds resident terrain textures without changing the plan", () => {
		const scratch = createTerrainPreparedLayeredPayload();
		const base = createRole("terrain-base", "base-use", 1);
		const plan = createPlan({
			layer: {
				base,
				overlays: [],
				roads: [],
			},
		});
		const placements = new Map<string, ResolvedTexturePlacement>();
		const textures = new Map<string, WebGLTexture>();

		expect(
			prepareTerrainLayeredPayload(
				scratch,
				plan,
				createTextureBindingLookup(placements, textures),
			),
		).toBe(false);

		placements.set(
			"base-use",
			createPlacement("base-use", "base-ref", [1, 2, 3, 4]),
		);
		textures.set("base-ref", createTexture());

		expect(
			prepareTerrainLayeredPayload(
				scratch,
				plan,
				createTextureBindingLookup(placements, textures),
			),
		).toBe(true);
		expect(scratch.layerRects.baseColorPages[1]).toBe(0);
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
	textureBindingId: string,
	tiling: number,
): TerrainMaterialTextureRoleBinding {
	return {
		role,
		texture: {
			kind: "surface-texture",
			surfaceTextureId: tiling,
		},
		textureBindingId,
		tiling,
		wrap: "repeat",
	};
}

function createTextureBindingLookup(
	placements: ReadonlyMap<string, ResolvedTexturePlacement> = new Map(),
	textures: ReadonlyMap<string, WebGLTexture> = new Map(),
	stateOverrides: ReadonlyMap<
		string,
		| { readonly kind: "failed"; readonly reason: string }
		| { readonly kind: "missing-not-in-flight"; readonly reason: string }
	> = new Map(),
): TerrainTextureBindingLookup {
	return {
		getResident(bindingId: TextureBindingId) {
			const placement = placements.get(bindingId);
			const texture = placement ? textures.get(placement.textureRefId) : null;
			if (!placement || !texture) {
				return null;
			}
			return {
				bindingId,
				placement,
				texture,
			};
		},
		getState(bindingId: TextureBindingId) {
			const stateOverride = stateOverrides.get(bindingId);
			if (stateOverride) {
				return { bindingId, ...stateOverride };
			}
			const placement = placements.get(bindingId);
			const texture = placement ? textures.get(placement.textureRefId) : null;
			if (!placement || !texture) {
				return { bindingId, kind: "pending" };
			}
			return {
				bindingId,
				kind: "resident",
				placement,
			};
		},
	};
}

function createPlacement(
	textureBindingId: string,
	textureRefId: string,
	rect: readonly [number, number, number, number],
): ResolvedTexturePlacement {
	return {
		pageVersion: {
			placementRevision: 1,
			textureRefId,
		},
		rect,
		textureHeight: 256,
		textureRefId,
		textureBindingId,
		textureWidth: 128,
	};
}

function createTexture(): WebGLTexture {
	return {} as WebGLTexture;
}
