import { describe, expect, it } from "vitest";
import { AABB2, Vec2 } from "../math/types";
import type {
	RendererResourceManager,
	Texture2DResourceKey,
} from "../renderer/resource-manager";
import {
	createAssetTextureKey,
	TexturePurpose,
	TextureWrapMode,
} from "./types";
import {
	type PackedAtlasBindingDelegate,
	TextureManager,
} from "./texture-manager";
import type { TexturePreparer } from "./texture-preparer";

describe("TextureManager", () => {
	it("delegates packed binding and inspection authority to the resident atlas", () => {
		const key = createAssetTextureKey(
			TexturePurpose.ObjectDirectColor,
			"0x05000001",
		);
		const resource = "texture-2d-resource:resident" as Texture2DResourceKey;
		const delegate: PackedAtlasBindingDelegate = {
			getAtlasBinding: (candidate) =>
				candidate === key
					? {
							placement: {
								bounds: new AABB2(new Vec2(0, 0), new Vec2(1, 1)),
								preparation: { gutterPixels: 4, wrap: TextureWrapMode.Repeat },
							},
							resource,
						}
					: null,
			getAtlasDiagnostics: () => ({
				activeAtlasPages: 1,
				pendingAtlasRequirements: 0,
				residentAtlasBindings: 1,
				residentSourceBytes: 4,
				residentSourceCount: 1,
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
});
