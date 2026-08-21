import { describe, expect, it, vi } from "vitest";
import { AABB2, Vec2 } from "../math/types";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import type {
	RendererResourceManager,
	Texture2DResourceKey,
} from "../renderer/resource-manager";
import {
	createAssetTextureKey,
	createTextureArrayKey,
	packedObjectTexturePreparation,
	TexturePurpose,
	type TerrainColorTextureArrayFact,
} from "./types";
import {
	type PackedAtlasBindingDelegate,
	TextureManager,
} from "./texture-manager";
import type {
	PreparedTextureSource,
	TexturePreparer,
} from "./texture-preparer";

describe("TextureManager", () => {
	it("delegates packed binding and inspection authority to the resident atlas", () => {
		const key = createAssetTextureKey(
			TexturePurpose.ObjectDirectColor,
			"0x05000001",
		);
		const resource = "texture-2d-resource:resident" as Texture2DResourceKey;
		const delegate: PackedAtlasBindingDelegate = {
			getAtlasBinding: (requestedKey) =>
				requestedKey === key
					? {
							placement: {
								bounds: new AABB2(new Vec2(0, 0), new Vec2(1, 1)),
								preparation: packedObjectTexturePreparation(
									TexturePurpose.ObjectDirectColor,
								),
							},
							resource,
						}
					: null,
			getAtlasDiagnostics: () => ({
				acceptedAtlasCompactions: 0,
				activeAtlasPages: 1,
				activeAtlasPageBytes: 16,
				atlasLayoutWorker: null,
				atlasPageBuildWorker: null,
				atlasPublicationDurationMs: 0,
				attemptedAtlasCompactions: 0,
				metadataOnlyAtlasPageUpdates: 0,
				patchedAtlasPages: 0,
				patchedAtlasRegionBytes: 0,
				atlasPatchFallbacks: 0,
				avoidedAtlasPreparations: 0,
				compactedAtlasPagesEliminated: 0,
				copiedAtlasSourceBytes: 0,
				failedAtlasCompactions: 0,
				failedAtlasTransactions: 0,
				longestAtlasPublicationDurationMs: 0,
				pendingAtlasRequirements: 0,
				peakAtlasPageBytes: 16,
				releasedAtlasPageBytes: 0,
				releasedAtlasPages: 0,
				residentAtlasBindings: 1,
				residentSourceBytes: 4,
				residentSourceCount: 1,
				reusedAtlasInsertions: 0,
				staleAtlasTransactions: 0,
				uploadedAtlasPageBytes: 16,
				uploadedAtlasPages: 1,
			}),
			getAtlasPageDiagnostics: () => [],
			getAtlasPageResource: (pageId) =>
				pageId === "page:atlas:object-direct-color:0" ? resource : null,
		};
		const manager = new TextureManager(
			{} as RendererResourceManager,
			{} as TexturePreparer,
			delegate,
		);

		expect(manager.getAtlasBinding(key).resource).toBe(resource);
		expect(manager.getTexture2DResource(key)).toBe(resource);
		expect(manager.getDiagnostics().residentAtlasBindings).toBe(1);
		expect(
			manager.getAtlasPageResource("page:atlas:object-direct-color:0"),
		).toBe(resource);
	});

	it("publishes a terrain palette atomically with its color-array binding", async () => {
		const sourceAssetId = "surface-texture/0x05000001" as const;
		const fact: TerrainColorTextureArrayFact = {
			kind: "array",
			key: createTextureArrayKey(TexturePurpose.TerrainColor, "test-region"),
			purpose: TexturePurpose.TerrainColor,
			sourceAssetIds: [sourceAssetId],
			sourceAssetIdsByTerrainCode: Array.from(
				{ length: TERRAIN_TYPE_COUNT },
				() => sourceAssetId,
			),
		};
		const palette = {
			colors: new Float32Array(TERRAIN_TYPE_COUNT * 3).fill(0.25),
		};
		const resource = "texture-array-resource:7" as const;
		const released: string[] = [];
		const resources = {
			createTextureArray: () => resource,
			generateTextureArrayMipmaps: () => {},
			releaseResource: (key: string) => {
				released.push(key);
				return true;
			},
			uploadTextureArrayLayer: () => {},
		} as unknown as RendererResourceManager;
		const preparer: TexturePreparer = {
			async destroy() {},
			async prepare() {
				return {
					height: 1,
					key: fact.key,
					layers: [{ pixels: new Uint8Array([1, 2, 3, 4]), sourceAssetId }],
					palette,
					purpose: fact.purpose,
					width: 1,
				};
			},
		};
		const manager = new TextureManager(resources, preparer);

		await manager.retain("terrain-owner", [fact]);
		const binding = manager.getTerrainColorTextureArrayBinding(fact.key);

		expect(binding.resource).toBe(resource);
		expect(binding.palette).toBe(palette);
		expect(binding.layersByAssetId.get(sourceAssetId)).toBe(0);

		manager.dropOwner("terrain-owner");
		expect(released).toEqual([resource]);
		expect(() => manager.getTerrainColorTextureArrayBinding(fact.key)).toThrow(
			"does not exist",
		);
	});

	it.each([
		[
			"non-Float32 storage",
			new Uint8Array(TERRAIN_TYPE_COUNT * 3),
			"Float32Array",
		],
		[
			"short palette",
			new Float32Array(TERRAIN_TYPE_COUNT * 3 - 1),
			`exactly ${TERRAIN_TYPE_COUNT} RGB entries`,
		],
		[
			"long palette",
			new Float32Array(TERRAIN_TYPE_COUNT * 3 + 1),
			`exactly ${TERRAIN_TYPE_COUNT} RGB entries`,
		],
		[
			"non-finite channel",
			new Float32Array(TERRAIN_TYPE_COUNT * 3).fill(Number.NaN),
			"non-finite",
		],
		[
			"out-of-range channel",
			new Float32Array(TERRAIN_TYPE_COUNT * 3).fill(1.01),
			"out-of-range",
		],
	] as const)("rejects a terrain-color %s", async (_, colors, message) => {
		const sourceAssetId = "surface-texture/0x05000001" as const;
		const fact: TerrainColorTextureArrayFact = {
			kind: "array",
			key: createTextureArrayKey(TexturePurpose.TerrainColor, "bad-region"),
			purpose: TexturePurpose.TerrainColor,
			sourceAssetIds: [sourceAssetId],
			sourceAssetIdsByTerrainCode: Array.from(
				{ length: TERRAIN_TYPE_COUNT },
				() => sourceAssetId,
			),
		};
		const preparer: TexturePreparer = {
			async destroy() {},
			async prepare(): Promise<PreparedTextureSource> {
				return {
					height: 1,
					key: fact.key,
					layers: [{ pixels: new Uint8Array([1, 2, 3, 4]), sourceAssetId }],
					palette: { colors },
					purpose: fact.purpose,
					width: 1,
				} as unknown as PreparedTextureSource;
			},
		};
		const manager = new TextureManager({} as RendererResourceManager, preparer);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await manager.retain("terrain-owner", [fact]);
			expect(error).toHaveBeenCalledWith(
				expect.objectContaining({ message: expect.stringContaining(message) }),
			);
			expect(() =>
				manager.getTerrainColorTextureArrayBinding(fact.key),
			).toThrow("does not exist");
		} finally {
			error.mockRestore();
		}
	});
});
